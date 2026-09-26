// @muw-owned
package controller

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

// OIDC Provider 的协议端点：发现文档、公钥集、授权、令牌、用户信息、撤销。
// 这些端点都必须显式注册路由——未注册的路径会落进 /api 的 NoRoute 兜底。
const oidcConsentRoute = "/oauth/consent"

// OIDCDiscovery 提供发现文档：第三方填一个 issuer 就能拿到全部端点。
func OIDCDiscovery(c *gin.Context) {
	issuer, err := service.OIDCIssuer()
	if err != nil {
		oidcProtocolError(c, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, gin.H{
		"issuer":                                issuer,
		"authorization_endpoint":                issuer + "/oauth/authorize",
		"token_endpoint":                        issuer + "/oauth/token",
		"userinfo_endpoint":                     issuer + "/oauth/userinfo",
		"jwks_uri":                              issuer + "/oauth/jwks.json",
		"revocation_endpoint":                   issuer + "/oauth/revoke",
		"scopes_supported":                      service.OIDCSupportedScopes(),
		"response_types_supported":              []string{service.OIDCResponseTypeCode},
		"response_modes_supported":              []string{"query"},
		"grant_types_supported":                 []string{service.OIDCGrantAuthorization, service.OIDCGrantRefresh},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post", "none"},
		"code_challenge_methods_supported":      []string{service.OIDCPKCEMethodS256},
		"claims_supported":                      []string{"sub", "preferred_username", "name", "picture", "email", "email_verified", "group"},
	})
}

// OIDCJWKS 提供公钥集（只含公钥；轮换期新旧密钥并存）。
func OIDCJWKS(c *gin.Context) {
	document, err := service.OIDCJWKS()
	if err != nil {
		oidcProtocolError(c, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, document)
}

// OIDCAuthorize 校验授权请求后把浏览器交给前端同意页。
// 参数用服务端签名的一次性凭据传递，用户改不动 scope/state/nonce。
func OIDCAuthorize(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	req := service.OIDCAuthorizeRequest{
		ClientId:            c.Query("client_id"),
		RedirectUri:         c.Query("redirect_uri"),
		ResponseType:        c.Query("response_type"),
		Scopes:              strings.Fields(c.Query("scope")),
		State:               c.Query("state"),
		Nonce:               c.Query("nonce"),
		CodeChallenge:       c.Query("code_challenge"),
		CodeChallengeMethod: c.Query("code_challenge_method"),
		Prompt:              c.Query("prompt"),
	}
	client, scopes, err := service.OIDCValidateAuthorize(req)
	if err != nil {
		oidcRecordAccess(c, oidcAccessEntry(c, req.ClientId, 0, oidcActionAuthorize, req.Scopes, "invalid_request", err))
		oidcRecordAudit(c, 0, "oidc_authorize_rejected", false, oidcAuditClient(req.ClientId)+" reason="+err.Error())
		// 回调地址不可信时绝不重定向（否则成了开放重定向），直接返回错误。
		var approved *model.OIDCClient
		if client != nil && client.MatchesRedirectUri(req.RedirectUri) {
			approved = client
		}
		if approved != nil {
			c.Redirect(http.StatusFound, oidcErrorRedirect(req.RedirectUri, req.State, err))
			return
		}
		oidcProtocolError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	// 浏览器绑定：同意页必须拿得出这个 Cookie 才算"同一次流程"，防止别人捡走这次
	// 授权请求（凭据在 URL 里）后用另一个浏览器替他点「允许」。授权端点拿不到登录态
	// （会话凭据是 JS 里的 Bearer + Path=/api/user/auth 的 Strict 刷新 Cookie），
	// 所以这里只能绑"浏览器"，绑不了"人"；人的绑定在决策环节用会话做。
	flowIdHash, err := service.OIDCIssueFlowCookie(c)
	if err != nil {
		oidcProtocolError(c, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	// 明细里的 user_id 在这一步恒为 0：授权端点是浏览器裸跳转，没有身份。真正的
	// "谁同意了什么"记在决策环节（oidc_consent_granted）与换令牌那一行。
	oidcRecordAccess(c, oidcAccessEntry(c, client.ClientId, 0, oidcActionAuthorize, scopes, "", nil))
	oidcRecordAudit(c, 0, "oidc_authorize_requested", true,
		oidcAuditClient(client.ClientId)+" scopes="+oidcScopeSummary(scopes))
	requestToken, err := service.OIDCIssueAuthorizeRequestToken(client, req, scopes, 0, flowIdHash)
	if err != nil {
		oidcProtocolError(c, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	c.Redirect(http.StatusFound, oidcConsentRoute+"?request="+url.QueryEscape(requestToken))
}

// oidcErrorRedirect 按 OAuth 规范把错误回给应用（state 原样带回）。
func oidcErrorRedirect(redirectUri, state string, cause error) string {
	parsed, err := url.Parse(redirectUri)
	if err != nil {
		return redirectUri
	}
	query := parsed.Query()
	query.Set("error", "invalid_request")
	query.Set("error_description", cause.Error())
	if state != "" {
		query.Set("state", state)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

// OIDCToken 换发令牌：authorization_code / refresh_token 两种授权类型。
func OIDCToken(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	clientId, clientSecret := oidcClientCredentials(c)
	client, err := service.OIDCGetApprovedClient(clientId)
	if err != nil || !service.OIDCVerifyClientSecret(client, clientSecret) {
		oidcRecordAccess(c, oidcAccessEntry(c, clientId, 0, oidcActionToken, nil, "invalid_client", nil))
		oidcRecordAudit(c, 0, "oidc_token_failed", false, oidcAuditClient(clientId)+" reason=客户端凭据校验失败")
		oidcTokenError(c, http.StatusUnauthorized, "invalid_client", "客户端凭据校验失败")
		return
	}
	switch c.PostForm("grant_type") {
	case service.OIDCGrantAuthorization:
		oidcExchangeAuthorizationCode(c, client)
	case service.OIDCGrantRefresh:
		result, err := service.OIDCRefreshTokens(client, c.PostForm("refresh_token"))
		if err != nil {
			oidcRecordAccess(c, oidcGrantEntry(c, client.ClientId, 0, oidcActionRefresh, service.OIDCGrantRefresh, nil, "invalid_grant", err))
			oidcRecordAudit(c, 0, "oidc_token_failed", false,
				oidcAuditClient(client.ClientId)+" grant=refresh_token reason="+err.Error())
			oidcTokenError(c, http.StatusBadRequest, "invalid_grant", err.Error())
			return
		}
		oidcRecordAccess(c, oidcGrantEntry(c, client.ClientId, result.UserId, oidcActionRefresh, service.OIDCGrantRefresh, result.Scopes, "", nil))
		oidcRecordAudit(c, result.UserId, "oidc_token_refreshed", true,
			oidcAuditClient(client.ClientId)+" "+oidcUserRef(result.UserId))
		c.JSON(http.StatusOK, result)
	default:
		oidcTokenError(c, http.StatusBadRequest, "unsupported_grant_type", "只支持 authorization_code 与 refresh_token")
	}
}

func oidcExchangeAuthorizationCode(c *gin.Context, client *model.OIDCClient) {
	code, err := service.OIDCRedeemAuthCode(c.PostForm("code"), client.ClientId, c.PostForm("redirect_uri"), c.PostForm("code_verifier"))
	if err != nil {
		// code 是一次性凭据，重放/伪造都走这里：明细只记结果，不记 code 原文。
		oidcRecordAccess(c, oidcGrantEntry(c, client.ClientId, 0, oidcActionToken, service.OIDCGrantAuthorization, nil, "invalid_grant", err))
		oidcRecordAudit(c, 0, "oidc_token_failed", false,
			oidcAuditClient(client.ClientId)+" grant=authorization_code reason="+err.Error())
		oidcTokenError(c, http.StatusBadRequest, "invalid_grant", err.Error())
		return
	}
	identity, err := service.ValidateSessionReference(code.UserId, code.SessionId)
	if err != nil {
		oidcRecordAccess(c, oidcGrantEntry(c, client.ClientId, code.UserId, oidcActionToken, service.OIDCGrantAuthorization, strings.Fields(code.Scopes), "invalid_grant", err))
		oidcRecordAudit(c, code.UserId, "oidc_token_failed", false,
			oidcAuditClient(client.ClientId)+" grant=authorization_code reason=登录会话已失效")
		oidcTokenError(c, http.StatusBadRequest, "invalid_grant", "登录会话已失效，请重新授权")
		return
	}
	result, err := service.OIDCIssueTokens(client, code, identity)
	if err != nil {
		oidcRecordAccess(c, oidcGrantEntry(c, client.ClientId, code.UserId, oidcActionToken, service.OIDCGrantAuthorization, strings.Fields(code.Scopes), "invalid_grant", err))
		oidcRecordAudit(c, code.UserId, "oidc_token_failed", false,
			oidcAuditClient(client.ClientId)+" grant=authorization_code reason="+err.Error())
		oidcTokenError(c, http.StatusBadRequest, "invalid_grant", err.Error())
		return
	}
	oidcRecordAccess(c, oidcGrantEntry(c, client.ClientId, code.UserId, oidcActionToken, service.OIDCGrantAuthorization, result.Scopes, "", nil))
	oidcRecordAudit(c, code.UserId, "oidc_token_issued", true,
		oidcAuditClient(client.ClientId)+" "+oidcUserRef(code.UserId)+" scopes="+oidcScopeSummary(result.Scopes))
	c.JSON(http.StatusOK, result)
}

// oidcClientCredentials 支持 client_secret_basic 与 client_secret_post 两种认证方式。
func oidcClientCredentials(c *gin.Context) (string, string) {
	if username, password, ok := c.Request.BasicAuth(); ok {
		return strings.TrimSpace(username), password
	}
	return strings.TrimSpace(c.PostForm("client_id")), c.PostForm("client_secret")
}

// oidcProtocolError 按 OAuth/OIDC 规范返回错误（真 HTTP 状态码 + error 字段）：
// 这套端点是给第三方程序排错用的，不能套用站内 SPA 的 success:false 包装。
func oidcProtocolError(c *gin.Context, status int, code, description string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, gin.H{"error": code, "error_description": description})
}

func oidcTokenError(c *gin.Context, status int, code, description string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, gin.H{"error": code, "error_description": description})
}

// OIDCUserInfo 返回身份信息：应用可用性、会话有效性、用户分组范围三者都过才给。
func OIDCUserInfo(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	token := oidcBearerToken(c)
	info, clientId, err := service.OIDCUserInfo(token)
	if err != nil {
		// 只进明细、不进审计：这是高频只读端点，失败多为令牌过期/会话失效。
		oidcRecordAccess(c, oidcAccessEntry(c, "", 0, oidcActionUserInfo, nil, "invalid_token", err))
		c.Header("WWW-Authenticate", `Bearer error="invalid_token"`)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token", "error_description": err.Error()})
		return
	}
	oidcRecordAccess(c, oidcAccessEntry(c, clientId, oidcInfoSubject(info), oidcActionUserInfo, nil, "", nil))
	c.JSON(http.StatusOK, info)
}

func oidcBearerToken(c *gin.Context) string {
	if header := strings.TrimSpace(c.GetHeader("Authorization")); header != "" {
		if token, ok := strings.CutPrefix(header, "Bearer "); ok {
			return strings.TrimSpace(token)
		}
	}
	// RFC 6750 允许表单/查询参数携带，兼容不便设置请求头的调用方。
	if token := c.PostForm("access_token"); token != "" {
		return token
	}
	return c.Query("access_token")
}

// OIDCRevoke 撤销刷新令牌（无效令牌也返回成功，避免被用来探测）。
func OIDCRevoke(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	clientId, clientSecret := oidcClientCredentials(c)
	client, err := service.OIDCGetApprovedClient(clientId)
	if err != nil || !service.OIDCVerifyClientSecret(client, clientSecret) {
		oidcTokenError(c, http.StatusUnauthorized, "invalid_client", "客户端凭据校验失败")
		return
	}
	if err := service.OIDCRevokeRefreshToken(client.ClientId, c.PostForm("token")); err != nil {
		oidcRecordAccess(c, oidcAccessEntry(c, client.ClientId, 0, oidcActionRevoke, nil, "invalid_request", err))
		oidcTokenError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	oidcRecordAccess(c, oidcAccessEntry(c, client.ClientId, 0, oidcActionRevoke, nil, "", nil))
	oidcRecordAudit(c, 0, "oidc_token_revoked", true, oidcAuditClient(client.ClientId))
	c.Status(http.StatusOK)
}

// oidcInfoSubject 取 userinfo 响应里的 sub（站内 user id）。
func oidcInfoSubject(info map[string]any) int {
	sub, _ := info["sub"].(string)
	id, err := strconv.Atoi(sub)
	if err != nil {
		return 0
	}
	return id
}
