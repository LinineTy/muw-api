// @muw-owned
package controller

import (
	"net/http"
	"net/url"
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
	requestToken, err := service.OIDCIssueAuthorizeRequestToken(client, req, scopes)
	if err != nil {
		oidcProtocolError(c, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	consentUrl := oidcConsentRoute + "?request=" + url.QueryEscape(requestToken)
	// 排布方案对比用（临时）：允许把 layout 透传到同意页，便于同一流程换样式看效果。
	if layout := oidcConsentLayout(c.Query("layout")); layout != "" {
		consentUrl += "&layout=" + layout
	}
	c.Redirect(http.StatusFound, consentUrl)
}

// oidcConsentLayout 只放行已知的排布方案，避免把任意参数带到同意页。
func oidcConsentLayout(raw string) string {
	switch raw {
	case "stacked", "split":
		return raw
	}
	return ""
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
		oidcTokenError(c, http.StatusUnauthorized, "invalid_client", "客户端凭据校验失败")
		return
	}
	switch c.PostForm("grant_type") {
	case service.OIDCGrantAuthorization:
		oidcExchangeAuthorizationCode(c, client)
	case service.OIDCGrantRefresh:
		result, err := service.OIDCRefreshTokens(client, c.PostForm("refresh_token"))
		if err != nil {
			oidcTokenError(c, http.StatusBadRequest, "invalid_grant", err.Error())
			return
		}
		c.JSON(http.StatusOK, result)
	default:
		oidcTokenError(c, http.StatusBadRequest, "unsupported_grant_type", "只支持 authorization_code 与 refresh_token")
	}
}

func oidcExchangeAuthorizationCode(c *gin.Context, client *model.OIDCClient) {
	code, err := service.OIDCRedeemAuthCode(c.PostForm("code"), client.ClientId, c.PostForm("redirect_uri"), c.PostForm("code_verifier"))
	if err != nil {
		oidcTokenError(c, http.StatusBadRequest, "invalid_grant", err.Error())
		return
	}
	identity, err := service.ValidateSessionReference(code.UserId, code.SessionId)
	if err != nil {
		oidcTokenError(c, http.StatusBadRequest, "invalid_grant", "登录会话已失效，请重新授权")
		return
	}
	result, err := service.OIDCIssueTokens(client, code, identity)
	if err != nil {
		oidcTokenError(c, http.StatusBadRequest, "invalid_grant", err.Error())
		return
	}
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
	info, err := service.OIDCUserInfo(token)
	if err != nil {
		c.Header("WWW-Authenticate", `Bearer error="invalid_token"`)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token", "error_description": err.Error()})
		return
	}
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
		oidcTokenError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	c.Status(http.StatusOK)
}
