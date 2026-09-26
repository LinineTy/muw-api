// @muw-owned
package controller

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/model"
)

// OIDC 的审计与调用明细出口。
//
// 分工：
//   - 审计（audit_logs，category=security）只收安全事件 —— 授权请求成败、令牌
//     签发与失败、撤销、密钥与审核动作，也就是"谁对谁的凭据做了什么"，随站内
//     审计的清理策略走；
//   - 明细（oidc_access_logs）把每一次协议调用都收下（含 userinfo 这类高频只读），
//     带 IP / UA / 结果，供运营侧回答"谁在什么时候从哪个 IP 调了什么"。
//
// 两者都只记非密信息：token / code / secret / 授权请求原文一概不落库。
const (
	oidcActionAuthorize = "authorize"
	oidcActionToken     = "token"
	oidcActionRefresh   = "refresh"
	oidcActionUserInfo  = "userinfo"
	oidcActionRevoke    = "revoke"
)

// oidcRecordAudit 记一条安全事件；IP / UA / 路由 / 请求号由 RecordAuditLog 补齐。
func oidcRecordAudit(c *gin.Context, userId int, action string, success bool, content string) {
	model.RecordAuditLog(c, model.AuditLog{
		UserId:    userId,
		Username:  c.GetString("username"),
		ActorRole: c.GetInt("role"),
		Category:  model.AuditCategorySecurity,
		Action:    action,
		Success:   success,
		Content:   content,
	})
}

// oidcRecordAccess 记一条调用明细；失败不影响协议流程，仅忽略。
func oidcRecordAccess(c *gin.Context, entry model.OIDCAccessLog) {
	_ = model.RecordOIDCAccessLog(c, entry)
}

// oidcAccessEntry 组装明细：把"应用/用户/动作/scope/结果"这类每次都有的字段收在一处。
func oidcAccessEntry(c *gin.Context, clientId string, userId int, action string, scopes []string, errCode string, cause error) model.OIDCAccessLog {
	entry := model.OIDCAccessLog{
		ClientId:  clientId,
		UserId:    userId,
		Action:    action,
		Scopes:    strings.Join(scopes, " "),
		Success:   errCode == "",
		ErrorCode: errCode,
	}
	if cause != nil {
		entry.ErrorMsg = cause.Error()
	}
	return entry
}

// oidcGrantEntry 与 oidcAccessEntry 相同，额外带上 grant_type：换令牌这类动作
// 光看 action 分不出是首次换码还是刷新（明细表里也是空列，统计没法按授权类型拆）。
func oidcGrantEntry(c *gin.Context, clientId string, userId int, action, grantType string, scopes []string, errCode string, cause error) model.OIDCAccessLog {
	entry := oidcAccessEntry(c, clientId, userId, action, scopes, errCode, cause)
	entry.GrantType = grantType
	return entry
}

// oidcScopeSummary 审计正文里的 scope 摘要（截断，避免超长内容进审计表）。
func oidcScopeSummary(scopes []string) string {
	joined := strings.Join(scopes, " ")
	if len(joined) > 180 {
		return joined[:180] + "…"
	}
	return joined
}

// oidcAuditClient 审计正文里的应用标识。
func oidcAuditClient(clientId string) string { return "client=" + clientId }

// oidcUserRef 审计正文里的用户标识（协议端点上用户可能还没登录）。
func oidcUserRef(userId int) string { return "user_id=" + strconv.Itoa(userId) }
