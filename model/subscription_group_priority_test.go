package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 订阅组优先级测试。配置 {"v2":30,"v1":20}（default 未配置=0），统一 ≥ 语义：
//   - 购买/切换改组：priority(目标) ≥ priority(当前) 才改——低买高保组、同级互换、高买低升级
//   - 过期/取消降级：priority(目标) ≥ priority(当前) 不降；其他活跃订阅撑更高组时降到那个组
func setupGroupPriorityEnv(t *testing.T) {
	t.Helper()
	truncateTables(t)
	require.NoError(t, SetSubscriptionGroupPrioritiesFromJSON(`{"v2":30,"v1":20,"v1b":20}`))
	t.Cleanup(func() { _ = SetSubscriptionGroupPrioritiesFromJSON(`{}`) })

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })
}

func seedGPPlan(t *testing.T, id int, title, upgradeGroup, exclusiveGroup string, priority int) {
	t.Helper()
	seedQuotaPlan(t, id, &SubscriptionPlan{
		Title: title, PriceAmount: 10, Enabled: true,
		DurationUnit: SubscriptionDurationDay, DurationValue: 30,
		ResetWindowsRaw: capWindowJSON(1000),
		UpgradeGroup:    upgradeGroup,
		ExclusiveGroup:  exclusiveGroup,
		Priority:        priority,
	})
}

func seedGPSub(t *testing.T, id int, userId, planId int, upgradeGroup string, endOffset int64) {
	t.Helper()
	seedGPSubFull(t, id, userId, planId, upgradeGroup, "", endOffset)
}

func seedGPSubFull(t *testing.T, id int, userId, planId int, upgradeGroup, prevGroup string, endOffset int64) {
	t.Helper()
	now := GetDBTimestamp()
	sub := &UserSubscription{
		UserId: userId, PlanId: planId, Status: "active",
		UpgradeGroup:  upgradeGroup,
		PrevUserGroup: prevGroup,
		StartTime:     now - 15*86400, EndTime: now + endOffset,
	}
	seedQuotaSub(t, id, sub)
}

func seedGPUser(t *testing.T, id int, group string) {
	t.Helper()
	require.NoError(t, DB.Create(&User{Id: id, Username: "gp-user-" + string(rune(id)), AffCode: "gp" + string(rune(id)), Group: group, Quota: 20_000_000}).Error)
}

func gpUserGroup(t *testing.T, userId int) string {
	t.Helper()
	var u User
	require.NoError(t, DB.Where("id = ?", userId).First(&u).Error)
	return u.Group
}

// 场景 a/b/c：购买方向。
func TestGroupPriorityPurchase(t *testing.T) {
	setupGroupPriorityEnv(t)
	now := GetDBTimestamp()

	seedGPPlan(t, 8101, "gp-v2", "v2", "gp-a", 2)
	seedGPPlan(t, 8102, "gp-v1", "v1", "gp-b", 1)
	seedGPPlan(t, 8103, "gp-v1b", "v1b", "gp-c", 1)
	_ = now

	// a) v2 用户买 v1 订阅：组保持 v2，低级订阅不拉低（核心需求场景）。
	// （显式 seed ID 与购买自增 ID 之间留大空隙，防止撞号）
	seedGPUser(t, 820, "v2")
	seedGPSub(t, 8220, 820, 8101, "v2", 15*86400)
	_, err := PurchaseWithStrategy(820, 8102, 0)
	require.NoError(t, err)
	assert.Equal(t, "v2", gpUserGroup(t, 820), "低级订阅不得拉低当前组")
	var v1Sub UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND plan_id = ?", 820, 8102).First(&v1Sub).Error)
	assert.Equal(t, "active", v1Sub.Status, "v1 订阅照常生效（额度照给，只是不换组）")

	// b) v1 用户买 v2 订阅：照常升级。
	seedGPUser(t, 821, "v1")
	seedGPSub(t, 8240, 821, 8102, "v1", 15*86400)
	_, err = PurchaseWithStrategy(821, 8101, 0)
	require.NoError(t, err)
	assert.Equal(t, "v2", gpUserGroup(t, 821), "高买低照常升级")

	// c) 同级互换：v1 用户买 v1b（同为 20）→ 改组（跟随用户主动选择）。
	seedGPUser(t, 822, "v1")
	seedGPSub(t, 8260, 822, 8102, "v1", 15*86400)
	_, err = PurchaseWithStrategy(822, 8103, 0)
	require.NoError(t, err)
	assert.Equal(t, "v1b", gpUserGroup(t, 822), "同级放行，组跟随新订阅")
}

// 场景 d/e/f：过期方向。
func TestGroupPriorityExpiry(t *testing.T) {
	setupGroupPriorityEnv(t)

	seedGPPlan(t, 8111, "gp-v2", "v2", "gp-a", 2)
	seedGPPlan(t, 8112, "gp-v1", "v1", "gp-b", 1)

	// d1) v2+v1 共存，v1 过期 → v2 还撑着，保持 v2。
	// （v1 end_time 更早 = 先过期；prev_user_group 模拟"从 default 升上来的"）
	seedGPUser(t, 830, "v2")
	seedGPSubFull(t, 8230, 830, 8111, "v2", "default", 15*86400)
	seedGPSubFull(t, 8231, 830, 8112, "v1", "default", -7200)
	downgraded, err := LazyExpireUserSubscriptions(830)
	require.NoError(t, err)
	assert.False(t, downgraded)
	assert.Equal(t, "v2", gpUserGroup(t, 830), "v1 过期时 v2 订阅撑组，保持 v2")

	// d2) v2 订阅过期但 v1 订阅还活着（maintainer核心场景的续集：a 中保住组的 v2 用户，
	// 其 v2 订阅到期后应回 v1 而非底组）——独立新用户，v1 订阅保持活跃。
	seedGPUser(t, 833, "v2")
	seedGPSubFull(t, 8234, 833, 8111, "v2", "default", -3600)
	seedGPSubFull(t, 8235, 833, 8112, "v1", "default", 15*86400)
	downgraded, err = LazyExpireUserSubscriptions(833)
	require.NoError(t, err)
	assert.True(t, downgraded)
	assert.Equal(t, "v1", gpUserGroup(t, 833), "v2 过期后应回 v1（v1 订阅还撑着），不是底组")

	// e) 无共存：v2 单独过期 → 回底组 default（prev_user_group 语义）。
	seedGPUser(t, 831, "v2")
	seedGPSubFull(t, 8232, 831, 8111, "v2", "default", -3600)
	downgraded, err = LazyExpireUserSubscriptions(831)
	require.NoError(t, err)
	assert.True(t, downgraded)
	assert.Equal(t, "default", gpUserGroup(t, 831), "无订阅撑组时回底组")

	// f) 同级降级拦截：v2 订阅 downgrade_group=v2b（同为 30）→ 不降。
	require.NoError(t, SetSubscriptionGroupPrioritiesFromJSON(`{"v2":30,"v2b":30}`))
	t.Cleanup(func() { _ = SetSubscriptionGroupPrioritiesFromJSON(`{"v2":30,"v1":20,"v1b":20}`) })
	seedQuotaPlan(t, 8113, &SubscriptionPlan{
		Title: "gp-v2b", PriceAmount: 10, Enabled: true,
		DurationUnit: SubscriptionDurationDay, DurationValue: 30,
		ResetWindowsRaw: capWindowJSON(1000),
		UpgradeGroup:    "v2", DowngradeGroup: "v2b",
		ExclusiveGroup: "gp-d", Priority: 2,
	})
	seedGPUser(t, 832, "v2")
	seedGPSub(t, 8233, 832, 8113, "v2", -3600)
	// CreateUserSubscriptionFromPlanTx 会把套餐 downgrade_group 快照进订阅行；seedGPSubFull
	// 不写该列，这里补上（f 测的是"同级降级目标被拦"，降级目标必须在行上生效）。
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", 8233).Update("downgrade_group", "v2b").Error)
	downgraded, err = LazyExpireUserSubscriptions(832)
	require.NoError(t, err)
	assert.False(t, downgraded)
	assert.Equal(t, "v2", gpUserGroup(t, 832), "同级降级目标被拦截，组保持")
}

// ---- 锚点态（已配置组优先级）下"钉子/高水位"语义 ----

// seedAnchorPlan 造一个带升/降目标与互斥组的订阅套餐（行内字段即计划字段，购买时会
// 快照进订阅行）。
func seedAnchorPlan(t *testing.T, id int, up, down, exclusive string) {
	t.Helper()
	seedQuotaPlan(t, id, &SubscriptionPlan{
		Title: fmt.Sprintf("anchor-%s-%s-%d", up, down, id), PriceAmount: 10, Enabled: true,
		DurationUnit: SubscriptionDurationDay, DurationValue: 30,
		ResetWindowsRaw: capWindowJSON(1000),
		UpgradeGroup:    up, DowngradeGroup: down, ExclusiveGroup: exclusive,
	})
}

func anchorTestEnv(t *testing.T, prioritiesJSON string) {
	t.Helper()
	truncateTables(t)
	require.NoError(t, SetSubscriptionGroupPrioritiesFromJSON(prioritiesJSON))
	t.Cleanup(func() { _ = SetSubscriptionGroupPrioritiesFromJSON(`{}`) })
	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })
}

func buyAnchorPlan(t *testing.T, userId, planId int) {
	t.Helper()
	_, err := PurchaseWithStrategy(userId, planId, 0)
	require.NoError(t, err)
}

// forceExpireSubs 把用户指定套餐的订阅 end_time 拨到过去并惰性到期，返回是否改过组。
func forceExpireSubs(t *testing.T, userId, planId int) bool {
	t.Helper()
	now := GetDBTimestamp()
	require.NoError(t, DB.Model(&UserSubscription{}).
		Where("user_id = ? AND plan_id = ? AND status = ?", userId, planId, "active").
		Update("end_time", now-1).Error)
	downgraded, err := LazyExpireUserSubscriptions(userId)
	require.NoError(t, err)
	return downgraded
}

// 钉子（升 X 降 X）自然到期：锚点保留，组不掉，即便没有其它活跃订阅。
func TestAnchorPinSurvivesNaturalExpiry(t *testing.T) {
	anchorTestEnv(t, `{"default":1,"v1":20,"v2":30}`)
	seedAnchorPlan(t, 9101, "v2", "v2", "gx-pin")
	seedGPUser(t, 9001, "default")

	buyAnchorPlan(t, 9001, 9101)
	require.Equal(t, "v2", gpUserGroup(t, 9001))

	assert.False(t, forceExpireSubs(t, 9001, 9101), "钉子自然到期不掉组")
	assert.Equal(t, "v2", gpUserGroup(t, 9001), "钉子订阅到期后组保持")
	var sub UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND plan_id = ?", 9001, 9101).First(&sub).Error)
	assert.Equal(t, "expired", sub.Status)
}

// Q1：更高钉子 v3（不同互斥组）买到后把钉顶到 v3；v3 自然到期仍锚，v2 也到期仍停 v3。
func TestAnchorHigherPinSupersedes(t *testing.T) {
	anchorTestEnv(t, `{"default":1,"v1":20,"v2":30,"v3":40}`)
	seedAnchorPlan(t, 9102, "v2", "v2", "gx-a")
	seedAnchorPlan(t, 9103, "v3", "v3", "gx-b") // 更高钉子、不同互斥组
	seedGPUser(t, 9002, "default")

	buyAnchorPlan(t, 9002, 9102)
	require.Equal(t, "v2", gpUserGroup(t, 9002))
	buyAnchorPlan(t, 9002, 9103) // additive 高买 → 组升 v3
	require.Equal(t, "v3", gpUserGroup(t, 9002))

	assert.False(t, forceExpireSubs(t, 9002, 9103), "v3 自然到期不掉组（钉子锚保留）")
	assert.Equal(t, "v3", gpUserGroup(t, 9002), "高钉 v3 接管")
	assert.False(t, forceExpireSubs(t, 9002, 9102), "v2 也到期仍不掉")
	assert.Equal(t, "v3", gpUserGroup(t, 9002), "v2 钉子让位给 v3，组仍 v3")
}

// Q2：非钉子 v3（升 v3 降 v1）到期，用户仍持 v2 → 回落到 v2 而非其降级目标 v1。
func TestAnchorNonPinnedHighExpiresFallsToRemaining(t *testing.T) {
	anchorTestEnv(t, `{"default":1,"v1":20,"v2":30,"v3":40}`)
	seedAnchorPlan(t, 9104, "v2", "v2", "gx-a") // v2 持有者（钉子，不同互斥组）
	seedAnchorPlan(t, 9105, "v3", "v1", "gx-b") // 非钉子：升 v3 降 v1
	seedGPUser(t, 9003, "default")

	buyAnchorPlan(t, 9003, 9104)
	require.Equal(t, "v2", gpUserGroup(t, 9003))
	buyAnchorPlan(t, 9003, 9105)
	require.Equal(t, "v3", gpUserGroup(t, 9003))

	assert.True(t, forceExpireSubs(t, 9003, 9105), "v3 到期应掉组（回落到现存 v2）")
	assert.Equal(t, "v2", gpUserGroup(t, 9003), "非钉子 v3 到期回落仍持有的 v2，而非降级目标 v1")
}

// 同互斥组买低档替换钉子档：旧钉子被作废、组跟随新档（自愿降级解钉）。
func TestAnchorSameGroupReplaceReleasesPin(t *testing.T) {
	anchorTestEnv(t, `{"default":1,"v1":20,"v2":30}`)
	seedAnchorPlan(t, 9106, "v2", "v2", "gx-same") // 钉子 v2
	seedAnchorPlan(t, 9107, "v1", "v1", "gx-same") // 同互斥组低档
	seedGPUser(t, 9004, "default")

	buyAnchorPlan(t, 9004, 9106)
	require.Equal(t, "v2", gpUserGroup(t, 9004))

	buyAnchorPlan(t, 9004, 9107) // 同组替换 → 旧 v2 作废、组跟新档 v1
	require.Equal(t, "v1", gpUserGroup(t, 9004), "同互斥组低档替换解钉，组降 v1")
	var oldSub UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND plan_id = ?", 9004, 9106).First(&oldSub).Error)
	assert.Equal(t, "cancelled", oldSub.Status, "旧钉子订阅被作废")

	assert.False(t, forceExpireSubs(t, 9004, 9107), "替换后的 v1 本身也是钉子，自然到期不掉")
	assert.Equal(t, "v1", gpUserGroup(t, 9004))
}

// 彻底断档（唯一非钉子订阅到期）→ 按它自己的 downgrade 目标兜底。
func TestAnchorFullLapseDrainsToDowngradeGroup(t *testing.T) {
	anchorTestEnv(t, `{"default":1,"v1":20,"v2":30}`)
	seedAnchorPlan(t, 9108, "v2", "v1", "") // 非钉子：升 v2 降 v1，无互斥组
	seedGPUser(t, 9005, "default")

	buyAnchorPlan(t, 9005, 9108)
	require.Equal(t, "v2", gpUserGroup(t, 9005))

	assert.True(t, forceExpireSubs(t, 9005, 9108), "唯一订阅到期应掉组")
	assert.Equal(t, "v1", gpUserGroup(t, 9005), "彻底断档按 downgrade 目标 v1 兜底")
}

// 编译期引用检查（避免 unused import）。
var _ = time.Now
