package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PlaygroundConversation 游乐场对话的服务端持久化（多设备同步）。
// ClientId 是前端生成的 nanoid，跨设备稳定标识；Messages 存 JSON 文本
// （前端 Conversation.messages 的序列化）。不做 TTL，由用户主动删除。
type PlaygroundConversation struct {
	Id          int            `json:"id" gorm:"primaryKey"`
	UserId      int            `json:"user_id" gorm:"index;uniqueIndex:uk_user_client"`
	ClientId    string         `json:"client_id" gorm:"size:64;uniqueIndex:uk_user_client"` // 前端 nanoid
	Title       string         `json:"title" gorm:"size:255"`
	Messages    string         `json:"-" gorm:"type:text"` // JSON 文本
	CreatedTime int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

func (PlaygroundConversation) TableName() string { return "playground_conversations" }

// UpsertPlaygroundConversation 按 (user_id, client_id) upsert。三库通用
// （SQLite ON CONFLICT / MySQL ON DUPLICATE / PostgreSQL ON CONFLICT）。
// 冲突时更新 title/messages/updated_time 并清空 deleted_at，复活被软删的
// 同 client_id 会话——否则软删行仍占唯一索引，重发同 client_id 会写入软删行
// 而列表（默认排除软删）查不到，导致会话「消失且不可恢复」。
func UpsertPlaygroundConversation(conv *PlaygroundConversation) error {
	conv.UpdatedTime = common.GetTimestamp()
	if conv.CreatedTime == 0 {
		conv.CreatedTime = conv.UpdatedTime
	}
	err := DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "client_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"title":        conv.Title,
			"messages":     conv.Messages,
			"updated_time": conv.UpdatedTime,
			"deleted_at":   gorm.Expr("NULL"),
		}),
	}).Create(conv).Error
	return err
}

// ListPlaygroundConversationsByUser 返回某用户全部会话（最新更新在前，软删排除）。
func ListPlaygroundConversationsByUser(userId int) ([]*PlaygroundConversation, error) {
	var conversations []*PlaygroundConversation
	err := DB.Where("user_id = ?", userId).
		Order("updated_time DESC").
		Find(&conversations).Error
	return conversations, err
}

// GetPlaygroundConversationByClientId 按归属查询单个会话（归属校验用）。
func GetPlaygroundConversationByClientId(userId int, clientId string) (*PlaygroundConversation, error) {
	var conversation PlaygroundConversation
	if err := DB.Where("user_id = ? AND client_id = ?", userId, clientId).First(&conversation).Error; err != nil {
		return nil, err
	}
	return &conversation, nil
}

// DeletePlaygroundConversationByClientId 软删某用户指定会话。
func DeletePlaygroundConversationByClientId(userId int, clientId string) error {
	return DB.Where("user_id = ? AND client_id = ?", userId, clientId).Delete(&PlaygroundConversation{}).Error
}
