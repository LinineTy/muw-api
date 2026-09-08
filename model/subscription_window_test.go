package model

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 动态重置窗口（reset_windows）模型的回归测试。每一条对应一个真实契约/历史 bug：
//   - 封顶窗口（周期 ≥ 剩余有效期）永不刷新，limit 即本订阅总上限（修 bug #5 无限超用）。
//   - 续费后封顶窗口恢复重置且无"一次性滞后"（HOLE A 修正）。
//   - 多窗口独立取最小；单次预扣累加全部窗口。
//   - 动态订阅跳过累计账本 guard（HOLE D）。
//   - 退款对全部窗口 clamp 且幂等。
//   - 续费清零 period_used（开启新预付期）。

func windowStateJSON(entries ...string) string {
	return "[" + strings.Join(entries, ",") + "]"
}

func windowEntry(idx int, used, start, next int64) string {
	return fmt.Sprintf(`{"idx":%d,"cycle_used":%d,"cycle_start_at":%d,"next_reset_at":%d}`, idx, used, start, next)
}

func getSubByID(t *testing.T, id int) UserSubscription {
	t.Helper()
	var sub UserSubscription
	require.NoError(t, DB.Where("id = ?", id).First(&sub).Error)
	return sub
}

func windowStatesOf(t *testing.T, sub UserSubscription) []WindowState {
	t.Helper()
	states := sub.WindowStates()
	require.NotEmpty(t, states, "动态订阅必须有窗口状态")
	return states
}

// 封顶窗口永不重置（bug #5 回归）：5h 窗口 + 剩余 3h 的订阅，消耗满后不因"边界已过"
// 被每请求清零，累计到 limit 后持续拒绝。
func TestWindowCapWindowNeverResetsWithinValidity(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7801, &SubscriptionPlan{
		Title: "cap-window", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":100}]`,
	})
	// EndTime = now+3h < 5h 窗口周期 → 窗口永不重置（封顶，limit=100 即本订阅总上限）。
	seedQuotaSub(t, 7802, &UserSubscription{
		UserId: 781, PlanId: 7801, Status: "active",
		StartTime: now - 3600, EndTime: now + 3*3600,
		WindowState: windowStateJSON(windowEntry(0, 0, now, 0)),
	})

	res, err := PreConsumeUserSubscription("req-cap-1", 781, "gpt-4", 1, 100)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 100, res.PreConsumed)

	// 已满：再预扣 1 必须被拒。
	_, err = PreConsumeUserSubscription("req-cap-2", 781, "gpt-4", 1, 1)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "insufficient")

	// 核心断言：窗口计数必须保留 100（不得被"边界已过"清零），封顶持续生效。
	after := getSubByID(t, 7802)
	states := windowStatesOf(t, after)
	assert.EqualValues(t, 100, states[0].CycleUsed, "封顶窗口计数必须保留，不能被每请求清零")
	assert.Zero(t, states[0].NextResetAt, "超出有效期的窗口应保持封顶（next_reset_at=0）")
}

// 续费后封顶窗口恢复重置、无一次性滞后（HOLE A 回归）：晚续费跨过窗口边界后，
// 续费后的第一次 PreConsume 即获得新周期，不被旧累计误拒。
func TestWindowRenewRearmsCapWindowWithoutLag(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	startUnix := now - 40*86400 // 40 天前购买
	seedQuotaPlan(t, 7803, &SubscriptionPlan{
		Title: "rearm-window", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"month","value":1,"limit":100}]`,
	})
	// 原订阅 EndTime = start+10d（已过期但状态仍 active，模拟维护任务未跑）。
	seedQuotaSub(t, 7804, &UserSubscription{
		UserId: 782, PlanId: 7803, Status: "active",
		StartTime: startUnix,
		EndTime:   startUnix + 10*86400,
		// 封顶态：月窗口 next_reset 超出原 EndTime，计数已用 80。
		WindowState: windowStateJSON(windowEntry(0, 80, startUnix, 0)),
	})

	// 晚续费：EndTime 延长到 now + ~30d，月窗口（start+1月 ≈ now-10d）现在落在期内。
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		var locked UserSubscription
		require.NoError(t, tx.Where("id = ?", 7804).First(&locked).Error)
		plan, err := getSubscriptionPlanByIdTx(tx, 7803)
		require.NoError(t, err)
		return RenewSubscriptionTx(tx, &locked, plan, now)
	}))

	// 续费后第一次预扣：边界已过 → 立即重置，拿到满额 100（无一次性滞后）。
	res, err := PreConsumeUserSubscription("req-rearm-1", 782, "gpt-4", 1, 100)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 100, res.PreConsumed)

	after := getSubByID(t, 7804)
	assert.Greater(t, after.EndTime, now, "续费应延长有效期")
	states := windowStatesOf(t, after)
	assert.EqualValues(t, 100, states[0].CycleUsed)
}

// 多窗口独立取最小：5h 窗口耗尽后 day 窗口还有剩余也必须拒绝；小时窗口边界过恢复；
// day 窗口按订阅期累计为总额封顶。
func TestWindowMultipleIndependentMinGate(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7805, &SubscriptionPlan{
		Title: "multi-window", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":10},{"unit":"day","value":1,"limit":200}]`,
	})
	seedQuotaSub(t, 7806, &UserSubscription{
		UserId: 783, PlanId: 7805, Status: "active",
		StartTime: now, EndTime: now + 10*86400,
		WindowState: windowStateJSON(
			windowEntry(0, 0, now, now+5*3600),
			windowEntry(1, 0, now, now+86400),
		),
	})

	res, err := PreConsumeUserSubscription("req-multi-1", 783, "gpt-4", 1, 10)
	require.NoError(t, err)
	require.EqualValues(t, 10, res.PreConsumed)

	// hour 耗尽（剩0），day 还有 190 → 仍拒绝。
	_, err = PreConsumeUserSubscription("req-multi-2", 783, "gpt-4", 1, 1)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "insufficient")

	// 推进 hour 边界（next_reset_at 已过）→ 下一次预扣先重置 hour 再放行。
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", 7806).
		Update("window_state", windowStateJSON(
			windowEntry(0, 10, now, now-1),
			windowEntry(1, 10, now, now+86400),
		)).Error)
	res, err = PreConsumeUserSubscription("req-multi-3", 783, "gpt-4", 1, 1)
	require.NoError(t, err)
	require.EqualValues(t, 1, res.PreConsumed)

	// day 窗口累计到 200 后封顶：把 day 计数推到 199、hour 重置为满额，预扣 1 到 200。
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", 7806).
		Update("window_state", windowStateJSON(
			windowEntry(0, 0, now, now+5*3600),
			windowEntry(1, 199, now, now+86400),
		)).Error)
	res, err = PreConsumeUserSubscription("req-multi-4", 783, "gpt-4", 1, 1)
	require.NoError(t, err)
	require.EqualValues(t, 1, res.PreConsumed)

	_, err = PreConsumeUserSubscription("req-multi-5", 783, "gpt-4", 1, 1)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "insufficient")
}

// 动态订阅跳过累计账本 guard（HOLE D 回归）：单期账本 PeriodUsed 即使已超过预付价值，
// PostConsume 也不得报 legacy 的 "used exceeds total"。
func TestWindowDynamicNoLegacyTotalGuard(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7807, &SubscriptionPlan{
		Title: "hole-d", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":100}]`,
	})
	seedQuotaSub(t, 7808, &UserSubscription{
		UserId: 784, PlanId: 7807, Status: "active",
		PeriodUsed: 2000, // 已超过快照价格对应的 units（模拟超耗）
		StartTime: now, EndTime: now + 30*86400,
		WindowState: windowStateJSON(windowEntry(0, 50, now, now+5*3600)),
	})

	// 结算正 delta：不得报错，窗口计数 +10。
	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, 784, 7808, 10))
	states := windowStatesOf(t, getSubByID(t, 7808))
	assert.EqualValues(t, 60, states[0].CycleUsed)

	// 退款负 delta 超过计数 → clamp 到 0，不报错。
	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, 784, 7808, -1000))
	states = windowStatesOf(t, getSubByID(t, 7808))
	assert.Zero(t, states[0].CycleUsed)
}

// 退款对全部窗口 clamp 且幂等：重复退款第二次为空操作。
func TestWindowRefundClampsAllWindowsIdempotent(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7809, &SubscriptionPlan{
		Title: "refund-window", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":10},{"unit":"day","value":1,"limit":200}]`,
	})
	seedQuotaSub(t, 7810, &UserSubscription{
		UserId: 785, PlanId: 7809, Status: "active",
		StartTime: now, EndTime: now + 10*86400,
		WindowState: windowStateJSON(
			windowEntry(0, 0, now, now+5*3600),
			windowEntry(1, 0, now, now+86400),
		),
	})

	res, err := PreConsumeUserSubscription("req-refund-1", 785, "gpt-4", 1, 10)
	require.NoError(t, err)
	require.EqualValues(t, 10, res.PreConsumed)

	require.NoError(t, RefundSubscriptionPreConsume("req-refund-1"))
	require.NoError(t, RefundSubscriptionPreConsume("req-refund-1")) // 幂等：第二次空操作

	states := windowStatesOf(t, getSubByID(t, 7810))
	assert.Zero(t, states[0].CycleUsed)
	assert.Zero(t, states[1].CycleUsed)
}

// 续费开启新的预付期：period_used 清零重开，仅 EndTime 延长。
func TestRenewResetsPeriodUsed(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7811, &SubscriptionPlan{
		Title: "no-accumulate", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":100}]`,
	})
	startUnix := now - 10*86400
	seedQuotaSub(t, 7812, &UserSubscription{
		UserId: 786, PlanId: 7811, Status: "active",
		PeriodUsed: 500,
		StartTime:  startUnix, EndTime: startUnix + 10*86400,
		WindowState: windowStateJSON(windowEntry(0, 0, startUnix, 0)),
	})

	renew := func() {
		require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
			var locked UserSubscription
			require.NoError(t, tx.Where("id = ?", 7812).First(&locked).Error)
			plan, err := getSubscriptionPlanByIdTx(tx, 7811)
			require.NoError(t, err)
			return RenewSubscriptionTx(tx, &locked, plan, now)
		}))
	}
	renew()
	renew()

	after := getSubByID(t, 7812)
	assert.Zero(t, after.PeriodUsed, "续费开启新预付期，period_used 必须清零")
	assert.Greater(t, after.EndTime, startUnix+10*86400, "续费应延长有效期")
}

// 单次预扣累加全部窗口：一次预扣同时推进 hour 与 month 两个窗口的计数。
func TestWindowPreConsumeIncrementsAllWindows(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7813, &SubscriptionPlan{
		Title: "all-windows", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":10},{"unit":"month","value":1,"limit":200}]`,
	})
	seedQuotaSub(t, 7814, &UserSubscription{
		UserId: 787, PlanId: 7813, Status: "active",
		StartTime: now, EndTime: now + 30*86400,
		WindowState: windowStateJSON(
			windowEntry(0, 0, now, now+5*3600),
			windowEntry(1, 0, now, now+30*86400),
		),
	})

	res, err := PreConsumeUserSubscription("req-all-1", 787, "gpt-4", 1, 10)
	require.NoError(t, err)
	require.EqualValues(t, 10, res.PreConsumed)

	states := windowStatesOf(t, getSubByID(t, 7814))
	assert.EqualValues(t, 10, states[0].CycleUsed, "hour 窗口计数应 +10")
	assert.EqualValues(t, 10, states[1].CycleUsed, "month 窗口计数应 +10")
}

// CreateUserSubscriptionFromPlanTx 对动态套餐初始化各窗口状态（计数 0、从购买时刻锚定）。
func TestCreateUserSubscriptionDynamicInitsWindowState(t *testing.T) {
	truncateTables(t)

	seedQuotaPlan(t, 7815, &SubscriptionPlan{
		Title: "init-window", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":10},{"unit":"month","value":1,"limit":200}]`,
	})
	require.NoError(t, DB.Create(&User{Id: 788, Username: "init-window-user", Quota: 0}).Error)

	plan, err := GetSubscriptionPlanById(7815)
	require.NoError(t, err)
	sub, err := CreateUserSubscriptionFromPlanTx(DB, 788, plan, "balance")
	require.NoError(t, err)
	require.NotEmpty(t, sub.Id)

	states := sub.WindowStates()
	require.Len(t, states, 2)
	assert.Zero(t, states[0].CycleUsed)
	assert.Zero(t, states[1].CycleUsed)
	assert.Equal(t, sub.StartTime, states[0].CycleStartAt)
}

// ApplyPlanWindowsToActiveSubscriptions 把套餐保存出 reset_windows 时重置其活跃订阅的
// 窗口计数（"改动即重置"：转换/编辑窗口列表 = 重定义配额，不映射旧计数）。
func TestApplyPlanWindowsToActiveSubscriptionsResetsCounters(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7818, &SubscriptionPlan{
		Title: "convert-window", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":10},{"unit":"day","value":1,"limit":200}]`,
	})
	activeEnd := now + 10*86400
	// 活跃订阅：带 legacy 计数残留（模拟转换前状态）。
	seedQuotaSub(t, 7819, &UserSubscription{
		UserId: 790, PlanId: 7818, Status: "active",
		PeriodUsed: 300,
		WeekUsed: 40, MonthUsed: 90,
		StartTime: now - 86400, EndTime: activeEnd,
	})
	// 已过期订阅：不受转换影响。
	seedQuotaSub(t, 7820, &UserSubscription{
		UserId: 790, PlanId: 7818, Status: "active",
		StartTime: now - 86400, EndTime: now - 1,
	})

	plan, err := GetSubscriptionPlanById(7818)
	require.NoError(t, err)
	count, err := ApplyPlanWindowsToActiveSubscriptions(DB, plan, now)
	require.NoError(t, err)
	assert.EqualValues(t, 1, count, "只应重置活跃订阅")

	after := getSubByID(t, 7819)
	states := after.WindowStates()
	require.Len(t, states, 2)
	assert.Zero(t, states[0].CycleUsed)
	assert.Zero(t, states[1].CycleUsed)
	assert.GreaterOrEqual(t, states[0].CycleStartAt, now)
}

// 手动重置动态订阅：全部窗口计数清零、从 now 锚定；advance=true 顺延下次重置。
func TestWindowResetClearsAllWindows(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7816, &SubscriptionPlan{
		Title: "reset-window", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":10},{"unit":"day","value":1,"limit":200}]`,
	})
	before := now - 3600
	seedQuotaSub(t, 7817, &UserSubscription{
		UserId: 789, PlanId: 7816, Status: "active",
		StartTime: before, EndTime: now + 10*86400,
		WindowState: windowStateJSON(
			windowEntry(0, 8, before, now+5*3600),
			windowEntry(1, 150, before, now+86400),
		),
	})

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		require.NoError(t, tx.Where("id = ?", 7817).First(&sub).Error)
		plan, err := getSubscriptionPlanByIdTx(tx, 7816)
		require.NoError(t, err)
		return resetUserSubscriptionTx(tx, &sub, plan, now, true)
	}))

	states := windowStatesOf(t, getSubByID(t, 7817))
	for _, s := range states {
		assert.Zero(t, s.CycleUsed, "重置后窗口计数必须清零")
		assert.GreaterOrEqual(t, s.CycleStartAt, now, "重置后窗口应从 now 锚定")
	}
}

// ResetWindowsEqual 是「改动即重置」的判等基础：语义比较而非字节比较，
// 键序/空白/空串与空数组都视为相同，仅窗口定义真实变化才判不等。
func TestResetWindowsEqual(t *testing.T) {
	cases := []struct {
		name string
		a, b string
		want bool
	}{
		{"both empty", "", "", true},
		{"empty vs empty array", "", "[]", true},
		{"identical", `[{"unit":"hour","value":5,"limit":100}]`, `[{"unit":"hour","value":5,"limit":100}]`, true},
		{"key order differs", `[{"unit":"hour","value":5,"limit":100}]`, `[{"limit":100,"unit":"hour","value":5}]`, true},
		{"whitespace differs", `[{"unit":"hour","value":5,"limit":100}]`, `[ { "unit": "hour", "value": 5, "limit": 100 } ]`, true},
		{"limit changed", `[{"unit":"hour","value":5,"limit":100}]`, `[{"unit":"hour","value":5,"limit":200}]`, false},
		{"value changed", `[{"unit":"hour","value":5,"limit":100}]`, `[{"unit":"hour","value":6,"limit":100}]`, false},
		{"extra window", `[{"unit":"hour","value":5,"limit":100}]`, `[{"unit":"hour","value":5,"limit":100},{"unit":"day","value":1,"limit":200}]`, false},
		{"dynamic to empty", `[{"unit":"hour","value":5,"limit":100}]`, "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, ResetWindowsEqual(c.a, c.b))
		})
	}
}

// 动态订阅也维护自然周/月展示计数（钱包卡「订阅抵扣」按 month_used 统计）：
// 预扣累加、结算差额修正、日历月边界清零——与 legacy 一致，仅作统计不作上限。
func TestWindowDynamicMaintainsCalendarMonthCounter(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7824, &SubscriptionPlan{
		Title: "cal-stat", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":100}]`,
	})
	// 上月已用 50（模拟跨月）：预扣时先按日历月边界清零再累加。
	seedQuotaSub(t, 7825, &UserSubscription{
		UserId: 792, PlanId: 7824, Status: "active",
		StartTime: now - 3600, EndTime: now + 30*86400,
		MonthStartAt: monthStartUnix(time.Unix(now, 0)) - 86400, MonthUsed: 50,
		WeekStartAt: weekStartUnix(time.Unix(now, 0)) - 7*86400, WeekUsed: 20,
		WindowState: windowStateJSON(windowEntry(0, 0, now, now+5*3600)),
	})

	res, err := PreConsumeUserSubscription("req-cal-1", 792, "gpt-4", 1, 10)
	require.NoError(t, err)
	require.NotNil(t, res)
	require.EqualValues(t, 10, res.PreConsumed)

	// 上月残留被日历边界清零：本月只计 10，不是 60。
	after := getSubByID(t, 7825)
	assert.EqualValues(t, 10, after.MonthUsed, "日历月边界应清零上月计数后再累加本月")
	assert.EqualValues(t, 10, after.WeekUsed, "日历周边界应清零上周计数后再累加本周")

	// 结算差额 +5 → 计数 15。
	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, 792, 7825, 5))
	after = getSubByID(t, 7825)
	assert.EqualValues(t, 15, after.MonthUsed)
	assert.EqualValues(t, 15, after.WeekUsed)

	// 退款负差额超过计数 → clamp 到 0。
	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, 792, 7825, -1000))
	after = getSubByID(t, 7825)
	assert.Zero(t, after.MonthUsed)
	assert.Zero(t, after.WeekUsed)
}
