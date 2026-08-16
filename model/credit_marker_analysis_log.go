package model

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// CreditMarkerAnalysisLog 每次标记词 AI 分析运行的留痕：时间/用量/成本必须齐全，
// 让管理员能审计分析模型到底跑了什么、花了多少（含套娃指向站点自身的情况）。
type CreditMarkerAnalysisLog struct {
	Id               int64  `json:"id" gorm:"primaryKey"`
	TriggeredBy      string `json:"triggered_by" gorm:"type:varchar(16)"` // manual/threshold/force
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
	// Retried 本次运行里因 429/5xx 自动退避重试的请求次数（0=未遇到限流）。审计用：
	// 全量分析被上游限流时，管理员能在这看到实际重试了多少次。
	Retried      int    `json:"retried"`
	ErrorMessage string `json:"error_message" gorm:"type:varchar(512)"`
	// PromptUsed 本次运行实际使用的提示词标识：默认提示词存 "default"；自定义提示词存其
	// 单行预览（前 48 rune，换行折叠为空格）。审计用：提示词可配置后，管理员能区分某批
	// 建议是在默认还是自定义提示词下产出的。
	PromptUsed string `json:"prompt_used" gorm:"type:varchar(64)"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint;index;autoCreateTime"`
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

// GetLatestMarkerAnalysisLog 返回指定触发方式（manual/scheduled/threshold）最近一次
// 分析运行；没有该类型记录时返回 nil。定时触发用其 StartedAt 判断间隔是否已到。
func GetLatestMarkerAnalysisLog(triggeredBy string) (*CreditMarkerAnalysisLog, error) {
	if triggeredBy == "" {
		return nil, errors.New("invalid triggered_by")
	}
	var log CreditMarkerAnalysisLog
	err := DB.Where("triggered_by = ?", triggeredBy).Order("id desc").First(&log).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &log, nil
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
