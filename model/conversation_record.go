package model

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// ConversationRecord 对话记录留存（请求+响应）。独立表放主库 DB。
// Request 为已剥离图片 base64 的请求文本（截断）；Response 为 tee 捕获的
// 原始响应文本/SSE（截断）。MySQL 的 request/response 需升 LONGTEXT
// （见 ensureConversationRecordLongText，model/main.go）。
type ConversationRecord struct {
	Id         int64  `json:"id" gorm:"primaryKey"`
	UserId     int    `json:"user_id" gorm:"index"`
	TokenId    int    `json:"token_id" gorm:"index"`
	ChannelId  int    `json:"channel_id"`
	RequestId  string `json:"request_id" gorm:"type:varchar(64);index"`
	ModelName  string `json:"model_name" gorm:"type:varchar(128);index"`
	RelayMode  int    `json:"relay_mode"`
	IsStream   bool   `json:"is_stream"`
	StatusCode int    `json:"status_code"`
	Request    string `json:"request" gorm:"type:text"`  // 已剥离图片的文本（截断）
	Response   string `json:"response" gorm:"type:text"` // tee 捕获的原始响应（截断）
	SizeBytes  int64  `json:"size_bytes" gorm:"bigint"`  // 抓取时按字节计的 request+response 大小（总量核算用）
	CreatedAt  int64  `json:"created_at" gorm:"bigint;index;autoCreateTime"`
}

func (ConversationRecord) TableName() string { return "conversation_records" }

func InsertConversationRecord(rec *ConversationRecord) error {
	if rec == nil || rec.UserId <= 0 {
		return errors.New("invalid conversation record")
	}
	if rec.CreatedAt == 0 {
		rec.CreatedAt = common.GetTimestamp()
	}
	return DB.Create(rec).Error
}

// ListConversationRecords 分页列表。请求/响应正文可能大到 12MB+12MB，列表页按
// 页拉 20 条会拖垮网络与内存，这里只投影元数据；正文由 GetConversationRecord 详情单独取。
func ListConversationRecords(userId int, tokenId int, requestId string, modelName string, startTimestamp int64, endTimestamp int64, startIdx int, num int) (records []*ConversationRecord, total int64, err error) {
	if num <= 0 {
		num = common.MaxRecentItems
	}
	tx := DB.Model(&ConversationRecord{}).Omit("request", "response")
	if userId > 0 {
		tx = tx.Where("user_id = ?", userId)
	}
	if tokenId > 0 {
		tx = tx.Where("token_id = ?", tokenId)
	}
	if requestId != "" {
		tx = tx.Where("request_id = ?", requestId)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	if startTimestamp > 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if err = tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&records).Error
	return records, total, err
}

// GetConversationRecord 按 id 取单条完整记录（含请求/响应正文），详情弹窗用。
func GetConversationRecord(id int64) (*ConversationRecord, error) {
	if id <= 0 {
		return nil, errors.New("invalid conversation record id")
	}
	var rec ConversationRecord
	if err := DB.Where("id = ?", id).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func CountOldConversationRecords(ctx context.Context, targetTimestamp int64) (int64, error) {
	var total int64
	err := DB.WithContext(ctx).Model(&ConversationRecord{}).
		Where("created_at < ?", targetTimestamp).Count(&total).Error
	return total, err
}

// CountConversationRecordsSince 统计 since 之后的对话记录数（风控中心概览）。
func CountConversationRecordsSince(since int64) (int64, error) {
	var total int64
	err := DB.Model(&ConversationRecord{}).
		Where("created_at >= ?", since).Count(&total).Error
	return total, err
}

// DeleteOldConversationRecordsBatch 按 created_at 批量删除，返回实际删除行数。
func DeleteOldConversationRecordsBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if ctx != nil && ctx.Err() != nil {
		return 0, ctx.Err()
	}
	result := DB.WithContext(ctx).Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&ConversationRecord{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// SumConversationSize 返回对话记录表 size_bytes 总和（已用空间核算）。
func SumConversationSize(ctx context.Context) (int64, error) {
	var sum int64
	err := DB.WithContext(ctx).Model(&ConversationRecord{}).
		Select("COALESCE(SUM(size_bytes), 0)").
		Scan(&sum).Error
	return sum, err
}

// DeleteOldestConversationRecordsBatch 删除最老的一批记录（按 id 升序），
// 用于总存量超限时的滚动清理。分两步（先取 id 再删），避免 DELETE...ORDER BY
// 在 PostgreSQL 下不兼容。
func DeleteOldestConversationRecordsBatch(ctx context.Context, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if ctx != nil && ctx.Err() != nil {
		return 0, ctx.Err()
	}
	var ids []int64
	if err := DB.WithContext(ctx).Model(&ConversationRecord{}).
		Order("id asc").Limit(limit).Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result := DB.WithContext(ctx).Where("id IN ?", ids).Delete(&ConversationRecord{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
