package model

import (
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
		UpgradeGroup:   upgradeGroup,
		PrevUserGroup:  prevGroup,
		StartTime:      now - 15*86400, EndTime: now + endOffset,
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
	downgraded, err = LazyExpireUserSubscriptions(832)
	require.NoError(t, err)
	assert.False(t, downgraded)
	assert.Equal(t, "v2", gpUserGroup(t, 832), "同级降级目标被拦截，组保持")
}

// 编译期引用检查（避免 unused import）。
var _ = time.Now
