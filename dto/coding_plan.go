package dto

// CodingPlanTier 单个额度窗口(如 5 小时滚动窗 / 每周窗 / 每月窗)。
type CodingPlanTier struct {
	// Name 窗口标识:five_hour(5 小时滚动窗) | weekly_limit(每周窗) |
	// monthly_limit(每月窗) | daily_limit(每日窗)
	Name string `json:"name"`
	// Utilization 已用百分比(0-100)
	Utilization float64 `json:"utilization"`
	// ResetsAt 重置时间(RFC3339);未知时为空
	ResetsAt *string `json:"resets_at"`

	// 原始数值(仅厂商返回时才有;Kimi 给 limit/remaining,智谱/MiniMax 只有百分比
	// → 缺省为 0,omitempty 省略,前端据此回退成百分比展示)。
	// 2026-09-21 起为小数:credits 类厂商(Command Code)的额度就是小数(13.93),
	// 之前用 int64 只能取整显示,与百分比对不上。
	Limit     float64 `json:"limit,omitempty"`     // 窗口额度
	Remaining float64 `json:"remaining,omitempty"` // 剩余
	Used      float64 `json:"used,omitempty"`      // 已用 = Limit - Remaining(下限 0)
}

// CodingPlanExtraCredits 窗口外额度(不受任何滚动窗口限制)的剩余量。
// Command Code 这类订阅套餐既有月度额度,也有额外购买/赠送的 credits(永久有效、可结转)。
type CodingPlanExtraCredits struct {
	// Purchased 额外购买部分
	Purchased float64 `json:"purchased,omitempty"`
	// Free 厂商赠送部分
	Free float64 `json:"free,omitempty"`
}

// CodingPlanQuota 编码套餐余量查询结果。
type CodingPlanQuota struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
	// Level 套餐等级(如智谱的 max / Command Code 的 GOAT);部分厂商无此概念
	Level string           `json:"level,omitempty"`
	Tiers []CodingPlanTier `json:"tiers"`
	// Extra 窗口外剩余额度;厂商没有这个概念(或没有)时省略
	Extra *CodingPlanExtraCredits `json:"extra,omitempty"`
	// QueriedAt 查询时间(Unix 毫秒)
	QueriedAt int64 `json:"queried_at"`
}
