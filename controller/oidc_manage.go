// @muw-owned
package controller

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

// OIDC Provider 的管理接口：站内用户申请与自助授权管理、管理员审核、同意页的预览与决策。
// 管理动作由鉴权链路的审计兜底自动留痕；涉及授权的用户动作在这里显式记 security 审计。

// oidcScopeSummaries 是同意页展示用的 scope 列表（描述文案在前端 i18n 里）。
var oidcScopeSummaries = []string{
	service.OIDCScopeOpenID,
	service.OIDCScopeProfile,
	service.OIDCScopeEmail,
	service.OIDCScopeGroup,
	service.OIDCScopeOfflineAccess,
}

// OIDCConsentPreview 给同意页渲染用：应用是谁、要哪些 scope、当前用户能否使用该应用。
func OIDCConsentPreview(c *gin.Context) {
	claims, err := service.OIDCParseAuthorizeRequestToken(c.Query("request"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	client, err := service.OIDCGetApprovedClient(claims.ClientId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		common.ApiErrorMsg(c, "登录状态已失效")
		return
	}
	userStatus, err := model.GetUserCache(identity.UserID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !service.OIDCClientAllowsUser(client, userStatus) {
		common.ApiErrorMsg(c, "当前账号不在该应用允许的范围内")
		return
	}
	owner := ""
	if ownerUser, err := model.GetUserById(client.OwnerUserId, false); err == nil && ownerUser != nil {
		owner = ownerUser.Username
	}
	consent, err := model.GetOIDCConsent(identity.UserID, client.ClientId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	silent := consent != nil && consent.Silent
	common.ApiSuccess(c, gin.H{
		"client_id":       client.ClientId,
		"client_name":     client.Name,
		"client_icon_url": client.IconUrl,
		"homepage_url":    client.HomepageUrl,
		"description":     client.Description,
		"owner_username":  owner,
		"redirect_host":   oidcRedirectHost(claims.RedirectUri),
		"scopes":          claims.Scopes,
		"scope_catalog":   oidcScopeSummaries,
		"remember_silent": silent,
	})
}

func oidcRedirectHost(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return raw
	}
	return parsed.Host
}

// OIDCConsentDecision 处理同意页的「同意 / 拒绝」：同意则建/更新授权并签发授权码，
// 返回给前端一个可跳转的回调地址（前端负责跳回第三方应用）。
func OIDCConsentDecision(c *gin.Context) {
	var req struct {
		Request string `json:"request"`
		Approve bool   `json:"approve"`
		Silent  bool   `json:"silent"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	claims, err := service.OIDCParseAuthorizeRequestToken(req.Request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		common.ApiErrorMsg(c, "登录状态已失效")
		return
	}
	client, err := service.OIDCGetApprovedClient(claims.ClientId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userStatus, err := model.GetUserCache(identity.UserID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !service.OIDCClientAllowsUser(client, userStatus) {
		common.ApiErrorMsg(c, "当前账号不在该应用允许的范围内")
		return
	}
	if !req.Approve {
		oidcRecordConsentAudit(c, identity.UserID, client.ClientId, false, "")
		common.ApiSuccess(c, gin.H{"redirect_url": oidcAuthorizationRedirect(claims.RedirectUri, claims.State, "access_denied", "用户拒绝了授权", "")})
		return
	}
	if err := model.UpsertOIDCConsent(identity.UserID, client.ClientId, strings.Join(claims.Scopes, " "), req.Silent); err != nil {
		common.ApiError(c, err)
		return
	}
	code, err := service.OIDCIssueAuthCode(client, identity.UserID, identity.SessionID, claims.RedirectUri, claims.Scopes, claims.Nonce, service.OIDCAuthorizeRequest{
		CodeChallenge:       claims.CodeChallenge,
		CodeChallengeMethod: claims.CodeChallengeMethod,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	oidcRecordConsentAudit(c, identity.UserID, client.ClientId, true, strings.Join(claims.Scopes, " "))
	common.ApiSuccess(c, gin.H{"redirect_url": oidcAuthorizationRedirect(claims.RedirectUri, claims.State, "", "", code)})
}

// oidcAuthorizationRedirect 按 OAuth 规范拼回跳地址（成功带 code，失败带 error，state 原样带回）。
func oidcAuthorizationRedirect(redirectUri, state, errCode, errDescription, code string) string {
	parsed, err := url.Parse(redirectUri)
	if err != nil {
		return redirectUri
	}
	query := parsed.Query()
	if errCode != "" {
		query.Set("error", errCode)
		if errDescription != "" {
			query.Set("error_description", errDescription)
		}
	}
	if code != "" {
		query.Set("code", code)
	}
	if state != "" {
		query.Set("state", state)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func oidcRecordConsentAudit(c *gin.Context, userId int, clientId string, approved bool, scopes string) {
	action := "oidc_consent_denied"
	if approved {
		action = "oidc_consent_granted"
	}
	model.RecordAuditLog(c, model.AuditLog{
		UserId:    userId,
		Username:  c.GetString("username"),
		ActorRole: c.GetInt("role"),
		Category:  model.AuditCategorySecurity,
		Action:    action,
		Success:   approved,
		Content:   "client=" + clientId + " scopes=" + scopes,
	})
}

// ---- 站内用户：申请与自助管理 ----

// OIDCListMyApplications 返回当前用户申请过的应用（含审核状态与驳回原因）。
func OIDCListMyApplications(c *gin.Context) {
	userId := c.GetInt("id")
	clients, err := model.ListOIDCClientsByOwner(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(clients))
	for _, client := range clients {
		items = append(items, gin.H{
			"id":            client.Id,
			"client_id":     client.ClientId,
			"name":          client.Name,
			"description":   client.Description,
			"client_type":   client.ClientType,
			"status":        client.Status,
			"scopes":        client.ScopeList(),
			"redirect_uris": client.RedirectUriList(),
			"review_note":   client.ReviewNote,
			"created_at":    client.CreatedAt,
			"last_used_at":  client.LastUsedAt,
		})
	}
	common.ApiSuccess(c, gin.H{"items": items, "scope_catalog": oidcScopeSummaries})
}

// OIDCSubmitApplication 提交申请（pending 状态，批准前不可用）。
func OIDCSubmitApplication(c *gin.Context) {
	var req service.OIDCApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	client, err := service.OIDCSubmitApplication(c.GetInt("id"), req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": client.Id, "client_id": client.ClientId, "status": client.Status})
}

// OIDCListConsents 我的授权列表（"我授权过哪些应用"）。
func OIDCListConsents(c *gin.Context) {
	userId := c.GetInt("id")
	consents, err := model.ListOIDCConsentsByUser(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(consents))
	for _, consent := range consents {
		client, err := model.GetOIDCClientByClientId(consent.ClientId)
		name := consent.ClientId
		if err == nil && client != nil {
			name = client.Name
		}
		items = append(items, gin.H{
			"client_id":   consent.ClientId,
			"client_name": name,
			"scopes":      consent.ScopeList(),
			"silent":      consent.Silent,
			"updated_at":  consent.UpdatedAt,
		})
	}
	common.ApiSuccess(c, gin.H{"items": items})
}

// OIDCUpdateConsentSilent 切换"以后不再询问"（默认不询问用户时每次弹同意页）。
func OIDCUpdateConsentSilent(c *gin.Context) {
	var req struct {
		ClientId string `json:"client_id"`
		Silent   bool   `json:"silent"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ClientId) == "" {
		common.ApiErrorMsg(c, "client_id 不能为空")
		return
	}
	userId := c.GetInt("id")
	if consent, err := model.GetOIDCConsent(userId, req.ClientId); err != nil {
		common.ApiError(c, err)
		return
	} else if consent == nil {
		common.ApiErrorMsg(c, "尚未授权该应用")
		return
	}
	if err := model.UpdateOIDCConsentSilent(userId, req.ClientId, req.Silent); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// OIDCRevokeConsent 撤销授权：删授权记录并让该应用已发的刷新令牌全部失效。
func OIDCRevokeConsent(c *gin.Context) {
	clientId := strings.TrimSpace(c.Param("clientId"))
	userId := c.GetInt("id")
	if clientId == "" {
		common.ApiErrorMsg(c, "client_id 不能为空")
		return
	}
	if err := model.DeleteOIDCConsent(userId, clientId); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.RevokeOIDCRefreshTokensByUserClient(userId, clientId, common.GetTimestamp()); err != nil {
		common.ApiError(c, err)
		return
	}
	oidcRecordConsentAudit(c, userId, clientId, false, "revoked")
	common.ApiSuccess(c, nil)
}

// ---- 管理员：审核与应用管理 ----

func OIDCAdminListApplications(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	clients, total, err := model.ListOIDCClients(status, (page-1)*pageSize, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(clients))
	for _, client := range clients {
		owner := ""
		if ownerUser, err := model.GetUserById(client.OwnerUserId, false); err == nil && ownerUser != nil {
			owner = ownerUser.Username
		}
		items = append(items, gin.H{
			"id":             client.Id,
			"client_id":      client.ClientId,
			"name":           client.Name,
			"description":    client.Description,
			"client_type":    client.ClientType,
			"status":         client.Status,
			"scopes":         client.ScopeList(),
			"redirect_uris":  client.RedirectUriList(),
			"allowed_groups": client.AllowedGroupList(),
			"owner_username": owner,
			"apply_reason":   client.ApplyReason,
			"review_note":    client.ReviewNote,
			"created_at":     client.CreatedAt,
			"reviewed_at":    client.ReviewedAt,
			"last_used_at":   client.LastUsedAt,
		})
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// OIDCAdminReviewApplication 批准（可当场改 scope/回调地址/分组限制）或驳回。
// 批准 confidential 应用时，明文密钥只在此响应里出现一次。
func OIDCAdminReviewApplication(c *gin.Context) {
	var req struct {
		Action        string   `json:"action"`
		Scopes        []string `json:"scopes"`
		RedirectUris  []string `json:"redirect_uris"`
		AllowedGroups []string `json:"allowed_groups"`
		Note          string   `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "应用 id 不合法")
		return
	}
	reviewerId := c.GetInt("id")
	switch req.Action {
	case "approve":
		// 密钥不进这里：管理员只看元数据，密钥由申请人在自己页面查看/重置。
		client, err := service.OIDCApproveApplication(id, reviewerId, req.Scopes, req.RedirectUris, req.AllowedGroups)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"client_id": client.ClientId, "status": client.Status})
	case "reject":
		if err := service.OIDCRejectApplication(id, reviewerId, req.Note); err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, nil)
	default:
		common.ApiErrorMsg(c, "action 只能是 approve 或 reject")
	}
}

// OIDCAdminUpdateApplicationStatus 启用 / 禁用已批准的应用（禁用同时撤销其刷新令牌）。
func OIDCAdminUpdateApplicationStatus(c *gin.Context) {
	var req struct {
		Action string `json:"action"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "应用 id 不合法")
		return
	}
	var status string
	switch req.Action {
	case "approve":
		status = model.OIDCClientStatusApproved
	case "disable":
		status = model.OIDCClientStatusDisabled
	default:
		common.ApiErrorMsg(c, "action 只能是 approve 或 disable")
		return
	}
	if err := service.OIDCUpdateClientStatus(id, c.GetInt("id"), status, req.Note); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// OIDCAdminDeleteApplication 删除应用（连带清理授权与令牌）。
func OIDCAdminDeleteApplication(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "应用 id 不合法")
		return
	}
	if err := service.OIDCDeleteApplication(id); err != nil {
		common.ApiError(c, err)
		return
	}
	c.Status(http.StatusOK)
}

// OIDCRevealApplicationSecret 申请人查看自己 confidential 应用的密钥（每次查看记审计）。
func OIDCRevealApplicationSecret(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "应用 id 不合法")
		return
	}
	userId := c.GetInt("id")
	secret, err := service.OIDCRevealClientSecret(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	oidcRecordSecretAudit(c, userId, id, "oidc_client_secret_viewed")
	common.ApiSuccess(c, gin.H{"client_secret": secret})
}

// OIDCRotateApplicationSecret 申请人重置自己应用的密钥（旧密钥立即失效）。
func OIDCRotateApplicationSecret(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "应用 id 不合法")
		return
	}
	userId := c.GetInt("id")
	secret, err := service.OIDCRotateClientSecret(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	oidcRecordSecretAudit(c, userId, id, "oidc_client_secret_rotated")
	common.ApiSuccess(c, gin.H{"client_secret": secret})
}

func oidcRecordSecretAudit(c *gin.Context, userId, clientDbId int, action string) {
	model.RecordAuditLog(c, model.AuditLog{
		UserId:    userId,
		Username:  c.GetString("username"),
		ActorRole: c.GetInt("role"),
		Category:  model.AuditCategorySecurity,
		Action:    action,
		Success:   true,
		Content:   "application_id=" + strconv.Itoa(clientDbId),
	})
}

// OIDCUpdateApplication 申请人（或管理员）改应用资料；回调地址被申请人改动会退回待审核。
func OIDCUpdateApplication(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "应用 id 不合法")
		return
	}
	var req struct {
		Name         string   `json:"name"`
		Description  string   `json:"description"`
		HomepageUrl  string   `json:"homepage_url"`
		IconUrl      string   `json:"icon_url"`
		RedirectUris []string `json:"redirect_uris"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	role := c.GetInt("role")
	client, err := service.OIDCUpdateApplicationProfile(id, c.GetInt("id"), service.OIDCApplicationProfile{
		Name: req.Name, Description: req.Description, HomepageUrl: req.HomepageUrl,
		IconUrl: req.IconUrl, RedirectUris: req.RedirectUris,
	}, role >= common.RoleAdminUser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"status": client.Status, "client_id": client.ClientId})
}

// OIDCDeleteApplicationSelf 申请人删除自己的应用（管理员也允许）。
func OIDCDeleteApplicationSelf(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "应用 id 不合法")
		return
	}
	role := c.GetInt("role")
	if err := service.OIDCDeleteOwnApplication(id, c.GetInt("id"), role >= common.RoleAdminUser); err != nil {
		common.ApiError(c, err)
		return
	}
	oidcRecordConsentAudit(c, c.GetInt("id"), strconv.Itoa(id), false, "application_deleted")
	common.ApiSuccess(c, nil)
}

// OIDCApplicationUsage 应用详情页的"谁在用"列表（申请人本人或管理员）。
func OIDCApplicationUsage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "应用 id 不合法")
		return
	}
	client, err := model.GetOIDCClientById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	role := c.GetInt("role")
	if role < common.RoleAdminUser && client.OwnerUserId != c.GetInt("id") {
		common.ApiErrorMsg(c, "只能查看自己应用的使用记录")
		return
	}
	rows, err := model.OIDCApplicationUsage(client.ClientId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, gin.H{"user_id": row.UserId, "token_count": row.TokenCount, "last_issued_at": row.LastIssuedAt})
	}
	common.ApiSuccess(c, gin.H{"items": items})
}

// OIDCUsageStats 统计：scope=self 只看自己；scope=all 仅管理员可用（照数据统计的做法）。
func OIDCUsageStats(c *gin.Context) {
	scope := strings.TrimSpace(c.DefaultQuery("scope", "self"))
	if scope == "all" && c.GetInt("role") < common.RoleAdminUser {
		common.ApiErrorMsg(c, "只有管理员可以查看全站统计")
		return
	}
	summary, err := service.OIDCUsageSummaryFor(scope, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}
