// @muw-owned
package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openUserNotificationTestDB 用内存 SQLite 装配 DB 并迁移站内消息表。
func openUserNotificationTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&UserNotification{}))
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
}

// seedUserNotification 落一条指定归属与已读状态的消息，返回 id。
func seedUserNotification(t *testing.T, userId int, readAt int64) int {
	t.Helper()
	item := &UserNotification{
		UserId:    userId,
		Type:      "channel_update",
		Title:     "上游模型巡检通知",
		Content:   "上游模型巡检摘要",
		CreatedAt: common.GetTimestamp(),
		ReadAt:    readAt,
	}
	require.NoError(t, DB.Create(item).Error)
	return item.Id
}

// countUserNotifications 直接数库里的行（不看列表接口的分页口径）。
func countUserNotifications(t *testing.T, userId int) int64 {
	t.Helper()
	var count int64
	require.NoError(t, DB.Model(&UserNotification{}).Where("user_id = ?", userId).Count(&count).Error)
	return count
}

// TestDeleteUserNotificationsScopedToOwner 别人（或不存在）的消息 id 删不到：
// 归属校验在 SQL 的 WHERE user_id 上，不是先查后删。
func TestDeleteUserNotificationsScopedToOwner(t *testing.T) {
	openUserNotificationTestDB(t)

	mine := seedUserNotification(t, 100, 0)
	others := seedUserNotification(t, 101, 0)

	// 别人的 id：返回 0 且那一行还在。
	deleted, err := DeleteUserNotifications(100, []int{others})
	require.NoError(t, err)
	assert.Equal(t, int64(0), deleted)
	assert.Equal(t, int64(1), countUserNotifications(t, 101))

	// 混着自己的和别人的 id：只删掉自己的那一条。
	extra := seedUserNotification(t, 100, 0)
	deleted, err = DeleteUserNotifications(100, []int{mine, others, extra})
	require.NoError(t, err)
	assert.Equal(t, int64(2), deleted)
	assert.Equal(t, int64(0), countUserNotifications(t, 100))
	assert.Equal(t, int64(1), countUserNotifications(t, 101))

	// 非法 userId / 空 ids：不落到 DB，返回 0。
	deleted, err = DeleteUserNotifications(0, []int{others})
	require.NoError(t, err)
	assert.Equal(t, int64(0), deleted)
	deleted, err = DeleteUserNotifications(100, nil)
	require.NoError(t, err)
	assert.Equal(t, int64(0), deleted)
	assert.Equal(t, int64(1), countUserNotifications(t, 101))
}

// TestDeleteUserNotificationsByScope onlyRead=true 只清已读；false 清全部，
// 两种范围都只作用于自己的消息。
func TestDeleteUserNotificationsByScope(t *testing.T) {
	openUserNotificationTestDB(t)

	seedUserNotification(t, 100, common.GetTimestamp())
	seedUserNotification(t, 100, 0)
	seedUserNotification(t, 101, common.GetTimestamp())

	deleted, err := DeleteUserNotificationsByScope(100, true)
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)
	// 自己的未读还在、别人的已读没被连带清掉。
	assert.Equal(t, int64(1), countUserNotifications(t, 100))
	assert.Equal(t, int64(1), countUserNotifications(t, 101))

	deleted, err = DeleteUserNotificationsByScope(100, false)
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)
	assert.Equal(t, int64(0), countUserNotifications(t, 100))
	assert.Equal(t, int64(1), countUserNotifications(t, 101))

	// 已删空后再清一次：没有可删的行，不报错。
	deleted, err = DeleteUserNotificationsByScope(100, false)
	require.NoError(t, err)
	assert.Equal(t, int64(0), deleted)

	// 非法 userId 不动任何数据。
	deleted, err = DeleteUserNotificationsByScope(0, false)
	require.NoError(t, err)
	assert.Equal(t, int64(0), deleted)
	assert.Equal(t, int64(1), countUserNotifications(t, 101))
}
