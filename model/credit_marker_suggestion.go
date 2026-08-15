package model

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// CreditMarkerSuggestion 违规标记词 AI 建议（待管理员采纳后才进 violation_markers）。
// Source: manual/ai；Status: pending/accepted/rejected。
type CreditMarkerSuggestion struct {
	Id        int64  `json:"id" gorm:"primaryKey"`
	Marker    string `json:"marker" gorm:"type:varchar(255);index"`
	Example   string `json:"example" gorm:"type:text"`
	Reason    string `json:"reason" gorm:"type:varchar(512)"`
	Source    string `json:"source" gorm:"type:varchar(32)"`
	Status    string `json:"status" gorm:"type:varchar(16);index"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index;autoCreateTime"`
}

func (CreditMarkerSuggestion) TableName() string { return "credit_marker_suggestions" }

func InsertCreditMarkerSuggestion(s *CreditMarkerSuggestion) error {
	if s == nil || s.Marker == "" {
		return errors.New("invalid marker suggestion")
	}
	if s.Status == "" {
		s.Status = "pending"
	}
	if s.Source == "" {
		s.Source = "ai"
	}
	if s.CreatedAt == 0 {
		s.CreatedAt = common.GetTimestamp()
	}
	return DB.Create(s).Error
}

// ListPendingCreditMarkerSuggestions 返回待审建议（新→旧）。
func ListPendingCreditMarkerSuggestions(limit int) ([]*CreditMarkerSuggestion, error) {
	if limit <= 0 {
		limit = 50
	}
	var suggestions []*CreditMarkerSuggestion
	err := DB.Model(&CreditMarkerSuggestion{}).
		Where("status = ?", "pending").
		Order("id desc").Limit(limit).Find(&suggestions).Error
	return suggestions, err
}

func ListCreditMarkerSuggestions(status string, startIdx int, num int) ([]*CreditMarkerSuggestion, int64, error) {
	if num <= 0 {
		num = common.MaxRecentItems
	}
	tx := DB.Model(&CreditMarkerSuggestion{})
	if status != "" && status != "all" {
		tx = tx.Where("status = ?", status)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var suggestions []*CreditMarkerSuggestion
	err := tx.Order("id desc").Limit(num).Offset(startIdx).Find(&suggestions).Error
	return suggestions, total, err
}

func SetCreditMarkerSuggestionStatus(id int64, status string) error {
	if id <= 0 {
		return errors.New("invalid suggestion id")
	}
	return DB.Model(&CreditMarkerSuggestion{}).Where("id = ?", id).Update("status", status).Error
}

// DeleteOldResolvedCreditMarkerSuggestionsBatch 删除已处理（accepted/rejected）且过期的
// 建议；pending 永不删（待管理员审，删了就丢了线索）。
func DeleteOldResolvedCreditMarkerSuggestionsBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if ctx != nil && ctx.Err() != nil {
		return 0, ctx.Err()
	}
	result := DB.WithContext(ctx).
		Where("status != ? AND created_at < ?", "pending", targetTimestamp).
		Limit(limit).Delete(&CreditMarkerSuggestion{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
