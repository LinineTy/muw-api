// @muw-owned
package model

import (
	"math"
	"net/netip"
	"sort"
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

// ipMergeKey 返回聚合键：mergeV6 且是 IPv6 时归并到 /64 前缀（形如
// `2409:8a28:c12:c214::/64`），其余一律返回原地址。
//
// 为什么需要它：IPv6 隐私扩展（RFC 4941）会让同一台设备高频更换接口标识，
// 30 天窗口里同一个来源能产生几十个"独立 IP"，把 ip_count、独立 IP 数、人均 IP 数
// 系统性吹大；而运营商实际上是把一个 /64（甚至更大）分给一个用户的，
// 所以按 /64 归并才接近"同一个来源"的真实口径。IPv4 不用归并（地址即身份）。
//
// 不做成默认口径：归并会改变"IP 数"这个指标的历史可比性，由调用方按开关选择。
func ipMergeKey(ip string, mergeV6 bool) string {
	if !mergeV6 || !strings.Contains(ip, ":") {
		return ip
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	if addr.Is4() || addr.Is4In6() {
		// IPv4 与 4-in-6 映射地址（v4 客户端走 v6 socket 时会出现）不归并：
		// 它们全部会落进 "::/64" 这一个桶，等于把不同来源混在一起。
		return ip
	}
	prefix, err := addr.Prefix(64)
	if err != nil {
		return ip
	}
	return prefix.Masked().String()
}

// ipMergeKeyFromLabel 把查询里传进来的"归并标签"规范化成 ipMergeKey 的键。
// 前端在归并模式下会把 `…::/64` 这样的标签原样回传（点"查看"查明细），
// 这里统一按同一个键比较；非标签、非 IPv6 的值按原地址处理。
func ipMergeKeyFromLabel(label string) string {
	if !strings.Contains(label, "/") {
		return ipMergeKey(label, true)
	}
	if prefix, err := netip.ParsePrefix(label); err == nil {
		return prefix.Masked().String()
	}
	return label
}

// ipPairAgg 窗口内一个 (user_id, ip) 对的使用统计。
type ipPairAgg struct {
	UserId    int
	Ip        string
	Requests  int64
	FirstSeen int64
	LastSeen  int64
}

// loadIpPairAggs 取窗口内 (user_id, ip) 粒度的聚合行，供 /64 归并模式在内存里二次聚合。
//
// 为什么放内存而不是写 SQL：前缀归并跨方言写法不通用（MySQL 有 INET6_ATON，
// SQLite 没有），内存聚合两边行为一致、也好写测试。代价与概览页同量级——
// 它本来就一次拉全窗口的去重对（生产 30 天几万行）。
//
// 必须用 Rows() 手动遍历：这个行数量级走 GORM Scan 会挂死（见 GetIpOverlapPairs 注释）。
func loadIpPairAggs(since int64, versionClause string) ([]ipPairAgg, error) {
	rows, err := DB.Raw(
		`SELECT user_id, ip, COUNT(*) AS requests,
		        MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
		FROM logs`+ipAnalysisIndexHint()+`
		WHERE type = ? AND ip <> '' AND created_at > ?`+versionClause+`
		GROUP BY user_id, ip`,
		LogTypeConsume, since,
	).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	pairs := make([]ipPairAgg, 0, 4096)
	for rows.Next() {
		var p ipPairAgg
		if err := rows.Scan(&p.UserId, &p.Ip, &p.Requests, &p.FirstSeen, &p.LastSeen); err != nil {
			return nil, err
		}
		pairs = append(pairs, p)
	}
	return pairs, rows.Err()
}

// paginateSlice 对内存里已排好序的切片分页（SQL 分页由 LIMIT/OFFSET 承担）。
func paginateSlice[T any](rows []T, page, pageSize int) []T {
	offset := (page - 1) * pageSize
	if offset >= len(rows) {
		return []T{}
	}
	end := offset + pageSize
	if end > len(rows) {
		end = len(rows)
	}
	return rows[offset:end]
}

// fillUserViews 给内存聚合出来的行补用户名/展示名/状态。
// SQL 路径靠 JOIN users 拿这三列，内存路径单独查一次（只查当前页的用户）。
func fillUserViews(rows []IpAnalysisUserRankRow) error {
	if len(rows) == 0 {
		return nil
	}
	ids := make([]int, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].UserId)
	}
	var users []struct {
		Id          int
		Username    string
		DisplayName string
		Status      int
	}
	if err := DB.Model(&User{}).
		Select("id, username, display_name, status").
		Where("id IN ?", ids).
		Scan(&users).Error; err != nil {
		return err
	}
	idx := make(map[int]int, len(users))
	for i, u := range users {
		idx[u.Id] = i
	}
	for i := range rows {
		if j, ok := idx[rows[i].UserId]; ok {
			rows[i].Username = users[j].Username
			rows[i].DisplayName = users[j].DisplayName
			rows[i].Status = users[j].Status
		}
	}
	return nil
}

// GetUserIpRank 统计每个用户的独立 IP 数，按 IP 数降序分页。
// version 为 ""/all 时统计全部，v4 / v6 只统计对应协议的地址。
// mergeV6 为真时把 IPv6 归并到 /64（见 ipMergeKey）。
func GetUserIpRank(days, minIps int, version string, mergeV6 bool, page, pageSize int) ([]IpAnalysisUserRankRow, int64, error) {
	since := ipAnalysisSince(days)
	if minIps < 1 {
		minIps = 1
	}
	v := ipVersionClause(version)
	if mergeV6 {
		return getUserIpRankMerged(since, minIps, v, page, pageSize)
	}

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

// getUserIpRankMerged /64 归并版用户排行：SQL 只到 (user_id, ip) 粒度，
// 前缀聚合、阈值过滤、排序、分页都在内存做（理由见 loadIpPairAggs）。
func getUserIpRankMerged(since int64, minIps int, versionClause string, page, pageSize int) ([]IpAnalysisUserRankRow, int64, error) {
	pairs, err := loadIpPairAggs(since, versionClause)
	if err != nil {
		return nil, 0, err
	}

	type userAgg struct {
		keys     map[string]struct{}
		requests int64
		lastSeen int64
	}
	byUser := make(map[int]*userAgg, 512)
	for i := range pairs {
		p := &pairs[i]
		a, ok := byUser[p.UserId]
		if !ok {
			a = &userAgg{keys: make(map[string]struct{}, 8)}
			byUser[p.UserId] = a
		}
		a.keys[ipMergeKey(p.Ip, true)] = struct{}{}
		a.requests += p.Requests
		if p.LastSeen > a.lastSeen {
			a.lastSeen = p.LastSeen
		}
	}

	rows := make([]IpAnalysisUserRankRow, 0, len(byUser))
	for userId, a := range byUser {
		if len(a.keys) < minIps {
			continue
		}
		rows = append(rows, IpAnalysisUserRankRow{
			UserId:       userId,
			IpCount:      int64(len(a.keys)),
			RequestCount: a.requests,
			LastSeen:     a.lastSeen,
			Status:       1,
		})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].IpCount != rows[j].IpCount {
			return rows[i].IpCount > rows[j].IpCount
		}
		return rows[i].RequestCount > rows[j].RequestCount
	})
	total := int64(len(rows))
	rows = paginateSlice(rows, page, pageSize)
	if err := fillUserViews(rows); err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// GetUserIpDetail 返回某用户在时间范围内的 IP 使用明细。
// mergeV6 为真时同 /64 的地址合并成一行（请求数相加、首末时间取极值）。
func GetUserIpDetail(userId, days int, version string, mergeV6 bool) ([]IpAnalysisUserIpRow, error) {
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
	if err != nil || !mergeV6 {
		return rows, err
	}
	// 明细只有几十行，直接内存归并（IP 数比 /64 前缀数多得多）
	return mergeUserIpDetail(rows), nil
}

// mergeUserIpDetail 把同一用户下同 /64 的明细行合并成一行。
func mergeUserIpDetail(rows []IpAnalysisUserIpRow) []IpAnalysisUserIpRow {
	merged := make(map[string]*IpAnalysisUserIpRow, len(rows))
	for i := range rows {
		r := &rows[i]
		key := ipMergeKey(r.Ip, true)
		m, ok := merged[key]
		if !ok {
			merged[key] = &IpAnalysisUserIpRow{
				Ip:           key,
				RequestCount: r.RequestCount,
				FirstSeen:    r.FirstSeen,
				LastSeen:     r.LastSeen,
			}
			continue
		}
		m.RequestCount += r.RequestCount
		if r.FirstSeen < m.FirstSeen {
			m.FirstSeen = r.FirstSeen
		}
		if r.LastSeen > m.LastSeen {
			m.LastSeen = r.LastSeen
		}
	}
	out := make([]IpAnalysisUserIpRow, 0, len(merged))
	for _, m := range merged {
		out = append(out, *m)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].RequestCount > out[j].RequestCount
	})
	return out
}

// GetIpUserRank 统计每个 IP 关联的账号数，按账号数降序分页。
// mergeV6 为真时把 IPv6 归并到 /64（同一运营商 /64 下的地址算一个来源）。
func GetIpUserRank(days, minUsers int, version string, mergeV6 bool, page, pageSize int) ([]IpAnalysisIpRankRow, int64, error) {
	since := ipAnalysisSince(days)
	if minUsers < 1 {
		minUsers = 1
	}
	v := ipVersionClause(version)
	if mergeV6 {
		return getIpUserRankMerged(since, minUsers, v, page, pageSize)
	}

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

// getIpUserRankMerged /64 归并版 IP 排行：同 /64 的地址合成一行，
// 账号数按去重后的 user_id 算（同一个账号在该前缀下换了几个地址只算 1）。
func getIpUserRankMerged(since int64, minUsers int, versionClause string, page, pageSize int) ([]IpAnalysisIpRankRow, int64, error) {
	pairs, err := loadIpPairAggs(since, versionClause)
	if err != nil {
		return nil, 0, err
	}

	type keyAgg struct {
		users    map[int]struct{}
		requests int64
		lastSeen int64
	}
	byKey := make(map[string]*keyAgg, 1024)
	for i := range pairs {
		p := &pairs[i]
		key := ipMergeKey(p.Ip, true)
		a, ok := byKey[key]
		if !ok {
			a = &keyAgg{users: make(map[int]struct{}, 4)}
			byKey[key] = a
		}
		a.users[p.UserId] = struct{}{}
		a.requests += p.Requests
		if p.LastSeen > a.lastSeen {
			a.lastSeen = p.LastSeen
		}
	}

	rows := make([]IpAnalysisIpRankRow, 0, len(byKey))
	for key, a := range byKey {
		if len(a.users) < minUsers {
			continue
		}
		rows = append(rows, IpAnalysisIpRankRow{
			Ip:           key,
			UserCount:    int64(len(a.users)),
			RequestCount: a.requests,
			LastSeen:     a.lastSeen,
		})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].UserCount != rows[j].UserCount {
			return rows[i].UserCount > rows[j].UserCount
		}
		return rows[i].RequestCount > rows[j].RequestCount
	})
	total := int64(len(rows))
	return paginateSlice(rows, page, pageSize), total, nil
}

// GetIpDetail 返回某 IP 关联的账号明细（含各账号请求数）。
// mergeV6 为真时 ip 可以是一个 `/64` 标签（前端在归并模式下传回来的那串），
// 此时列出该前缀下所有地址关联的账号（按账号去重聚合）。
func GetIpDetail(ip string, days int, mergeV6 bool) ([]IpAnalysisIpUserRow, error) {
	since := ipAnalysisSince(days)
	if mergeV6 {
		return getIpDetailMerged(ip, since)
	}
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

// getIpDetailMerged /64 标签的账号明细：拉窗口内的 (user_id, ip) 聚合行，
// 按同一个归并键筛出该前缀下的地址，再按账号聚合。
//
// 为什么不在 SQL 里按前缀过滤：IPv6 文本形式不唯一（压缩、前导零），
// `LIKE '前缀%'` 会漏；归并键本来就只在 Go 侧算，这里复用同一套判定。
func getIpDetailMerged(label string, since int64) ([]IpAnalysisIpUserRow, error) {
	key := ipMergeKeyFromLabel(label)
	pairs, err := loadIpPairAggs(since, "")
	if err != nil {
		return nil, err
	}

	type userAgg struct {
		requests  int64
		firstSeen int64
		lastSeen  int64
	}
	byUser := make(map[int]*userAgg, 16)
	for i := range pairs {
		p := &pairs[i]
		if ipMergeKey(p.Ip, true) != key {
			continue
		}
		a, ok := byUser[p.UserId]
		if !ok {
			a = &userAgg{requests: 0, firstSeen: p.FirstSeen, lastSeen: p.LastSeen}
			byUser[p.UserId] = a
		}
		a.requests += p.Requests
		if p.FirstSeen < a.firstSeen {
			a.firstSeen = p.FirstSeen
		}
		if p.LastSeen > a.lastSeen {
			a.lastSeen = p.LastSeen
		}
	}

	rows := make([]IpAnalysisIpUserRow, 0, len(byUser))
	for userId, a := range byUser {
		rows = append(rows, IpAnalysisIpUserRow{
			UserId:       userId,
			Status:       1,
			RequestCount: a.requests,
			FirstSeen:    a.firstSeen,
			LastSeen:     a.lastSeen,
		})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].RequestCount > rows[j].RequestCount
	})
	if err := fillIpUserViews(rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// fillIpUserViews 给账号明细补用户名/展示名/状态（SQL 路径靠 JOIN，这里单独查一次）。
func fillIpUserViews(rows []IpAnalysisIpUserRow) error {
	if len(rows) == 0 {
		return nil
	}
	ids := make([]int, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].UserId)
	}
	var users []struct {
		Id          int
		Username    string
		DisplayName string
		Status      int
	}
	if err := DB.Model(&User{}).
		Select("id, username, display_name, status").
		Where("id IN ?", ids).
		Scan(&users).Error; err != nil {
		return err
	}
	byId := make(map[int]int, len(users))
	for i, u := range users {
		byId[u.Id] = i
	}
	for i := range rows {
		if j, ok := byId[rows[i].UserId]; ok {
			rows[i].Username = users[j].Username
			rows[i].DisplayName = users[j].DisplayName
			rows[i].Status = users[j].Status
		}
	}
	return nil
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
func GetIpAnalysisOverview(days int, version string, mergeV6 bool) (*IpAnalysisOverview, error) {
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

	// 归并口径从这里开始统一：key 在 mergeV6 关闭时就是原地址，两条路径共用一套聚合。
	userKeys := make(map[int]map[string]struct{}, 1024)
	v6Pairs := 0
	for _, p := range pairs {
		key := ipMergeKey(p.Ip, mergeV6)
		keys, ok := userKeys[p.UserId]
		if !ok {
			keys = make(map[string]struct{}, 8)
			userKeys[p.UserId] = keys
		}
		keys[key] = struct{}{}
		if strings.Contains(p.Ip, ":") {
			v6Pairs++
		}
	}

	// 一个 key 关联几个账号：必须按 (key, user) 去重后数。
	// 直接数 (user_id, ip) 对会把"同一用户在同一个 /64 下轮换的多个地址"也算成多账号
	// （归并打开时 SharedIps 会被凭空放大，2026-09-20 自测发现的）。
	keyUsers := make(map[string]int, 1024)
	for _, keys := range userKeys {
		for key := range keys {
			keyUsers[key]++
		}
	}

	ov := &IpAnalysisOverview{
		TotalIps:   int64(len(keyUsers)),
		TotalUsers: int64(len(userKeys)),
	}
	totalPerUser := 0
	for _, keys := range userKeys {
		totalPerUser += len(keys)
		if len(keys) >= riskyIpThreshold {
			ov.RiskyUsers++
		}
	}
	for _, u := range keyUsers {
		if u >= 2 {
			ov.SharedIps++
		}
	}
	if len(userKeys) > 0 {
		ov.AvgIpsPerUser = math.Round(float64(totalPerUser)/float64(len(userKeys))*100) / 100
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
		for _, keys := range userKeys {
			c := len(keys)
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
// mergeV6 为真时每天的"独立 IP 数"按 /64 归并后去重（SQL 的 COUNT(DISTINCT ip)
// 换不来这个语义，只能取原始行回 Go 里按归并键去重；量级与重合检测的取数一致）。
func GetIpAnalysisTrend(days, tzOffsetSeconds int, version string, mergeV6 bool) ([]IpAnalysisTrendRow, error) {
	since := ipAnalysisSince(days)
	v := ipVersionClause(version)
	if mergeV6 {
		return getIpAnalysisTrendMerged(since, tzOffsetSeconds, v)
	}

	// ⚠️ 整除运算符用字符串拼接，不要用 fmt.Sprintf：v（IP 协议过滤）里含
	// `LIKE '%:%'`，一旦整体作为格式串交给 fmt，`%` 会被当成动词解析成
	// `%!:(MISSING)` 原样拼进 SQL ⇒ MySQL 1064（2026-09-19 生产事故，
	// 只在 v4/v6 筛选下复现，"全部 IP" 完全正常）。
	dayDiv := epochDayDivOperator()

	var rows []IpAnalysisTrendRow
	err := DB.Raw(
		`SELECT ((created_at + ?) `+dayDiv+` 86400) AS day_idx,
		       COUNT(DISTINCT ip) AS ips
		FROM logs`+ipAnalysisIndexHint()+`
		WHERE type = ? AND ip <> '' AND created_at > ?`+v+`
		GROUP BY day_idx
		ORDER BY day_idx`,
		tzOffsetSeconds, LogTypeConsume, since,
	).Scan(&rows).Error
	return rows, err
}

// getIpAnalysisTrendMerged /64 归并版趋势：取窗口内的 (created_at, ip) 原始行，
// 在 Go 里按天 + 归并键去重。
func getIpAnalysisTrendMerged(since int64, tzOffsetSeconds int, versionClause string) ([]IpAnalysisTrendRow, error) {
	rows, err := DB.Raw(
		`SELECT created_at, ip FROM logs`+ipAnalysisIndexHint()+`
		WHERE type = ? AND ip <> '' AND created_at > ?`+versionClause,
		LogTypeConsume, since,
	).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// 手动遍历：行数到万级时 GORM Scan 会挂死（见 GetIpOverlapPairs 注释）
	dayKeys := make(map[int64]map[string]struct{}, 128)
	for rows.Next() {
		var ts int64
		var ip string
		if err := rows.Scan(&ts, &ip); err != nil {
			return nil, err
		}
		day := (ts + int64(tzOffsetSeconds)) / 86400
		keys, ok := dayKeys[day]
		if !ok {
			keys = make(map[string]struct{}, 256)
			dayKeys[day] = keys
		}
		keys[ipMergeKey(ip, true)] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]IpAnalysisTrendRow, 0, len(dayKeys))
	for day, keys := range dayKeys {
		out = append(out, IpAnalysisTrendRow{DayIdx: day, Ips: int64(len(keys))})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].DayIdx < out[j].DayIdx })
	return out, nil
}

// IpOverlapRow 一对账号的时段重合统计。
type IpOverlapRow struct {
	UserIdA   int     `json:"user_id_a"`
	UsernameA string  `json:"username_a"`
	ActiveA   int64   `json:"active_a"`
	UserIdB   int     `json:"user_id_b"`
	UsernameB string  `json:"username_b"`
	ActiveB   int64   `json:"active_b"`
	Overlap   int64   `json:"overlap"`
	Expected  float64 `json:"expected"`
	Ratio     float64 `json:"ratio"`
}

// GetIpOverlapPairs 找出「同时活跃度显著高于随机期望」的账号对。
//
// 判据：实测重合分钟数 ÷ 随机期望，其中期望 = activeA × activeB ÷ 窗口总分钟数。
// 两个独立用户在同一分钟同时活跃是低概率事件，实测显著超出期望即说明两号背后
// 是同一批人。
//
// 刻意不用 IP：代理轮换与 CDN 会让 IP 维度严重失真（同一出口池被成百账号共用），
// 而时间维度不受这两者影响。
//
// 实现上只做一次库查询取出 (user_id, 分钟序号) 去重对，其余全在内存算；
// 先按活跃分钟数筛掉轻量用户，否则两两配对量过大且噪声高。
func GetIpOverlapPairs(days, minActiveMinutes, minOverlap, limit int) ([]IpOverlapRow, error) {
	if days <= 0 {
		days = 30
	}
	if minActiveMinutes < 1 {
		minActiveMinutes = 1
	}
	if minOverlap < 1 {
		minOverlap = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}

	since := time.Now().Unix() - int64(days)*86400
	windowMinutes := float64(days) * 1440

	// 注意两点，都是踩过的坑：
	//  1. 不要用 GORM 的 Scan 拉大结果集——同样的 SQL 用 Scan 收 9.8 万行会挂死
	//     （>60s 不返回），换成 Rows() 手动遍历只要 1.4s。行数可能上万，必须手动。
	//  2. 不要在 SQL 里做「分钟」换算再 GROUP BY：MySQL 的 / 是小数除法，
	//     `created_at / 60` 得到 DECIMAL，分组几乎失效（去重率 18% vs 正确做法 62%）；
	//     而 SQLite 的 / 是整数除法，两个方言语义还不一致。改成取原始 created_at
	//     回 Go 里除，跨方言行为统一。
	rows, err := DB.Raw(
		`SELECT user_id, created_at FROM logs WHERE type = ? AND created_at > ?`,
		LogTypeConsume, since,
	).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// user -> 该用户活跃的分钟序号集合（顺便天然去重，active 就是集合大小）。
	minuteSets := make(map[int]map[int64]struct{})
	for rows.Next() {
		var uid int
		var ts int64
		if err := rows.Scan(&uid, &ts); err != nil {
			return nil, err
		}
		set, ok := minuteSets[uid]
		if !ok {
			set = make(map[int64]struct{})
			minuteSets[uid] = set
		}
		set[ts/60] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	active := make(map[int]int64, len(minuteSets))
	for uid, set := range minuteSets {
		active[uid] = int64(len(set))
	}
	qualified := make(map[int]bool, len(active))
	for uid, n := range active {
		if n >= int64(minActiveMinutes) {
			qualified[uid] = true
		}
	}
	if len(qualified) < 2 {
		return []IpOverlapRow{}, nil
	}

	// 按分钟归集合格用户，再对每分钟内的用户两两累计重合次数。
	byMinute := make(map[int64][]int)
	for uid, set := range minuteSets {
		if !qualified[uid] {
			continue
		}
		for m := range set {
			byMinute[m] = append(byMinute[m], uid)
		}
	}

	type pairKey struct{ a, b int }
	overlap := make(map[pairKey]int64)
	for _, users := range byMinute {
		for i := 0; i < len(users); i++ {
			for j := i + 1; j < len(users); j++ {
				a, b := users[i], users[j]
				if a > b {
					a, b = b, a
				}
				overlap[pairKey{a, b}]++
			}
		}
	}

	// 只保留显著高于期望的对子（重合还不如随机的说明两号没关系）。
	//
	// 光看倍数会让小样本虚高：活跃 122 分钟 × 341 分钟的两个用户碰巧同分钟 25 次，
	// 期望只有 1 分钟，倍数 26 —— 排到真实可疑对前面去。所以另设一道重合分钟下限，
	// 把「偶发撞车」和「长期同步」分开。
	result := make([]IpOverlapRow, 0, len(overlap))
	for k, ov := range overlap {
		expected := float64(active[k.a]) * float64(active[k.b]) / windowMinutes
		if expected <= 0 || float64(ov) <= expected {
			continue
		}
		if ov < int64(minOverlap) {
			continue
		}
		result = append(result, IpOverlapRow{
			UserIdA: k.a, ActiveA: active[k.a],
			UserIdB: k.b, ActiveB: active[k.b],
			Overlap:  ov,
			Expected: math.Round(expected*10) / 10,
			Ratio:    math.Round(float64(ov)/expected*10) / 10,
		})
	}
	if len(result) == 0 {
		return []IpOverlapRow{}, nil
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Ratio != result[j].Ratio {
			return result[i].Ratio > result[j].Ratio
		}
		return result[i].Overlap > result[j].Overlap
	})
	if len(result) > limit {
		result = result[:limit]
	}

	// 补账号名。
	ids := make([]int, 0, len(result)*2)
	seen := make(map[int]bool, len(result)*2)
	for _, r := range result {
		for _, id := range []int{r.UserIdA, r.UserIdB} {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	var users []struct {
		Id          int    `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
	}
	if err := DB.Table("users").
		Select("id, username, display_name").
		Where("id IN ?", ids).
		Scan(&users).Error; err != nil {
		return nil, err
	}
	names := make(map[int]string, len(users))
	for _, u := range users {
		n := u.Username
		if u.DisplayName != "" && u.DisplayName != u.Username {
			n = u.Username + " (" + u.DisplayName + ")"
		}
		names[u.Id] = n
	}
	for i := range result {
		result[i].UsernameA = names[result[i].UserIdA]
		result[i].UsernameB = names[result[i].UserIdB]
	}
	return result, nil
}
