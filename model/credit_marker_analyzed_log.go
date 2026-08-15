package model

import (
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

// GetAnalyzedErrorLogIds 返回全部已分析日志 ID 集合（供 fetchRecentErrorLogs 排除）。
// 候选日志（含内容安全特征、未命中现有标记）数量远小于全量错误日志，50 万上限足够。
func GetAnalyzedErrorLogIds() (map[int64]bool, error) {
	var rows []CreditMarkerAnalyzedLog
	if err := DB.Model(&CreditMarkerAnalyzedLog{}).Limit(500000).Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	set := make(map[int64]bool, len(rows))
	for _, r := range rows {
		set[r.LogId] = true
	}
	return set, nil
}
