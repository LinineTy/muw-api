// @muw-owned
package model

import "time"

// IpAnalysisUserRankRow 单用户的独立 IP 统计（风控视角）。
type IpAnalysisUserRankRow struct {
	UserId      int    `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Status      int    `json:"status"`
	IpCount     int64  `json:"ip_count"`
	RequestCnt  int64  `json:"request_count"`
	LastSeen    int64  `json:"last_seen"`
}

// IpAnalysisIpRankRow 单 IP 关联的账号数统计（小号集群视角）。
type IpAnalysisIpRankRow struct {
	Ip          string `json:"ip"`
	UserCount   int64  `json:"user_count"`
	RequestCnt  int64  `json:"request_count"`
	LastSeen    int64  `json:"last_seen"`
}

// IpAnalysisUserIpRow 某用户的 IP 使用明细。
type IpAnalysisUserIpRow struct {
	Ip         string `json:"ip"`
	RequestCnt int64  `json:"request_count"`
	FirstSeen  int64  `json:"first_seen"`
	LastSeen   int64  `json:"last_seen"`
}

// IpAnalysisIpUserRow 某 IP 关联的账号明细。
type IpAnalysisIpUserRow struct {
	UserId      int    `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Status      int    `json:"status"`
	RequestCnt  int64  `json:"request_count"`
	FirstSeen   int64  `json:"first_seen"`
	LastSeen    int64  `json:"last_seen"`
}

func ipAnalysisSince(days int) int64 {
	if days <= 0 {
		days = 30
	}
	return time.Now().Unix() - int64(days)*86400
}

// GetUserIpRank 统计每个用户的独立 IP 数，按 IP 数降序分页。
func GetUserIpRank(days, minIps, page, pageSize int) ([]IpAnalysisUserRankRow, int64, error) {
	since := ipAnalysisSince(days)
	if minIps < 1 {
		minIps = 1
	}

	var total int64
	err := DB.Raw(
		`SELECT COUNT(*) FROM (
			SELECT user_id FROM logs
			WHERE type = ? AND ip <> '' AND created_at > ?
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
		FROM logs l
		LEFT JOIN users u ON u.id = l.user_id
		WHERE l.type = ? AND l.ip <> '' AND l.created_at > ?
		GROUP BY l.user_id
		HAVING ip_count >= ?
		ORDER BY ip_count DESC, request_count DESC
		LIMIT ? OFFSET ?`,
		LogTypeConsume, since, minIps, pageSize, offset,
	).Scan(&rows).Error
	return rows, total, err
}

// GetUserIpDetail 返回某用户在时间范围内的 IP 使用明细。
func GetUserIpDetail(userId, days int) ([]IpAnalysisUserIpRow, error) {
	since := ipAnalysisSince(days)
	var rows []IpAnalysisUserIpRow
	err := DB.Raw(
		`SELECT ip,
		       COUNT(*) AS request_count,
		       MIN(created_at) AS first_seen,
		       MAX(created_at) AS last_seen
		FROM logs
		WHERE type = ? AND user_id = ? AND ip <> '' AND created_at > ?
		GROUP BY ip
		ORDER BY request_count DESC`,
		LogTypeConsume, userId, since,
	).Scan(&rows).Error
	return rows, err
}

// GetIpUserRank 统计每个 IP 关联的账号数，按账号数降序分页。
func GetIpUserRank(days, minUsers, page, pageSize int) ([]IpAnalysisIpRankRow, int64, error) {
	since := ipAnalysisSince(days)
	if minUsers < 1 {
		minUsers = 1
	}

	var total int64
	err := DB.Raw(
		`SELECT COUNT(*) FROM (
			SELECT ip FROM logs
			WHERE type = ? AND ip <> '' AND created_at > ?
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
		FROM logs
		WHERE type = ? AND ip <> '' AND created_at > ?
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
