// @muw-owned
package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// OIDCAccessLog 记 OIDC 协议端点上的每一次调用（授权、换令牌、用户信息、撤销）。
//
// 与 audit_logs 的分工：审计只收"安全事件"（授权成败、密钥与审核动作），
// 明细把每一次调用都收下，包括 userinfo 这类高频只读。分开的理由是保留策略
// 不同 —— 审计随站内审计的清理策略走，而"谁在什么时候从哪个 IP 用哪个应用
// 调了什么"需要长期可查，不能被清理策略带走。
type OIDCAccessLog struct {
	Id        int    `json:"id"`
	ClientId  string `json:"client_id" gorm:"type:varchar(64);index:idx_oidc_access_client_time,priority:1;index"`
	UserId    int    `json:"user_id" gorm:"index:idx_oidc_access_user_time,priority:1;index"`
	Action    string `json:"action" gorm:"type:varchar(32);index"` // authorize / token / refresh / userinfo / revoke
	GrantType string `json:"grant_type" gorm:"type:varchar(32)"`   // authorization_code / refresh_token
	Scopes    string `json:"scopes" gorm:"type:varchar(255)"`
	Ip        string `json:"ip" gorm:"type:varchar(64);index"`
	UserAgent string `json:"user_agent" gorm:"type:varchar(512)"`
	Success   bool   `json:"success" gorm:"index"`
	ErrorCode string `json:"error_code" gorm:"type:varchar(64)"`
	ErrorMsg  string `json:"error_message" gorm:"type:varchar(255)"`
	RequestId string `json:"request_id" gorm:"type:varchar(64);index"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;index:idx_oidc_access_client_time,priority:2;index:idx_oidc_access_user_time,priority:2;index"`
}

func (OIDCAccessLog) TableName() string { return "oidc_access_logs" }

// RecordOIDCAccessLog 落一条调用明细（IP / UA / 请求号从请求上下文取）。
// 调用方忽略返回的错误：明细不该影响协议流程。
func RecordOIDCAccessLog(c *gin.Context, entry OIDCAccessLog) error {
	if c != nil && c.Request != nil {
		entry.Ip = c.ClientIP()
		entry.UserAgent = c.Request.UserAgent()
		entry.RequestId = c.GetString(common.RequestIdKey)
	}
	if entry.CreatedAt == 0 {
		entry.CreatedAt = common.GetTimestamp()
	}
	if len(entry.ErrorMsg) > 255 {
		entry.ErrorMsg = entry.ErrorMsg[:255]
	}
	if len(entry.ErrorCode) > 64 {
		entry.ErrorCode = entry.ErrorCode[:64]
	}
	return DB.Create(&entry).Error
}

// OIDCAccessLogFilter 明细查询条件；ClientIds 为空表示不限应用（管理员视角），
// 非空表示只看这些应用（普通用户看自己申请的）。
type OIDCAccessLogFilter struct {
	ClientId       string
	ClientIds      []string
	ClientIdsEmpty bool // 调用方要求"限定应用但一个都没有"时置位，避免退化成不限
	UserId         int
	Action         string
	Success        *bool
	StartTimestamp int64
	EndTimestamp   int64
	Offset         int
	Limit          int
}

func (f OIDCAccessLogFilter) apply(query *gorm.DB) *gorm.DB {
	if f.ClientId != "" {
		query = query.Where("client_id = ?", f.ClientId)
	}
	if len(f.ClientIds) > 0 {
		query = query.Where("client_id IN ?", f.ClientIds)
	} else if f.ClientIdsEmpty {
		query = query.Where("1 = 0")
	}
	if f.UserId > 0 {
		query = query.Where("user_id = ?", f.UserId)
	}
	if f.Action != "" {
		query = query.Where("action = ?", f.Action)
	}
	if f.Success != nil {
		query = query.Where("success = ?", *f.Success)
	}
	if f.StartTimestamp > 0 {
		query = query.Where("created_at >= ?", f.StartTimestamp)
	}
	if f.EndTimestamp > 0 {
		query = query.Where("created_at <= ?", f.EndTimestamp)
	}
	return query
}

// ListOIDCAccessLogs 按时间倒序分页取明细，同时返回总数。
func ListOIDCAccessLogs(filter OIDCAccessLogFilter) ([]*OIDCAccessLog, int64, error) {
	var total int64
	if err := filter.apply(DB.Model(&OIDCAccessLog{})).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []*OIDCAccessLog
	query := filter.apply(DB.Model(&OIDCAccessLog{})).Order("id desc")
	if filter.Limit > 0 {
		query = query.Offset(filter.Offset).Limit(filter.Limit)
	}
	if err := query.Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	return logs, total, nil
}

// OIDCAccessLogSummary 明细的汇总视图：调用总数、成功数、涉及的应用数与用户数。
type OIDCAccessLogSummary struct {
	TotalCalls    int64 `json:"total_calls"`
	FailedCalls   int64 `json:"failed_calls"`
	ActiveClients int64 `json:"active_clients"`
	ActiveUsers   int64 `json:"active_users"`
}

// SummarizeOIDCAccessLogs 给统计卡片用。
func SummarizeOIDCAccessLogs(filter OIDCAccessLogFilter) (*OIDCAccessLogSummary, error) {
	summary := &OIDCAccessLogSummary{}
	base := func() *gorm.DB { return filter.apply(DB.Model(&OIDCAccessLog{})) }
	if err := base().Count(&summary.TotalCalls).Error; err != nil {
		return nil, err
	}
	if err := base().Where("success = ?", false).Count(&summary.FailedCalls).Error; err != nil {
		return nil, err
	}
	if err := base().Distinct("client_id").Count(&summary.ActiveClients).Error; err != nil {
		return nil, err
	}
	if err := base().Where("user_id > 0").Distinct("user_id").Count(&summary.ActiveUsers).Error; err != nil {
		return nil, err
	}
	return summary, nil
}

// EnsureOIDCAccessLogTable 幂等建明细表（存量库会走"跳过 AutoMigrate"的路径）。
func EnsureOIDCAccessLogTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&OIDCAccessLog{}) {
		return nil
	}
	return db.Migrator().CreateTable(&OIDCAccessLog{})
}
