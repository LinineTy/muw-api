package model

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// CreditMarkerAnalysisLog 每次标记词 AI 分析运行的留痕：时间/用量/成本必须齐全，
// 让管理员能审计分析模型到底跑了什么、花了多少（含套娃指向站点自身的情况）。
type CreditMarkerAnalysisLog struct {
	Id               int64  `json:"id" gorm:"primaryKey"`
	TriggeredBy      string `json:"triggered_by" gorm:"type:varchar(16)"` // manual/scheduled
	StartedAt        int64  `json:"started_at" gorm:"bigint"`
	FinishedAt       int64  `json:"finished_at" gorm:"bigint"`
	DurationMs       int64  `json:"duration_ms"`
	AnalyzedCount    int    `json:"analyzed_count"` // 喂了多少条错误文案
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	TotalTokens      int    `json:"total_tokens"`
	Model            string `json:"model" gorm:"type:varchar(128)"`
	BaseUrl          string `json:"base_url" gorm:"type:varchar(255)"` // 脱敏
	SuggestionsCount int    `json:"suggestions_count"`
	ErrorMessage     string `json:"error_message" gorm:"type:varchar(512)"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;index;autoCreateTime"`
}

func (CreditMarkerAnalysisLog) TableName() string { return "credit_marker_analysis_logs" }

func InsertCreditMarkerAnalysisLog(log *CreditMarkerAnalysisLog) error {
	if log == nil {
		return errors.New("invalid marker analysis log")
	}
	if log.CreatedAt == 0 {
		log.CreatedAt = common.GetTimestamp()
	}
	return DB.Create(log).Error
}

func ListCreditMarkerAnalysisLogs(startIdx int, num int) ([]*CreditMarkerAnalysisLog, int64, error) {
	if num <= 0 {
		num = common.MaxRecentItems
	}
	tx := DB.Model(&CreditMarkerAnalysisLog{})
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []*CreditMarkerAnalysisLog
	err := tx.Order("id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	return logs, total, err
}

// DeleteOldCreditMarkerAnalysisLogsBatch 按 created_at 批量删除过期分析运行日志（TTL 清理）。
func DeleteOldCreditMarkerAnalysisLogsBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if ctx != nil && ctx.Err() != nil {
		return 0, ctx.Err()
	}
	result := DB.WithContext(ctx).Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&CreditMarkerAnalysisLog{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
