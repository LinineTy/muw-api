package dto

// CodingPlanTier 单个额度窗口(如 5 小时滚动窗 / 每周窗)。
type CodingPlanTier struct {
	// Name 窗口标识:five_hour(5 小时滚动窗) | weekly_limit(每周窗)
	Name string `json:"name"`
	// Utilization 已用百分比(0-100)
	Utilization float64 `json:"utilization"`
	// ResetsAt 重置时间(RFC3339);未知时为空
	ResetsAt *string `json:"resets_at"`
}

// CodingPlanQuota 编码套餐余量查询结果。
type CodingPlanQuota struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
	// Level 套餐等级(如智谱的 max);部分厂商无此概念
	Level string           `json:"level,omitempty"`
	Tiers []CodingPlanTier `json:"tiers"`
	// QueriedAt 查询时间(Unix 毫秒)
	QueriedAt int64 `json:"queried_at"`
}
