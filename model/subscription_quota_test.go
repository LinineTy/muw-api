/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
package model

import (
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 动态窗口模型下的配额/续费回归测试（legacy 周期/周/月上限已随模型移除）。

// capWindowJSON 返回一个 limit 窗口的动态窗口 JSON（测试种子用）。
func capWindowJSON(limit int64) string {
	return `[{"unit":"day","value":1,"limit":` + itoa(limit) + `}]`
}

func itoa(v int64) string {
	return strconv.FormatInt(v, 10)
}

func seedQuotaPlan(t *testing.T, id int, plan *SubscriptionPlan) {
	t.Helper()
	plan.Id = id
	require.NoError(t, DB.Create(plan).Error)
	InvalidateSubscriptionPlanCache(id)
}

func seedQuotaSub(t *testing.T, id int, sub *UserSubscription) {
	t.Helper()
	sub.Id = id
	require.NoError(t, DB.Create(sub).Error)
}

func newActiveQuotaSub(userId, planId int) *UserSubscription {
	now := GetDBTimestamp()
	return &UserSubscription{
		UserId:       userId,
		PlanId:       planId,
		Status:       "active",
		StartTime:    now - 86400,
		EndTime:      now + 30*24*3600,
		WeekStartAt:  weekStartUnix(time.Unix(now, 0)),
		MonthStartAt: monthStartUnix(time.Unix(now, 0)),
	}
}

// TestPreConsumeUnlimitedWhenNoCaps 无限额度 = 动态窗口全部额度为 0：预扣不设额度门。
func TestPreConsumeUnlimitedWhenNoCaps(t *testing.T) {
	truncateTables(t)

	seedQuotaPlan(t, 7003, &SubscriptionPlan{
		Title: "unlimited", PriceAmount: 10,
		DurationUnit:   SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: capWindowJSON(0),
	})
	seedQuotaSub(t, 7703, newActiveQuotaSub(703, 7003))

	res, err := PreConsumeUserSubscription("req-unlim-1", 703, "gpt-4", 1, 1_000_000)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 1_000_000, res.PreConsumed)

	var after UserSubscription
	require.NoError(t, DB.Where("id = ?", 7703).First(&after).Error)
	// 无限套餐仍照常累加展示计数（AmountUsed / 周 / 月）。
	assert.EqualValues(t, 1_000_000, after.AmountUsed)
	assert.EqualValues(t, 1_000_000, after.MonthUsed)
}

// TestPreConsumeWindowCapEnforced 动态窗口额度生效：用满后预扣被拒，窗口推进后恢复。
func TestPreConsumeWindowCapEnforced(t *testing.T) {
	truncateTables(t)

	seedQuotaPlan(t, 7005, &SubscriptionPlan{
		Title: "window-cap", PriceAmount: 10,
		DurationUnit:   SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: capWindowJSON(100),
	})
	seedQuotaSub(t, 7705, newActiveQuotaSub(705, 7005))

	res, err := PreConsumeUserSubscription("req-wcap-1", 705, "gpt-4", 1, 100)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 100, res.PreConsumed)

	// 窗口已用满 100 → 拒绝。
	_, err = PreConsumeUserSubscription("req-wcap-2", 705, "gpt-4", 1, 1)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "subscription quota insufficient")

	// 手动把窗口推到已过期，下一次预扣先重置窗口再放行。
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", 7705).
		Update("window_state", `[{"idx":0,"cycle_used":100,"cycle_start_at":1,"next_reset_at":1}]`).Error)
	res, err = PreConsumeUserSubscription("req-wcap-3", 705, "gpt-4", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 50, res.PreConsumed)
}

func TestAdvanceSubscriptionWindowsWeeklyRollover(t *testing.T) {
	now := GetDBTimestamp()
	weekStart := weekStartUnix(time.Unix(now, 0))
	monthStart := monthStartUnix(time.Unix(now, 0))

	// 上上周的窗口，带残留用量 → 推进到本周并清零周用量。
	sub := &UserSubscription{
		WeekStartAt: weekStart - 14*86400, WeekUsed: 50,
		MonthStartAt: monthStart, MonthUsed: 0,
	}
	changed := advanceSubscriptionWindows(sub, &SubscriptionPlan{}, now)
	assert.True(t, changed)
	assert.Equal(t, weekStart, sub.WeekStartAt)
	assert.Zero(t, sub.WeekUsed)

	// 窗口未变 → 不动。
	sub2 := &UserSubscription{
		WeekStartAt: weekStart, WeekUsed: 50,
		MonthStartAt: monthStart, MonthUsed: 0,
	}
	assert.False(t, advanceSubscriptionWindows(sub2, &SubscriptionPlan{}, now))
}

// TestCancelAtEndBlocksRenewal 保护到期取消语义：cancel_at_end 的订阅禁止任何续费。
// RenewSubscriptionTx 是余额/自动/epay 回调的公共咽喉，ValidateSubscriptionPurchaseGate
// 是 epay 创建订单前的网关，两处都必须拒绝续费目标，且被拒后订阅有效期不得改变。
func TestCancelAtEndBlocksRenewal(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7101, &SubscriptionPlan{
		Title: "cancel-at-end", PriceAmount: 10,
		DurationUnit:   SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: capWindowJSON(1000),
	})
	seedQuotaSub(t, 7102, &UserSubscription{
		UserId: 720, PlanId: 7101, Status: "active",
		AmountTotal: 0, CancelAtEnd: true,
		StartTime: now - 86400, EndTime: now + 30*86400,
	})

	// 公共续费咽喉直接拒绝。
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := tx.Where("id = ?", 7102).First(&sub).Error; err != nil {
			return err
		}
		plan, err := getSubscriptionPlanByIdTx(tx, 7101)
		if err != nil {
			return err
		}
		return RenewSubscriptionTx(tx, &sub, plan, now)
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "到期取消")

	var after UserSubscription
	require.NoError(t, DB.Where("id = ?", 7102).First(&after).Error)
	assert.Equal(t, now+30*86400, after.EndTime, "续费被拒后订阅有效期不得改变")

	// epay 网关：创建订单前拒绝续费目标（否则订单已支付后回调才发现不能续，变成坏账）。
	require.NoError(t, DB.Create(&User{Id: 720, Username: "cancel-at-end-user"}).Error)
	plan, err := GetSubscriptionPlanById(7101)
	require.NoError(t, err)
	err = ValidateSubscriptionPurchaseGate(720, plan, 7102)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "到期取消")

	// 对照组：非 cancel_at_end 的订阅可通过续费目标检查，不被误伤。
	seedQuotaSub(t, 7103, &UserSubscription{
		UserId: 720, PlanId: 7101, Status: "active",
		AmountTotal: 0,
		StartTime:   now - 86400, EndTime: now + 30*86400,
	})
	require.NoError(t, ValidateSubscriptionPurchaseGate(720, plan, 7103))
}

// TestRenewUsesSnapshotTerms 保护"续费走旧条款"：购买时写入续费条款快照，之后套餐
// 被编辑（改时长/改价）不影响续费——延长时长取快照周期而非套餐当前周期。
func TestRenewUsesSnapshotTerms(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7201, &SubscriptionPlan{
		Title: "snapshot-terms", PriceAmount: 10,
		DurationUnit:   SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: capWindowJSON(100),
	})
	plan, err := GetSubscriptionPlanById(7201)
	require.NoError(t, err)

	// 购买时写入快照（模拟 CreateUserSubscriptionFromPlanTx 的落库路径）。
	startUnix := now - 10*86400
	expectedDuration := planDurationSeconds(plan, startUnix)
	sub := &UserSubscription{
		UserId:    721, PlanId: 7201, Status: "active",
		StartTime: startUnix,
		EndTime:   startUnix + expectedDuration,
	}
	sub.SnapshotRenewTerms(plan, startUnix)
	require.NotEmpty(t, sub.RenewTerms)
	seedQuotaSub(t, 7202, sub)

	// 管理员事后改条款：时长 1 月 → 2 月。
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", 7201).
		Updates(map[string]interface{}{"duration_value": 2}).Error)
	InvalidateSubscriptionPlanCache(7201)

	// 续费按快照旧条款：时长按快照周期（1 月），而非改后的 2 月。
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		var locked UserSubscription
		require.NoError(t, tx.Where("id = ?", 7202).First(&locked).Error)
		plan, err := getSubscriptionPlanByIdTx(tx, 7201)
		require.NoError(t, err)
		return RenewSubscriptionTx(tx, &locked, plan, now)
	}))

	var after UserSubscription
	require.NoError(t, DB.Where("id = ?", 7202).First(&after).Error)
	assert.Equal(t, sub.EndTime+expectedDuration, after.EndTime, "续费应按快照周期时长延长，而非套餐当前的 2 月")
}

// TestRemainingValueUsesSnapshotPeriod 保护升降配估值：按快照周期时长与价格折算，
// 不被历史续费拉伸的 end-start 分母稀释（升级多扣/降级少退的旧 bug）。
func TestRemainingValueUsesSnapshotPeriod(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7203, &SubscriptionPlan{
		Title: "snapshot-value", PriceAmount: 10,
		DurationUnit:   SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: capWindowJSON(1000),
	})
	plan, err := GetSubscriptionPlanById(7203)
	require.NoError(t, err)

	// 已续费一次的订阅：start 在约 2.3 个月前，剩余 20 天；快照周期 ≈ 30 天、价格 $10。
	startUnix := now - 70*86400
	sub := &UserSubscription{
		UserId:    722, PlanId: 7203, Status: "active",
		AmountTotal: 0,
		StartTime:   startUnix,
		EndTime:     now + 20*86400,
	}
	sub.SnapshotRenewTerms(plan, startUnix)

	value, err := calcSubscriptionRemainingValue(sub, plan)
	require.NoError(t, err)
	dur := planDurationSeconds(plan, startUnix)
	expected := 10.0 * float64(20*86400) / float64(dur)
	assert.InDelta(t, expected, value, 1e-6)
	// 旧公式（end-start 当分母）会得到约 2.2，快照公式应显著更高（≈6.5），
	// 防止稀释回归。
	assert.Greater(t, value, 5.0)
}

// TestDisabledPlanAllowsRenewalBlocksNewPurchase 保护禁用套餐语义：存量订阅仍可续费
// （手动 + 自动都走 renewSubscriptionWithBalanceTx），新购与升降配被拦。
func TestDisabledPlanAllowsRenewalBlocksNewPurchase(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7204, &SubscriptionPlan{
		Title: "disabled-renew", PriceAmount: 10,
		DurationUnit:   SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: capWindowJSON(1000), Enabled: false,
	})
	plan, err := GetSubscriptionPlanById(7204)
	require.NoError(t, err)
	require.False(t, plan.Enabled)

	// 存量订阅（购买时写入快照）+ 余额 10M（快照价 $10 * 500k = 5M）。
	startUnix := now - 10*86400
	sub := &UserSubscription{
		UserId:    723, PlanId: 7204, Status: "active",
		AmountTotal: 0,
		StartTime:   startUnix,
		EndTime:     startUnix + planDurationSeconds(plan, startUnix),
	}
	sub.SnapshotRenewTerms(plan, startUnix)
	seedQuotaSub(t, 7205, sub)
	require.NoError(t, DB.Create(&User{Id: 723, Username: "disabled-renew-user", Quota: 10_000_000}).Error)

	// 禁用套餐的存量续费：成功，按快照价计费。
	var charged int
	var chargedPrice float64
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		q, p, rerr := renewSubscriptionWithBalanceTx(tx, 723, plan, 7205, now)
		charged = q
		chargedPrice = p
		return rerr
	}))
	assert.Equal(t, 5_000_000, charged, "按快照 $10 计费（500k/$）")
	assert.Equal(t, 10.0, chargedPrice)

	var after UserSubscription
	require.NoError(t, DB.Where("id = ?", 7205).First(&after).Error)
	assert.Greater(t, after.EndTime, now, "续费应延长有效期")

	// 同一禁用套餐的新购（subscriptionId=0）被拦。
	_, err = PurchaseWithStrategy(723, 7204, 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "套餐未启用")
}
