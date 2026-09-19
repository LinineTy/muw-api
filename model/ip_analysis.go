// @muw-owned
package model

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// IpAnalysisUserRankRow 单用户的独立 IP 统计（风控视角）。
type IpAnalysisUserRankRow struct {
	UserId       int    `json:"user_id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Status       int    `json:"status"`
	IpCount      int64  `json:"ip_count"`
	RequestCount int64  `json:"request_count"`
	LastSeen     int64  `json:"last_seen"`
}

// IpAnalysisIpRankRow 单 IP 关联的账号数统计（小号集群视角）。
type IpAnalysisIpRankRow struct {
	Ip           string `json:"ip"`
	UserCount    int64  `json:"user_count"`
	RequestCount int64  `json:"request_count"`
	LastSeen     int64  `json:"last_seen"`
}

// IpAnalysisUserIpRow 某用户的 IP 使用明细。
type IpAnalysisUserIpRow struct {
	Ip           string `json:"ip"`
	RequestCount int64  `json:"request_count"`
	FirstSeen    int64  `json:"first_seen"`
	LastSeen     int64  `json:"last_seen"`
}

// IpAnalysisIpUserRow 某 IP 关联的账号明细。
type IpAnalysisIpUserRow struct {
	UserId       int    `json:"user_id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Status       int    `json:"status"`
	RequestCount int64  `json:"request_count"`
	FirstSeen    int64  `json:"first_seen"`
	LastSeen     int64  `json:"last_seen"`
}

// riskyIpThreshold 单用户独立 IP 数达到该值即视为异常。
// 与表格的「IP 数」标红阈值、分布图的 11-20 / 20+ 分桶保持同一口径。
const riskyIpThreshold = 10

func ipAnalysisSince(days int) int64 {
	if days <= 0 {
		days = 30
	}
	return time.Now().Unix() - int64(days)*86400
}

// ipAnalysisIndexHint 返回 logs 全量时间窗聚合查询的索引强制子句。
//
// 背景（生产实测，30 天窗口 / logs 约 23 万行）：`WHERE type = ? AND created_at > ?`
// 之后要按 user_id（或 ip）分组，优化器因"主键/外键索引可免排序"的估算选了
// idx_logs_user_id，实际退化成扫 229882 行、filtered 2.50% 并大规模回表：
// 按用户分组 9.4s、按 IP 分组 25.5s。强制走 idx_created_at_type（时间范围在前）
// 后降到 2.9s / 2.6s。
//
// 仅 MySQL 支持该语法；SQLite（开发栈）不支持也不需要，返回空串。
// 不要在单用户 / 单 IP 的明细查询上加（那些走 idx_logs_user_id / idx_logs_ip
// 是正确选择，强制时间索引反而变慢）。
func ipAnalysisIndexHint() string {
	if DB != nil && DB.Dialector.Name() == "mysql" {
		return " FORCE INDEX (idx_created_at_type)"
	}
	return ""
}

// ipVersionClause 返回 IPv4 / IPv6 过滤子句（列名固定为 ip，不需要额外参数）。
//
// 用途：IPv6 在隐私扩展下会高频轮换地址，同一来源能产生几十个"独立 IP"，
// 会让 ip_count 这类指标系统性虚高、跨用户不可比。只想比较 IPv4 行为时用 v4。
func ipVersionClause(version string) string {
	switch version {
	case "v4":
		return " AND ip NOT LIKE '%:%'"
	case "v6":
		return " AND ip LIKE '%:%'"
	default:
		return ""
	}
}

// GetUserIpRank 统计每个用户的独立 IP 数，按 IP 数降序分页。
// version 为 ""/all 时统计全部，v4 / v6 只统计对应协议的地址。
func GetUserIpRank(days, minIps int, version string, page, pageSize int) ([]IpAnalysisUserRankRow, int64, error) {
	since := ipAnalysisSince(days)
	if minIps < 1 {
		minIps = 1
	}
	v := ipVersionClause(version)

	var total int64
	err := DB.Raw(
		`SELECT COUNT(*) FROM (
			SELECT user_id FROM logs`+ipAnalysisIndexHint()+`
			WHERE type = ? AND ip <> '' AND created_at > ?`+v+`
			GROUP BY user_id HAVING COUNT(DISTINCT ip) >= ?
		) t`,
		LogTypeConsume, since, minIps,
	).Scan(&total).Error
	if err != nil {
		return nil, 0, err
	}

	var rows []IpAnalysisUserRankRow
	offset := (page - 1) * pageSize
	err = DB.Raw(
		`SELECT l.user_id,
		       MAX(l.username) AS username,
		       COALESCE(MAX(u.display_name), '') AS display_name,
		       COALESCE(MAX(u.status), 1) AS status,
		       COUNT(DISTINCT l.ip) AS ip_count,
		       COUNT(*) AS request_count,
		       MAX(l.created_at) AS last_seen
		FROM logs l`+ipAnalysisIndexHint()+`
		LEFT JOIN users u ON u.id = l.user_id
		WHERE l.type = ? AND l.ip <> '' AND l.created_at > ?`+v+`
		GROUP BY l.user_id
		HAVING ip_count >= ?
		ORDER BY ip_count DESC, request_count DESC
		LIMIT ? OFFSET ?`,
		LogTypeConsume, since, minIps, pageSize, offset,
	).Scan(&rows).Error
	return rows, total, err
}

// GetUserIpDetail 返回某用户在时间范围内的 IP 使用明细。
func GetUserIpDetail(userId, days int, version string) ([]IpAnalysisUserIpRow, error) {
	since := ipAnalysisSince(days)
	v := ipVersionClause(version)
	var rows []IpAnalysisUserIpRow
	err := DB.Raw(
		`SELECT ip,
		       COUNT(*) AS request_count,
		       MIN(created_at) AS first_seen,
		       MAX(created_at) AS last_seen
		FROM logs
		WHERE type = ? AND user_id = ? AND ip <> '' AND created_at > ?`+v+`
		GROUP BY ip
		ORDER BY request_count DESC`,
		LogTypeConsume, userId, since,
	).Scan(&rows).Error
	return rows, err
}

// GetIpUserRank 统计每个 IP 关联的账号数，按账号数降序分页。
func GetIpUserRank(days, minUsers int, version string, page, pageSize int) ([]IpAnalysisIpRankRow, int64, error) {
	since := ipAnalysisSince(days)
	if minUsers < 1 {
		minUsers = 1
	}
	v := ipVersionClause(version)

	var total int64
	err := DB.Raw(
		`SELECT COUNT(*) FROM (
			SELECT ip FROM logs`+ipAnalysisIndexHint()+`
			WHERE type = ? AND ip <> '' AND created_at > ?`+v+`
			GROUP BY ip HAVING COUNT(DISTINCT user_id) >= ?
		) t`,
		LogTypeConsume, since, minUsers,
	).Scan(&total).Error
	if err != nil {
		return nil, 0, err
	}

	var rows []IpAnalysisIpRankRow
	offset := (page - 1) * pageSize
	err = DB.Raw(
		`SELECT ip,
		       COUNT(DISTINCT user_id) AS user_count,
		       COUNT(*) AS request_count,
		       MAX(created_at) AS last_seen
		FROM logs`+ipAnalysisIndexHint()+`
		WHERE type = ? AND ip <> '' AND created_at > ?`+v+`
		GROUP BY ip
		HAVING user_count >= ?
		ORDER BY user_count DESC, request_count DESC
		LIMIT ? OFFSET ?`,
		LogTypeConsume, since, minUsers, pageSize, offset,
	).Scan(&rows).Error
	return rows, total, err
}

// GetIpDetail 返回某 IP 关联的账号明细（含各账号请求数）。
func GetIpDetail(ip string, days int) ([]IpAnalysisIpUserRow, error) {
	since := ipAnalysisSince(days)
	var rows []IpAnalysisIpUserRow
	err := DB.Raw(
		`SELECT l.user_id,
		       MAX(l.username) AS username,
		       COALESCE(MAX(u.display_name), '') AS display_name,
		       COALESCE(MAX(u.status), 1) AS status,
		       COUNT(*) AS request_count,
		       MIN(l.created_at) AS first_seen,
		       MAX(l.created_at) AS last_seen
		FROM logs l
		LEFT JOIN users u ON u.id = l.user_id
		WHERE l.type = ? AND l.ip = ? AND l.created_at > ?
		GROUP BY l.user_id
		ORDER BY request_count DESC`,
		LogTypeConsume, ip, since,
	).Scan(&rows).Error
	return rows, err
}

// IpAnalysisBucketRow 用户 IP 数分布里的一个分桶。
type IpAnalysisBucketRow struct {
	Bucket string `json:"bucket"`
	Users  int64  `json:"users"`
}

// IpAnalysisOverview 风控看板概览。
type IpAnalysisOverview struct {
	TotalIps      int64                 `json:"total_ips"`
	TotalUsers    int64                 `json:"total_users"`
	AvgIpsPerUser float64               `json:"avg_ips_per_user"`
	SharedIps     int64                 `json:"shared_ips"`
	RiskyUsers    int64                 `json:"risky_users"`
	V6Percent     float64               `json:"v6_percent"`
	Distribution  []IpAnalysisBucketRow `json:"distribution"`
}

// GetIpAnalysisOverview 汇总风控看板所需的各项指标。
//
// 实现要点：先一次查出窗口内去重后的 (user_id, ip) 对，再在内存里聚合出全部指标。
// 这样只有一次库扫描。若把每个指标各写成一条子查询，MySQL 上要跑五六次全表聚合
// （单次 2~3 秒，性能背景见 ipAnalysisIndexHint），页面会被拖垮。
// 数据规模：30 天窗口生产约数万对，内存聚合可忽略不计。
func GetIpAnalysisOverview(days int, version string) (*IpAnalysisOverview, error) {
	since := ipAnalysisSince(days)
	v := ipVersionClause(version)

	// 字段名要与 SQL 别名严格一致，否则 GORM 静默扫成零值（2026-09-19 请求数恒 0 的教训）。
	var pairs []struct {
		UserId int    `json:"user_id"`
		Ip     string `json:"ip"`
	}
	err := DB.Raw(
		`SELECT user_id, ip FROM logs`+ipAnalysisIndexHint()+`
		 WHERE type = ? AND ip <> '' AND created_at > ?`+v+`
		 GROUP BY user_id, ip`,
		LogTypeConsume, since,
	).Scan(&pairs).Error
	if err != nil {
		return nil, err
	}

	userIps := make(map[int]int, 1024)
	ipUsers := make(map[string]int, 1024)
	v6Pairs := 0
	for _, p := range pairs {
		userIps[p.UserId]++
		ipUsers[p.Ip]++
		if strings.Contains(p.Ip, ":") {
			v6Pairs++
		}
	}

	ov := &IpAnalysisOverview{
		TotalIps:   int64(len(ipUsers)),
		TotalUsers: int64(len(userIps)),
	}
	for _, c := range userIps {
		if c >= riskyIpThreshold {
			ov.RiskyUsers++
		}
	}
	for _, u := range ipUsers {
		if u >= 2 {
			ov.SharedIps++
		}
	}
	if len(userIps) > 0 {
		ov.AvgIpsPerUser = math.Round(float64(len(pairs))/float64(len(userIps))*100) / 100
	}
	if len(pairs) > 0 {
		ov.V6Percent = math.Round(float64(v6Pairs)/float64(len(pairs))*1000) / 10
	}

	// 分桶固定返回五档（含 0），前端直接照数组画柱状图，与 ipBadgeThreshold 的
	// "≥10 个 IP 标红"保持同一套口径。
	for _, b := range []struct {
		name string
		lo   int
		hi   int
	}{
		{"1", 1, 1},
		{"2-5", 2, 5},
		{"6-10", 6, 10},
		{"11-20", 11, 20},
		{"20+", 21, math.MaxInt32},
	} {
		var n int64
		for _, c := range userIps {
			if c >= b.lo && c <= b.hi {
				n++
			}
		}
		ov.Distribution = append(ov.Distribution, IpAnalysisBucketRow{Bucket: b.name, Users: n})
	}
	return ov, nil
}

// IpAnalysisTrendRow 单日独立 IP 数（day_idx 语义同运营趋势，前端还原成日期）。
type IpAnalysisTrendRow struct {
	DayIdx int64 `json:"day_idx" gorm:"column:day_idx"`
	Ips    int64 `json:"ips" gorm:"column:ips"`
}

// GetIpAnalysisTrend 按天统计窗口内的独立 IP 数。
func GetIpAnalysisTrend(days, tzOffsetSeconds int, version string) ([]IpAnalysisTrendRow, error) {
	since := ipAnalysisSince(days)
	v := ipVersionClause(version)

	var rows []IpAnalysisTrendRow
	err := DB.Raw(
		fmt.Sprintf(`SELECT ((created_at + ?) %s 86400) AS day_idx,
		       COUNT(DISTINCT ip) AS ips
		FROM logs`+ipAnalysisIndexHint()+`
		WHERE type = ? AND ip <> '' AND created_at > ?`+v+`
		GROUP BY day_idx
		ORDER BY day_idx`, epochDayDivOperator()),
		tzOffsetSeconds, LogTypeConsume, since,
	).Scan(&rows).Error
	return rows, err
}
