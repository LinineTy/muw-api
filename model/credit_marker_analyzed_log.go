package model

import (
	"context"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm/clause"
)

// CreditMarkerAnalyzedLog 标记"已进入过 AI 分析"的错误日志，避免同一条日志在保留窗口内被
// 反复分析（尤其当管理员不采纳产出的建议时，二次分析会重复报同一条建议）。
// 仅在分析模型调用成功时写入；失败不标记，下次手动分析可重试。
type CreditMarkerAnalyzedLog struct {
	LogId      int64 `json:"log_id" gorm:"primaryKey"`
	AnalyzedAt int64 `json:"analyzed_at" gorm:"bigint;autoCreateTime"`
}

func (CreditMarkerAnalyzedLog) TableName() string { return "credit_marker_analyzed_logs" }

// MarkErrorLogsAnalyzed 批量记录已分析日志 ID（幂等：已存在的自动忽略，跨 MySQL/PostgreSQL/
// SQLite 兼容）。低频写路径（分析每次最多 20 条候选），不涉及主请求热路径。
func MarkErrorLogsAnalyzed(logIds []int64) error {
	rows := make([]CreditMarkerAnalyzedLog, 0, len(logIds))
	now := common.GetTimestamp()
	for _, id := range logIds {
		if id <= 0 {
			continue
		}
		rows = append(rows, CreditMarkerAnalyzedLog{LogId: id, AnalyzedAt: now})
	}
	if len(rows) == 0 {
		return nil
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error
}

// DeleteOldCreditMarkerAnalyzedLogsBatch 按 analyzed_at 批量删除过期的"已分析日志"标记。
// 已分析标记由分析管道按批写入（审计留痕），保留窗口内有用；定量触发与全量分析会加速
// 增长，需定期清理防无限膨胀（分析管道本身以水位线判定"处理到哪"，不依赖此表）。
func DeleteOldCreditMarkerAnalyzedLogsBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if ctx != nil && ctx.Err() != nil {
		return 0, ctx.Err()
	}
	result := DB.WithContext(ctx).Where("analyzed_at < ?", targetTimestamp).Limit(limit).Delete(&CreditMarkerAnalyzedLog{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
