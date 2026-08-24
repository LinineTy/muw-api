package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// seedLazyExpireUser 种一个用户并返回其当前分组。
func seedLazyExpireUser(t *testing.T, id int, group string) {
	t.Helper()
	require.NoError(t, DB.Create(&User{Id: id, Username: "lazy-expire-user", Group: group}).Error)
}

func seedLazyExpireSub(t *testing.T, sub *UserSubscription) {
	t.Helper()
	require.NoError(t, DB.Create(sub).Error)
}

func getLazyExpireSub(t *testing.T, id int) UserSubscription {
	t.Helper()
	var sub UserSubscription
	require.NoError(t, DB.Where("id = ?", id).First(&sub).Error)
	return sub
}

func getUserGroupOf(t *testing.T, id int) string {
	t.Helper()
	var group string
	require.NoError(t, DB.Model(&User{}).Where("id = ?", id).Select(commonGroupCol).Scan(&group).Error)
	return group
}

// TestLazyExpireUserSubscriptionsRevertsLegacyGroup 覆盖"升级组在购买时写入、到期按
// PrevUserGroup 回退"的 legacy 语义：订阅确实把用户从 default 升到 vip，过期后回退。
func TestLazyExpireUserSubscriptionsRevertsLegacyGroup(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()

	seedLazyExpireUser(t, 601, "vip")
	seedLazyExpireSub(t, &UserSubscription{
		Id: 611, UserId: 601, PlanId: 6011,
		StartTime: now - 60, EndTime: now - 1, Status: "active",
		UpgradeGroup: "vip", PrevUserGroup: "default", DowngradeGroup: "",
	})

	downgraded, err := LazyExpireUserSubscriptions(601)
	require.NoError(t, err)
	assert.True(t, downgraded)

	sub := getLazyExpireSub(t, 611)
	assert.Equal(t, "expired", sub.Status)
	assert.Equal(t, "default", getUserGroupOf(t, 601))
}

// TestLazyExpireUserSubscriptionsNoOpWhenNotExpired 未到期订阅不应被误标过期或动分组。
func TestLazyExpireUserSubscriptionsNoOpWhenNotExpired(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()

	seedLazyExpireUser(t, 602, "vip")
	seedLazyExpireSub(t, &UserSubscription{
		Id: 612, UserId: 602, PlanId: 6021,
		StartTime: now, EndTime: now + 3600, Status: "active",
		UpgradeGroup: "vip", PrevUserGroup: "default",
	})

	downgraded, err := LazyExpireUserSubscriptions(602)
	require.NoError(t, err)
	assert.False(t, downgraded)

	sub := getLazyExpireSub(t, 612)
	assert.Equal(t, "active", sub.Status)
	assert.Equal(t, "vip", getUserGroupOf(t, 602))
}

// TestLazyExpireUserSubscriptionsNoActiveSub 无活跃订阅是空操作。
func TestLazyExpireUserSubscriptionsNoActiveSub(t *testing.T) {
	truncateTables(t)
	seedLazyExpireUser(t, 603, "default")

	downgraded, err := LazyExpireUserSubscriptions(603)
	require.NoError(t, err)
	assert.False(t, downgraded)
	assert.Equal(t, "default", getUserGroupOf(t, 603))
}

// TestLazyExpireUserSubscriptionsKeepsGroupWithOtherActiveUpgradedSub 还有别的活跃升级
// 订阅时，即使本条到期也不回退分组（downgradeUserGroupForSubscriptionTx 同款守卫）。
func TestLazyExpireUserSubscriptionsKeepsGroupWithOtherActiveUpgradedSub(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()

	seedLazyExpireUser(t, 604, "vip")
	seedLazyExpireSub(t, &UserSubscription{
		Id: 614, UserId: 604, PlanId: 6041,
		StartTime: now - 60, EndTime: now - 1, Status: "active",
		UpgradeGroup: "vip", PrevUserGroup: "default",
	})
	seedLazyExpireSub(t, &UserSubscription{
		Id: 615, UserId: 604, PlanId: 6042,
		StartTime: now - 30, EndTime: now + 3600, Status: "active",
		UpgradeGroup: "vip", PrevUserGroup: "default",
	})

	downgraded, err := LazyExpireUserSubscriptions(604)
	require.NoError(t, err)
	assert.False(t, downgraded)

	assert.Equal(t, "expired", getLazyExpireSub(t, 614).Status)
	assert.Equal(t, "active", getLazyExpireSub(t, 615).Status)
	assert.Equal(t, "vip", getUserGroupOf(t, 604))
}

// TestLazyExpireUserSubscriptionsExplicitDowngradeGroupWins 显式 DowngradeGroup 优先于
// PrevUserGroup 回退。
func TestLazyExpireUserSubscriptionsExplicitDowngradeGroupWins(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()

	seedLazyExpireUser(t, 605, "vip")
	seedLazyExpireSub(t, &UserSubscription{
		Id: 616, UserId: 605, PlanId: 6051,
		StartTime: now - 60, EndTime: now - 1, Status: "active",
		UpgradeGroup: "vip", PrevUserGroup: "default", DowngradeGroup: "basic",
	})

	downgraded, err := LazyExpireUserSubscriptions(605)
	require.NoError(t, err)
	assert.True(t, downgraded)
	assert.Equal(t, "basic", getUserGroupOf(t, 605))
}

// TestLazyExpireUserSubscriptionsIdempotent 第二次调用不再回退（后到者 UPDATE 0 行）。
func TestLazyExpireUserSubscriptionsIdempotent(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()

	seedLazyExpireUser(t, 606, "vip")
	seedLazyExpireSub(t, &UserSubscription{
		Id: 617, UserId: 606, PlanId: 6061,
		StartTime: now - 60, EndTime: now - 1, Status: "active",
		UpgradeGroup: "vip", PrevUserGroup: "default",
	})

	first, err := LazyExpireUserSubscriptions(606)
	require.NoError(t, err)
	assert.True(t, first)

	second, err := LazyExpireUserSubscriptions(606)
	require.NoError(t, err)
	assert.False(t, second)
	assert.Equal(t, "expired", getLazyExpireSub(t, 617).Status)
	assert.Equal(t, "default", getUserGroupOf(t, 606))
}
