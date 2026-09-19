// @muw-owned
package model

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// OperationsOverview 运营总览卡片指标。
type OperationsOverview struct {
	TotalUsers    int64 `json:"total_users"`
	NewUsersToday int64 `json:"new_users_today"`
	NewUsers7d    int64 `json:"new_users_7d"`
	ActiveToday   int64 `json:"active_today"`
	Active7d      int64 `json:"active_7d"`
	RequestsToday int64 `json:"requests_today"`
	QuotaToday    int64 `json:"quota_today"`
	DisabledUsers int64 `json:"disabled_users"`
}

// OperationsTrendRow 单日趋势（day_idx 为时区平移后的 epoch 天序号）。
type OperationsTrendRow struct {
	DayIdx      int64 `json:"day_idx"`
	NewUsers    int64 `json:"new_users"`
	ActiveUsers int64 `json:"active_users"`
	Requests    int64 `json:"requests"`
	Quota       int64 `json:"quota"`
}

// DistributionRow 通用分布行。
// 列别名用 row_key 而非 key:`key` 是 MySQL 保留字,DB.Raw 原样透传不会被引号化,
// 直接写 AS key 会报 Error 1064。改别名后各方言通用(不依赖反引号/双引号)。
type DistributionRow struct {
	Key   string `json:"key" gorm:"column:row_key"`
	Count int64  `json:"count"`
}

// TrustLevelRow 信任等级分布行。
type TrustLevelRow struct {
	Level int   `json:"level"`
	Count int64 `json:"count"`
}

// RankingRow 模型/渠道用量排行行。
// Count 必须显式标 column:requests —— GORM 的 Scan 按字段名(snake_case)匹配列,
// 不读 json tag,而 SQL 里这一列的别名是 requests,不加 tag 会恒扫成 0。
type RankingRow struct {
	Key   string `json:"key" gorm:"column:row_key"`
	Name  string `json:"name"`
	Count int64  `json:"requests" gorm:"column:requests"`
	Quota int64  `json:"quota"`
	Users int64  `json:"users"`
}

// OperationsRankings 模型与渠道排行。
type OperationsRankings struct {
	Models   []RankingRow `json:"models"`
	Channels []RankingRow `json:"channels"`
}

// OperationsDistributions 注册来源 / 信任等级 / 用户分组分布。
type OperationsDistributions struct {
	Sources     []DistributionRow `json:"sources"`
	TrustLevels []TrustLevelRow   `json:"trust_levels"`
	Groups      []DistributionRow `json:"groups"`
}

// epochDayDivOperator 返回「整数除法」运算符,让 day_idx 在各方言下都得到整数。
// MySQL 的 `/` 是浮点除法(返回 20607.0392,驱动给 []byte,扫进 int64 直接失败),
// 必须用 DIV;SQLite 与 PostgreSQL 对两个整数相除本就是整除。
func epochDayDivOperator() string {
	switch {
	case common.UsingMainDatabase(common.DatabaseTypePostgreSQL),
		common.UsingMainDatabase(common.DatabaseTypeSQLite):
		return "/"
	default:
		return "DIV"
	}
}

func dayStartUnix() int64 {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
}

// GetOperationsOverview 运营总览指标。
func GetOperationsOverview() (*OperationsOverview, error) {
	today := dayStartUnix()
	sevenDaysAgo := today - 7*86400

	o := &OperationsOverview{}
	if err := DB.Raw(
		`SELECT
			COUNT(*) AS total_users,
			SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_users_today,
			SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_users_7d,
			SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS disabled_users
		FROM users WHERE deleted_at IS NULL`,
		today, sevenDaysAgo,
	).Scan(o).Error; err != nil {
		return nil, err
	}

	if err := DB.Raw(
		`SELECT
			COUNT(DISTINCT CASE WHEN created_at >= ? THEN user_id END) AS active_today,
			COUNT(DISTINCT CASE WHEN created_at >= ? THEN user_id END) AS active_7d,
			SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS requests_today,
			COALESCE(SUM(CASE WHEN created_at >= ? THEN quota ELSE 0 END), 0) AS quota_today
		FROM logs WHERE type = ?`,
		today, sevenDaysAgo, today, today, LogTypeConsume,
	).Scan(o).Error; err != nil {
		return nil, err
	}
	return o, nil
}

// GetOperationsTrends 按天聚合新增用户 / 活跃用户 / 请求量 / 消耗。
// tzOffsetSeconds 为前端传入的本地时区偏移，保证"一天"按用户本地日切。
// day_idx = (created_at + tz) 整除 86400，前端还原为日期字符串。
// ⚠️ 整除必须走方言分支（见 epochDayDivOperator）：MySQL 的 `/` 是浮点除法，
// 会返回 20607.0392 这种值，驱动给回 []byte，扫进 int64 直接失败。
func GetOperationsTrends(days, tzOffsetSeconds int) ([]OperationsTrendRow, error) {
	if days <= 0 {
		days = 30
	}
	since := time.Now().Unix() - int64(days)*86400
	shift := int64(tzOffsetSeconds)

	dayDiv := epochDayDivOperator()

	var newUsers []OperationsTrendRow
	if err := DB.Raw(
		fmt.Sprintf(`SELECT ((created_at + ?) %s 86400) AS day_idx, COUNT(*) AS new_users
		FROM users WHERE deleted_at IS NULL AND created_at > ?
		GROUP BY day_idx`, dayDiv),
		shift, since,
	).Scan(&newUsers).Error; err != nil {
		return nil, err
	}

	var activity []OperationsTrendRow
	if err := DB.Raw(
		fmt.Sprintf(`SELECT ((created_at + ?) %s 86400) AS day_idx,
		       COUNT(DISTINCT user_id) AS active_users,
		       COUNT(*) AS requests,
		       COALESCE(SUM(quota), 0) AS quota
		FROM logs WHERE type = ? AND created_at > ?
		GROUP BY day_idx`, dayDiv),
		shift, LogTypeConsume, since,
	).Scan(&activity).Error; err != nil {
		return nil, err
	}

	merged := make(map[int64]*OperationsTrendRow)
	for _, r := range newUsers {
		row := merged[r.DayIdx]
		if row == nil {
			row = &OperationsTrendRow{DayIdx: r.DayIdx}
			merged[r.DayIdx] = row
		}
		row.NewUsers = r.NewUsers
	}
	for _, r := range activity {
		row := merged[r.DayIdx]
		if row == nil {
			row = &OperationsTrendRow{DayIdx: r.DayIdx}
			merged[r.DayIdx] = row
		}
		row.ActiveUsers = r.ActiveUsers
		row.Requests = r.Requests
		row.Quota = r.Quota
	}

	out := make([]OperationsTrendRow, 0, len(merged))
	for _, row := range merged {
		out = append(out, *row)
	}
	// 按 day_idx 升序。
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].DayIdx < out[i].DayIdx {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out, nil
}

// GetOperationsDistributions 注册来源 / 信任等级 / 分组分布。
func GetOperationsDistributions() (*OperationsDistributions, error) {
	d := &OperationsDistributions{}

	err := DB.Raw(
		`SELECT CASE
			WHEN linux_do_id <> '' THEN 'linuxdo'
			WHEN github_id <> '' THEN 'github'
			WHEN wechat_id <> '' THEN 'wechat'
			WHEN telegram_id <> '' THEN 'telegram'
			WHEN oidc_id <> '' THEN 'oidc'
			ELSE 'email'
		END AS row_key, COUNT(*) AS count
		FROM users WHERE deleted_at IS NULL
		GROUP BY row_key`,
	).Scan(&d.Sources).Error
	if err != nil {
		return nil, err
	}

	if err := DB.Raw(
		`SELECT linux_do_trust_level AS level, COUNT(*) AS count
		FROM users WHERE deleted_at IS NULL
		GROUP BY linux_do_trust_level`,
	).Scan(&d.TrustLevels).Error; err != nil {
		return nil, err
	}

	if err := DB.Raw(
		"SELECT `group` AS row_key, COUNT(*) AS count FROM users WHERE deleted_at IS NULL GROUP BY `group`",
	).Scan(&d.Groups).Error; err != nil {
		return nil, err
	}
	return d, nil
}

// GetOperationsRankings 时间范围内的模型与渠道用量排行（各取前 20）。
func GetOperationsRankings(days int) (*OperationsRankings, error) {
	if days <= 0 {
		days = 30
	}
	since := time.Now().Unix() - int64(days)*86400
	r := &OperationsRankings{}

	err := DB.Raw(
		`SELECT model_name AS row_key, model_name AS name,
		       COUNT(*) AS requests,
		       COALESCE(SUM(quota), 0) AS quota,
		       COUNT(DISTINCT user_id) AS users
		FROM logs
		WHERE type = ? AND created_at > ? AND model_name <> ''
		GROUP BY model_name
		ORDER BY requests DESC
		LIMIT 20`,
		LogTypeConsume, since,
	).Scan(&r.Models).Error
	if err != nil {
		return nil, err
	}

	err = DB.Raw(
		`SELECT l.channel_id AS row_key,
		       COALESCE(MAX(c.name), '') AS name,
		       COUNT(*) AS requests,
		       COALESCE(SUM(l.quota), 0) AS quota,
		       COUNT(DISTINCT l.user_id) AS users
		FROM logs l
		LEFT JOIN channels c ON c.id = l.channel_id
		WHERE l.type = ? AND l.created_at > ? AND l.channel_id > 0
		GROUP BY l.channel_id
		ORDER BY requests DESC
		LIMIT 20`,
		LogTypeConsume, since,
	).Scan(&r.Channels).Error
	if err != nil {
		return nil, err
	}
	return r, nil
}
