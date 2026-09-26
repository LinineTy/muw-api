// @muw-owned
package model

import (
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// OIDC 的用量统计。数据来自两张表：
//   - oidc_access_logs：每一次协议调用（谁、哪个应用、什么动作、成没成、从哪来）；
//   - oidc_usage_stats：按 (应用, 用户) 记的令牌签发计数（不受审计清理策略影响）。
//
// 口径分两档，不能混：
//   - 管理员（scope=all）：全站；
//   - 站内用户（scope=self）：只看"我创建的应用被怎么用"。终端用户的身份（user_id）
//     与来源（IP / UA）不在这一档的返回里 —— 站内用户对应用只有使用权。
//
// ⚠️ ClientIds 为空时语义由 ClientIdsEmpty 决定：为 true 表示"限定这些应用但一个都
// 没有"（结果必须是 0），为 false 才是"不限应用"。少了这个区分，空集合会静默退化成
// 全站（等于越权读到别人的数据）。
type OIDCUsageScope struct {
	ClientIds      []string
	ClientIdsEmpty bool
}

// OIDCUsageScopeForClients 由 client_id 列表构造口径：空列表自动带上"不许退化成全站"。
func OIDCUsageScopeForClients(clientIds []string) OIDCUsageScope {
	return OIDCUsageScope{ClientIds: clientIds, ClientIdsEmpty: len(clientIds) == 0}
}

// OIDCUsageScopeAll 是不限应用的全站口径（仅管理员）。
func OIDCUsageScopeAll() OIDCUsageScope { return OIDCUsageScope{} }

func (s OIDCUsageScope) apply(query *gorm.DB) *gorm.DB {
	if len(s.ClientIds) > 0 {
		return query.Where("client_id IN ?", s.ClientIds)
	}
	if s.ClientIdsEmpty {
		return query.Where("1 = 0")
	}
	return query
}

// OIDCUsageTotals 是一段时间内的调用汇总。
type OIDCUsageTotals struct {
	Calls       int64 `json:"calls"`
	FailedCalls int64 `json:"failed_calls"`
	ActiveUsers int64 `json:"active_users"`
	LastCallAt  int64 `json:"last_call_at"`
}

// OIDCUsageSummary 是统计接口的返回体。Applications / Authorizations 在
// scope=self 时是"我创建的应用数 / 我授权过的站点数"，其余字段都是调用侧的口径。
type OIDCUsageSummary struct {
	Applications   int64 `json:"applications"`
	Authorizations int64 `json:"authorizations"`
	TokenIssued    int64 `json:"token_issued"`
	LastIssuedAt   int64 `json:"last_issued_at"`
	OIDCUsageTotals
}

// OIDCUsageForUser 站内用户视角：我的应用 + 我授权过的站点 + 这些应用的使用情况。
func OIDCUsageForUser(userId int) (*OIDCUsageSummary, error) {
	summary := &OIDCUsageSummary{}
	if err := DB.Model(&OIDCClient{}).Where("owner_user_id = ?", userId).Count(&summary.Applications).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&OIDCConsent{}).Where("user_id = ?", userId).Count(&summary.Authorizations).Error; err != nil {
		return nil, err
	}
	clients, err := ListOIDCClientsByOwner(userId)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(clients))
	for _, client := range clients {
		ids = append(ids, client.ClientId)
	}
	scope := OIDCUsageScopeForClients(ids)
	totals, err := OIDCUsageTotalsFor(scope, 0)
	if err != nil {
		return nil, err
	}
	summary.OIDCUsageTotals = *totals
	tokens, lastIssued, err := OIDCTokenUsageFor(scope)
	if err != nil {
		return nil, err
	}
	summary.TokenIssued, summary.LastIssuedAt = tokens, lastIssued
	return summary, nil
}

// OIDCUsageAll 管理员的全站视角。
func OIDCUsageAll() (*OIDCUsageSummary, error) {
	summary := &OIDCUsageSummary{}
	if err := DB.Model(&OIDCClient{}).Count(&summary.Applications).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&OIDCConsent{}).Count(&summary.Authorizations).Error; err != nil {
		return nil, err
	}
	scope := OIDCUsageScopeAll()
	totals, err := OIDCUsageTotalsFor(scope, 0)
	if err != nil {
		return nil, err
	}
	summary.OIDCUsageTotals = *totals
	tokens, lastIssued, err := OIDCTokenUsageFor(scope)
	if err != nil {
		return nil, err
	}
	summary.TokenIssued, summary.LastIssuedAt = tokens, lastIssued
	return summary, nil
}

// OIDCUsageTotalsFor 汇总明细：调用数 / 失败数 / 去重用户数 / 最近一次调用时间。
// since > 0 时只统计该时间戳之后（用于趋势与失败分布）。
func OIDCUsageTotalsFor(scope OIDCUsageScope, since int64) (*OIDCUsageTotals, error) {
	totals := &OIDCUsageTotals{}
	base := func() *gorm.DB {
		query := scope.apply(DB.Model(&OIDCAccessLog{}))
		if since > 0 {
			query = query.Where("created_at >= ?", since)
		}
		return query
	}
	if err := base().Count(&totals.Calls).Error; err != nil {
		return nil, err
	}
	if err := base().Where("success = ?", false).Count(&totals.FailedCalls).Error; err != nil {
		return nil, err
	}
	// 只数 user_id > 0：授权端点那一行没有身份（浏览器裸跳转），不该被算成"一个用户"。
	if err := base().Where("user_id > 0").Distinct("user_id").Count(&totals.ActiveUsers).Error; err != nil {
		return nil, err
	}
	var last struct{ Last int64 }
	if err := base().Select("COALESCE(MAX(created_at), 0) AS last").Scan(&last).Error; err != nil {
		return nil, err
	}
	totals.LastCallAt = last.Last
	return totals, nil
}

// OIDCTokenUsageFor 汇总令牌签发计数（来自 oidc_usage_stats，与明细表互相印证）。
func OIDCTokenUsageFor(scope OIDCUsageScope) (total int64, last int64, err error) {
	query := DB.Model(&OIDCUsageStat{})
	if len(scope.ClientIds) > 0 {
		query = query.Where("client_id IN ?", scope.ClientIds)
	} else if scope.ClientIdsEmpty {
		query = query.Where("1 = 0")
	}
	var row struct {
		Total int64
		Last  int64
	}
	if err := query.Select("COALESCE(SUM(token_count), 0) AS total, COALESCE(MAX(last_issued_at), 0) AS last").Scan(&row).Error; err != nil {
		return 0, 0, err
	}
	return row.Total, row.Last, nil
}

// OIDCApplicationUsageRow 是按应用聚合的一行（应用名由调用方补）。
type OIDCApplicationUsageRow struct {
	ClientId    string `json:"client_id"`
	Calls       int64  `json:"calls"`
	FailedCalls int64  `json:"failed_calls"`
	ActiveUsers int64  `json:"active_users"`
	LastCallAt  int64  `json:"last_call_at"`
}

// OIDCApplicationUsageRows 按应用聚合调用明细，按调用量倒序。
func OIDCApplicationUsageRows(scope OIDCUsageScope, limit int) ([]*OIDCApplicationUsageRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows []*OIDCApplicationUsageRow
	err := scope.apply(DB.Model(&OIDCAccessLog{})).
		Select("client_id, COUNT(*) AS calls, " +
			"SUM(CASE WHEN success = false THEN 1 ELSE 0 END) AS failed_calls, " +
			"COUNT(DISTINCT CASE WHEN user_id > 0 THEN user_id END) AS active_users, " +
			"COALESCE(MAX(created_at), 0) AS last_call_at").
		Group("client_id").
		Order("calls DESC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

// OIDCDailyUsageRow 是按天聚合的一行（day 是 YYYY-MM-DD）。
type OIDCDailyUsageRow struct {
	Day    string `json:"day"`
	Calls  int64  `json:"calls"`
	Failed int64  `json:"failed"`
}

// OIDCDailyUsageRows 按天聚合调用明细。tzOffsetSeconds 是展示时区相对 UTC 的偏移
// （+08:00 传 28800）：分桶要按用户看到的"天"切，不能按 UTC 切。
func OIDCDailyUsageRows(scope OIDCUsageScope, since int64, tzOffsetSeconds int64) ([]*OIDCDailyUsageRow, error) {
	// 三种库的整数除法语义不同（MySQL 的 / 出小数），显式取整。
	bucket := "(created_at + " + strconv.FormatInt(tzOffsetSeconds, 10) + ") / 86400"
	switch common.MainDatabaseType() {
	case common.DatabaseTypeMySQL, common.DatabaseTypePostgreSQL:
		bucket = "FLOOR((created_at + " + strconv.FormatInt(tzOffsetSeconds, 10) + ") / 86400)"
	}
	var raw []struct {
		Bucket int64
		Calls  int64
		Failed int64
	}
	err := scope.apply(DB.Model(&OIDCAccessLog{})).
		Select(bucket+" AS bucket, COUNT(*) AS calls, SUM(CASE WHEN success = false THEN 1 ELSE 0 END) AS failed").
		Where("created_at >= ?", since).
		Group("bucket").
		Order("bucket").
		Scan(&raw).Error
	if err != nil {
		return nil, err
	}
	rows := make([]*OIDCDailyUsageRow, 0, len(raw))
	for _, item := range raw {
		// 分桶序号是"加了偏移之后的天序号"：第 N 桶覆盖 ts ∈ [N*86400-offset, (N+1)*86400-offset)，
		// 换算成北京时间的 00:00~24:00 恰好就是 UTC 日历上的第 N 天 ⇒ 直接按 UTC 还原日期，
		// 不要再减偏移（减了会整体前移一天）。
		day := time.Unix(item.Bucket*86400, 0).UTC().Format("2006-01-02")
		rows = append(rows, &OIDCDailyUsageRow{Day: day, Calls: item.Calls, Failed: item.Failed})
	}
	return rows, nil
}

// OIDCErrorUsageRow 是失败原因分布的一行。
type OIDCErrorUsageRow struct {
	ErrorCode string `json:"error_code"`
	Count     int64  `json:"count"`
}

// OIDCErrorUsageRows 统计失败原因 Top（error_code 为空的老数据不参与）。
func OIDCErrorUsageRows(scope OIDCUsageScope, since int64, limit int) ([]*OIDCErrorUsageRow, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	query := scope.apply(DB.Model(&OIDCAccessLog{})).
		Select("error_code, COUNT(*) AS count").
		Where("success = ? AND error_code <> ''", false)
	if since > 0 {
		query = query.Where("created_at >= ?", since)
	}
	var rows []*OIDCErrorUsageRow
	err := query.Group("error_code").Order("count DESC").Limit(limit).Scan(&rows).Error
	return rows, err
}
