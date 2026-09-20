// @muw-owned
package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// UserNotification 站内消息（自研）：只服务网页端的「消息」窗口。
//
// 与站外推送（email / webhook / bark / gotify）**互不影响**：站外推送按用户个人偏好走
// （见 service.NotifyUser），站内消息一律落库 —— 管理员今天没配邮箱、没开推送开关，
// 打开网页也应该能看到「上游模型巡检」这类历史。
type UserNotification struct {
	Id     int    `json:"id" gorm:"primaryKey"`
	UserId int    `json:"user_id" gorm:"index:idx_user_notification_owner,priority:1"`
	Type   string `json:"type" gorm:"size:64;index"` // 复用 dto.NotifyType*（channel_update 等）
	Title  string `json:"title" gorm:"size:255"`
	// 正文是纯文本台账（上游巡检摘要带换行），前端按 pre-wrap 渲染，不塞 HTML
	Content   string `json:"content" gorm:"type:text"`
	CreatedAt int64  `json:"created_at" gorm:"index:idx_user_notification_owner,priority:2"`
	// 0 = 未读；存读取时刻而不是布尔，方便以后做「何时读的」
	ReadAt int64 `json:"read_at"`
}

func (UserNotification) TableName() string {
	return "user_notifications"
}

// CreateUserNotification 落一条站内消息。
func CreateUserNotification(userId int, notifyType string, title string, content string) error {
	if userId <= 0 {
		return errors.New("invalid user id")
	}
	notification := &UserNotification{
		UserId:    userId,
		Type:      notifyType,
		Title:     title,
		Content:   content,
		CreatedAt: common.GetTimestamp(),
	}
	return DB.Create(notification).Error
}

// UserNotificationPage 列表 + 未读数一次返回：消息窗口同时要两者，别让前端发两个请求。
type UserNotificationPage struct {
	Items    []UserNotification `json:"items"`
	Total    int64              `json:"total"`
	Unread   int64              `json:"unread"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
}

func GetUserNotifications(userId int, page int, pageSize int, unreadOnly bool) (*UserNotificationPage, error) {
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	var total int64
	if err := DB.Model(&UserNotification{}).Where("user_id = ?", userId).Count(&total).Error; err != nil {
		return nil, err
	}

	// 未读数始终是「全部未读」，不受 unread_only 影响 —— 角标要的是这个数
	var unread int64
	if err := DB.Model(&UserNotification{}).
		Where("user_id = ? AND read_at = 0", userId).
		Count(&unread).Error; err != nil {
		return nil, err
	}

	query := DB.Model(&UserNotification{}).Where("user_id = ?", userId)
	if unreadOnly {
		query = query.Where("read_at = 0")
	}
	items := make([]UserNotification, 0, pageSize)
	if err := query.
		Order("id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&items).Error; err != nil {
		return nil, err
	}

	return &UserNotificationPage{
		Items:    items,
		Total:    total,
		Unread:   unread,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// MarkUserNotificationsRead 把指定消息标记为已读。userId 进 WHERE：
// 别人的消息 id 传进来也改不到（不额外查一次归属）。
func MarkUserNotificationsRead(userId int, ids []int) (int64, error) {
	if userId <= 0 || len(ids) == 0 {
		return 0, nil
	}
	result := DB.Model(&UserNotification{}).
		Where("user_id = ? AND id IN ? AND read_at = 0", userId, ids).
		Update("read_at", common.GetTimestamp())
	return result.RowsAffected, result.Error
}

func MarkAllUserNotificationsRead(userId int) (int64, error) {
	if userId <= 0 {
		return 0, nil
	}
	result := DB.Model(&UserNotification{}).
		Where("user_id = ? AND read_at = 0", userId).
		Update("read_at", common.GetTimestamp())
	return result.RowsAffected, result.Error
}
