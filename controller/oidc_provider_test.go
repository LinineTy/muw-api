// @muw-owned
package controller

import (
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 端到端：本测试同时扮演"第三方应用"与"浏览器"，把 OIDC 授权码 + PKCE 全流程走完，
// 并用 JWKS 里的公钥真实验签 id_token —— 这是"标准客户端能不能接进来"的最小证明。
func setupOIDCEndToEnd(t *testing.T) (*model.User, *model.UserSession, *model.OIDCClient, string, *gin.Engine) {
	t.Helper()
	previousDB, previousSecret := model.DB, common.SessionSecret
	previousIssuer := system_setting.ServerAddress
	previousRedis, previousCache := common.RedisEnabled, common.MemoryCacheEnabled

	kind := strings.ToLower(strings.TrimSpace(os.Getenv("TEST_OIDC_DIALECT")))
	if kind == "" {
		kind = "sqlite"
	}
	// 复用仓库既有的三方言建库助手：每个用例一个独立库（MySQL/PostgreSQL 必须 loopback）。
	db, _ := newAuditTestDatabase(t, kind, os.Getenv("TEST_"+strings.ToUpper(kind)+"_DSN"))
	// 每个用例都是新库：清掉进程内的签名密钥缓存，否则第二轮会拿上一个库的 kid 去签。
	service.ResetOIDCSigningKeyCacheForTest()
	// 方言类型必须与真实连接一致：一批 ensure*/迁移分支靠它判断（漏设会把 SQLite DDL 发给 MySQL）。
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	common.SetDatabaseTypes(oidcDialectType(kind), oidcDialectType(kind))
	t.Cleanup(func() { common.SetDatabaseTypes(previousMain, previousLog) })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.OIDCClient{},
		&model.OIDCAuthCode{}, &model.OIDCRefreshToken{}, &model.OIDCConsent{}, &model.OIDCSigningKey{}, &model.OIDCUsageStat{}, &model.OIDCAccessLog{}, &model.AuditLog{}))
	previousLogDB := model.LOG_DB
	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.SessionSecret = "oidc-e2e-test-secret"
	common.RedisEnabled = false
	common.MemoryCacheEnabled = false
	common.InviteCodeRegisterEnabled = false
	common.SessionCookieSecure = false
	system_setting.ServerAddress = "https://idp.example.com"
	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB = previousLogDB
		common.SessionSecret = previousSecret
		system_setting.ServerAddress = previousIssuer
		common.RedisEnabled = previousRedis
		common.MemoryCacheEnabled = previousCache
	})

	user := &model.User{Username: "e2euser", Password: "hashed", DisplayName: "端到端", Email: "e2e@example.com",
		Avatar: "https://cdn.example.com/e2e.png", Role: common.RoleCommonUser, Status: common.UserStatusEnabled,
		Group: "tier1", AffCode: "affe2e", AuthVersion: 1}
	require.NoError(t, db.Create(user).Error)

	now := time.Now().Unix()
	session := &model.UserSession{SID: "sess-e2e", UserID: user.Id, Version: 1, UserAuthVersion: 1,
		Status: model.UserSessionStatusActive, RefreshHash: "hash", LoginMethod: "password",
		CreatedAt: now, LastActiveAt: now, ExpiresAt: now + 3600}
	require.NoError(t, db.Create(session).Error)

	secretHash, err := common.Password2Hash("e2e-client-secret")
	require.NoError(t, err)
	client := &model.OIDCClient{ClientId: "muw_e2e_client", SecretHash: secretHash, Name: "端到端测试应用",
		RedirectUris: "https://app.example.com/cb", Scopes: "openid profile email group offline_access",
		ClientType: model.OIDCClientTypeConfidential, Status: model.OIDCClientStatusApproved, OwnerUserId: user.Id,
		CreatedAt: now, UpdatedAt: now}
	require.NoError(t, db.Create(client).Error)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/.well-known/openid-configuration", OIDCDiscovery)
	engine.GET("/oauth/jwks.json", OIDCJWKS)
	engine.GET("/oauth/authorize", OIDCAuthorize)
	engine.POST("/oauth/token", OIDCToken)
	engine.GET("/oauth/userinfo", OIDCUserInfo)
	engine.POST("/oauth/revoke", OIDCRevoke)
	consent := engine.Group("/api/oauth")
	consent.Use(middleware.UserAuth())
	consent.POST("/consent/decision", OIDCConsentDecision)
	consent.GET("/consent/preview", OIDCConsentPreview)
	consent.GET("/consents", OIDCListConsents)
	consent.POST("/consents/silent", OIDCUpdateConsentSilent)
	consent.DELETE("/consents/:clientId", OIDCRevokeConsent)
	return user, session, client, "e2e-client-secret", engine
}

func oidcE2ERequest(t *testing.T, engine *gin.Engine, method, target, body, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	// 审计/明细要记 UA，给个固定值便于断言
	request.Header.Set("User-Agent", "oidc-e2e-test/1.0")
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	return recorder
}

func TestOIDCEndToEndAuthorizationCodeWithPKCE(t *testing.T) {
	user, session, client, clientSecret, engine := setupOIDCEndToEnd(t)

	// ① 发现文档
	discovery := oidcE2ERequest(t, engine, http.MethodGet, "/.well-known/openid-configuration", "", "")
	require.Equal(t, http.StatusOK, discovery.Code)
	var document map[string]any
	require.NoError(t, json.Unmarshal(discovery.Body.Bytes(), &document))
	assert.Equal(t, "https://idp.example.com", document["issuer"])
	assert.Equal(t, "https://idp.example.com/oauth/token", document["token_endpoint"])

	// ② 授权请求：客户端发起 PKCE
	verifier := "e2e-verifier-0123456789abcdefghijklmnopqrstuv"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	authorizeQuery := url.Values{}
	authorizeQuery.Set("client_id", client.ClientId)
	authorizeQuery.Set("redirect_uri", "https://app.example.com/cb")
	authorizeQuery.Set("response_type", "code")
	authorizeQuery.Set("scope", "openid profile email group offline_access")
	authorizeQuery.Set("state", "state-e2e")
	authorizeQuery.Set("nonce", "nonce-e2e")
	authorizeQuery.Set("code_challenge", challenge)
	authorizeQuery.Set("code_challenge_method", "S256")

	authorize := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/authorize?"+authorizeQuery.Encode(), "", "")
	require.Equal(t, http.StatusFound, authorize.Code)
	location := authorize.Header().Get("Location")
	require.True(t, strings.HasPrefix(location, "/oauth/consent?request="), "应跳到同意页，实际：%s", location)
	parsedLocation, err := url.Parse(location)
	require.NoError(t, err)
	requestToken := parsedLocation.Query().Get("request")
	require.NotEmpty(t, requestToken)

	// ③ 未登录用户不能被授权（同意页预览必须要求登录态）
	anonymous := oidcE2ERequest(t, engine, http.MethodGet, "/api/oauth/consent/preview?request="+url.QueryEscape(requestToken), "", "")
	require.Equal(t, http.StatusUnauthorized, anonymous.Code)

	// ④ 已登录用户看预览，再点同意
	dashboardToken, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
	require.NoError(t, err)
	preview := oidcE2ERequest(t, engine, http.MethodGet, "/api/oauth/consent/preview?request="+url.QueryEscape(requestToken), "", dashboardToken)
	require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
	assert.Contains(t, preview.Body.String(), "端到端测试应用")

	decisionBody, err := common.Marshal(map[string]any{"request": requestToken, "approve": true, "silent": false})
	require.NoError(t, err)
	decision := oidcE2ERequest(t, engine, http.MethodPost, "/api/oauth/consent/decision", string(decisionBody), dashboardToken)
	require.Equal(t, http.StatusOK, decision.Code, decision.Body.String())
	var decisionResult struct {
		Success bool `json:"success"`
		Data    struct {
			RedirectUrl string `json:"redirect_url"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(decision.Body.Bytes(), &decisionResult))
	require.True(t, decisionResult.Success)
	callback, err := url.Parse(decisionResult.Data.RedirectUrl)
	require.NoError(t, err)
	assert.Equal(t, "app.example.com", callback.Host)
	assert.Equal(t, "state-e2e", callback.Query().Get("state"), "state 必须原样带回")
	code := callback.Query().Get("code")
	require.NotEmpty(t, code)

	// ⑤ 换令牌（client_secret_basic）
	tokenForm := url.Values{}
	tokenForm.Set("grant_type", "authorization_code")
	tokenForm.Set("code", code)
	tokenForm.Set("redirect_uri", "https://app.example.com/cb")
	tokenForm.Set("code_verifier", verifier)
	tokenRequest := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(tokenForm.Encode()))
	tokenRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokenRequest.SetBasicAuth(client.ClientId, clientSecret)
	tokenRecorder := httptest.NewRecorder()
	engine.ServeHTTP(tokenRecorder, tokenRequest)
	require.Equal(t, http.StatusOK, tokenRecorder.Code, tokenRecorder.Body.String())
	assert.Equal(t, "no-store", tokenRecorder.Header().Get("Cache-Control"))
	var tokens struct {
		AccessToken  string `json:"access_token"`
		IdToken      string `json:"id_token"`
		RefreshToken string `json:"refresh_token"`
		TokenType    string `json:"token_type"`
	}
	require.NoError(t, common.Unmarshal(tokenRecorder.Body.Bytes(), &tokens))
	require.NotEmpty(t, tokens.AccessToken)
	require.NotEmpty(t, tokens.IdToken)
	require.NotEmpty(t, tokens.RefreshToken, "申请了 offline_access 必须给刷新令牌")
	assert.Equal(t, "Bearer", tokens.TokenType)

	// ⑥ 用 JWKS 的公钥真实校验 id_token 签名（模拟第三方标准客户端）
	jwksResponse := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/jwks.json", "", "")
	require.Equal(t, http.StatusOK, jwksResponse.Code)
	var jwks struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	require.NoError(t, json.Unmarshal(jwksResponse.Body.Bytes(), &jwks))
	require.Len(t, jwks.Keys, 1)
	nBytes, err := base64.RawURLEncoding.DecodeString(jwks.Keys[0].N)
	require.NoError(t, err)
	eBytes, err := base64.RawURLEncoding.DecodeString(jwks.Keys[0].E)
	require.NoError(t, err)
	publicKey := &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: int(new(big.Int).SetBytes(eBytes).Int64())}

	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(tokens.IdToken, claims, func(token *jwt.Token) (any, error) {
		require.Equal(t, "RS256", token.Method.Alg())
		require.Equal(t, jwks.Keys[0].Kid, token.Header["kid"])
		return publicKey, nil
	}, jwt.WithValidMethods([]string{"RS256"}))
	require.NoError(t, err)
	require.True(t, parsed.Valid)
	assert.Equal(t, "https://idp.example.com", claims["iss"])
	audience, err := parsed.Claims.GetAudience()
	require.NoError(t, err)
	assert.Equal(t, []string{client.ClientId}, []string(audience), "aud 必须是本应用")
	assert.Equal(t, fmt.Sprint(user.Id), claims["sub"])
	assert.Equal(t, "nonce-e2e", claims["nonce"], "nonce 必须原样写进 id_token")
	assert.Equal(t, "e2euser", claims["preferred_username"])
	assert.Equal(t, "端到端", claims["name"])
	assert.Equal(t, "e2e@example.com", claims["email"])
	assert.Equal(t, "tier1", claims["group"])

	// ⑦ userinfo：只认 OIDC 用途的 access_token
	userinfo := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/userinfo", "", tokens.AccessToken)
	require.Equal(t, http.StatusOK, userinfo.Code, userinfo.Body.String())
	assert.Contains(t, userinfo.Body.String(), `"sub":"`+fmt.Sprint(user.Id)+`"`)
	assert.Contains(t, userinfo.Body.String(), "e2euser")

	// ⑧ 站点自己的仪表盘令牌不能冒充 userinfo 凭据（用途隔离）
	crossUse := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/userinfo", "", dashboardToken)
	assert.Equal(t, http.StatusUnauthorized, crossUse.Code, "仪表盘令牌不得被当作 OIDC access_token")

	// ⑨ 授权码重放必须失败
	replay := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(tokenForm.Encode()))
	replay.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	replay.SetBasicAuth(client.ClientId, clientSecret)
	replayRecorder := httptest.NewRecorder()
	engine.ServeHTTP(replayRecorder, replay)
	assert.Equal(t, http.StatusBadRequest, replayRecorder.Code)
	assert.Contains(t, replayRecorder.Body.String(), "invalid_grant")

	// ⑩ 刷新令牌轮换
	refreshForm := url.Values{}
	refreshForm.Set("grant_type", "refresh_token")
	refreshForm.Set("refresh_token", tokens.RefreshToken)
	refreshRequest := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(refreshForm.Encode()))
	refreshRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	refreshRequest.SetBasicAuth(client.ClientId, clientSecret)
	refreshRecorder := httptest.NewRecorder()
	engine.ServeHTTP(refreshRecorder, refreshRequest)
	require.Equal(t, http.StatusOK, refreshRecorder.Code, refreshRecorder.Body.String())
	var refreshed struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	require.NoError(t, common.Unmarshal(refreshRecorder.Body.Bytes(), &refreshed))
	assert.NotEqual(t, tokens.RefreshToken, refreshed.RefreshToken, "刷新必须轮换")

	// ⑪ 撤销授权后，旧 access_token 立刻失效（会话维度校验）
	revoke := oidcE2ERequest(t, engine, http.MethodDelete, "/api/oauth/consents/"+client.ClientId, "", dashboardToken)
	require.Equal(t, http.StatusOK, revoke.Code, revoke.Body.String())
	afterRevoke := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/userinfo", "", tokens.AccessToken)
	assert.Equal(t, http.StatusUnauthorized, afterRevoke.Code, "撤销授权后已签发的 access_token 必须立刻失效")

	// ⑫ 会话失效后立即不可用（登出 / 改密 / 换版本的路径）
	require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", session.SID).
		Updates(map[string]any{"status": model.UserSessionStatusRevoked, "revoked_at": time.Now().Unix()}).Error)
	afterLogout := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/userinfo", "", tokens.AccessToken)
	assert.Equal(t, http.StatusUnauthorized, afterLogout.Code, "会话失效后 access_token 必须立刻失效")
}

func TestOIDCAuthorizeRejectsMismatchedRedirect(t *testing.T) {
	_, _, client, _, engine := setupOIDCEndToEnd(t)
	query := url.Values{}
	query.Set("client_id", client.ClientId)
	query.Set("redirect_uri", "https://evil.example.com/cb")
	query.Set("response_type", "code")
	query.Set("scope", "openid")
	query.Set("code_challenge", "challenge")
	query.Set("code_challenge_method", "S256")
	response := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/authorize?"+query.Encode(), "", "")
	// 回调地址不可信 ⇒ 绝不重定向（否则是开放重定向），直接报错
	require.NotEqual(t, http.StatusFound, response.Code)
	assert.Equal(t, http.StatusBadRequest, response.Code)
	assert.Contains(t, response.Body.String(), "回调地址不匹配")
}

func TestOIDCAuthorizeRedirectsMissingPKCEToClient(t *testing.T) {
	_, _, client, _, engine := setupOIDCEndToEnd(t)
	query := url.Values{}
	query.Set("client_id", client.ClientId)
	query.Set("redirect_uri", "https://app.example.com/cb")
	query.Set("response_type", "code")
	query.Set("scope", "openid")
	query.Set("state", "st-pkce")
	response := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/authorize?"+query.Encode(), "", "")
	// 回调地址已登记 ⇒ 错误按规范重定向回应用（把 state 原样带回），不是裸 JSON
	require.Equal(t, http.StatusFound, response.Code)
	location, err := url.Parse(response.Header().Get("Location"))
	require.NoError(t, err)
	assert.Equal(t, "app.example.com", location.Host)
	assert.Equal(t, "invalid_request", location.Query().Get("error"))
	assert.Contains(t, location.Query().Get("error_description"), "PKCE")
	assert.Equal(t, "st-pkce", location.Query().Get("state"))
}

func TestOIDCRejectsNonApprovedClient(t *testing.T) {
	_, _, client, _, engine := setupOIDCEndToEnd(t)
	require.NoError(t, model.DB.Model(&model.OIDCClient{}).Where("client_id = ?", client.ClientId).
		Update("status", model.OIDCClientStatusPending).Error)

	query := url.Values{}
	query.Set("client_id", client.ClientId)
	query.Set("redirect_uri", "https://app.example.com/cb")
	query.Set("response_type", "code")
	query.Set("scope", "openid")
	query.Set("code_challenge", "challenge")
	query.Set("code_challenge_method", "S256")
	response := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/authorize?"+query.Encode(), "", "")
	assert.Equal(t, http.StatusBadRequest, response.Code, "待审核/禁用的应用不得进入授权流程")
}

func oidcDialectType(kind string) common.DatabaseType {
	switch kind {
	case "mysql":
		return common.DatabaseTypeMySQL
	case "postgres":
		return common.DatabaseTypePostgreSQL
	default:
		return common.DatabaseTypeSQLite
	}
}
