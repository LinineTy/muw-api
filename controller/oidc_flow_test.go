// @muw-owned
package controller

import (
	"net/http"
	"net/url"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// oidcRegisterExtraRoutes 给端到端夹具补上统计/明细相关路由（夹具只注册协议侧）。
func oidcRegisterExtraRoutes(engine *gin.Engine) {
	group := engine.Group("/api/oauth")
	group.Use(middleware.UserAuth())
	group.GET("/access-logs", OIDCAccessLogs)
	group.GET("/usage", OIDCUsageOverview)
	group.GET("/applications/:id/usage", OIDCApplicationUsage)
}

// oidcAuthorizeForTest 走一次 /oauth/authorize，返回同意页凭据与浏览器绑定 Cookie。
func oidcAuthorizeForTest(t *testing.T, engine *gin.Engine, client *model.OIDCClient, scopes, prompt string) (string, []*http.Cookie) {
	t.Helper()
	query := url.Values{}
	query.Set("client_id", client.ClientId)
	query.Set("redirect_uri", "https://app.example.com/cb")
	query.Set("response_type", "code")
	query.Set("scope", scopes)
	query.Set("state", "state-flow")
	query.Set("nonce", "nonce-flow")
	query.Set("code_challenge", "challenge-flow")
	query.Set("code_challenge_method", "S256")
	if prompt != "" {
		query.Set("prompt", prompt)
	}
	recorder := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/authorize?"+query.Encode(), "", "")
	require.Equal(t, http.StatusFound, recorder.Code)
	location, err := url.Parse(recorder.Header().Get("Location"))
	require.NoError(t, err)
	require.Equal(t, "/oauth/consent", location.Path)
	require.NotEmpty(t, location.Query().Get("request"))
	return location.Query().Get("request"), recorder.Result().Cookies()
}

func oidcDashboardToken(t *testing.T, user *model.User, session *model.UserSession) string {
	t.Helper()
	token, _, err := service.IssueAccessToken(service.AuthIdentity{
		UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1,
	})
	require.NoError(t, err)
	return token
}

// 同意页必须由"发起这次授权的同一个浏览器"完成：授权凭据会出现在 URL 里，
// 被别的浏览器捡走就能替原用户点"允许"（授权码会绑到那个人的身份）。
func TestOIDCConsentBindsToInitiatingBrowser(t *testing.T) {
	user, session, client, _, engine := setupOIDCEndToEnd(t)
	requestToken, flowCookies := oidcAuthorizeForTest(t, engine, client, "openid profile", "")
	require.NotEmpty(t, flowCookies)
	dashboardToken := oidcDashboardToken(t, user, session)
	target := "/api/oauth/consent/preview?request=" + url.QueryEscape(requestToken)

	// 没有流程 Cookie（= 换了个浏览器）
	foreign := oidcE2ERequest(t, engine, http.MethodGet, target, "", dashboardToken)
	assert.Contains(t, foreign.Body.String(), "浏览器不匹配")

	// 带着流程 Cookie：正常
	same := oidcE2ERequest(t, engine, http.MethodGet, target, "", dashboardToken, flowCookies...)
	require.Equal(t, http.StatusOK, same.Code, same.Body.String())
	assert.Contains(t, same.Body.String(), "端到端测试应用")

	// 决策同样要求同一个浏览器
	body, err := common.Marshal(map[string]any{"request": requestToken, "approve": true, "silent": false})
	require.NoError(t, err)
	decision := oidcE2ERequest(t, engine, http.MethodPost, "/api/oauth/consent/decision", string(body), dashboardToken)
	assert.Contains(t, decision.Body.String(), "浏览器不匹配")
	ok := oidcE2ERequest(t, engine, http.MethodPost, "/api/oauth/consent/decision", string(body), dashboardToken, flowCookies...)
	require.Equal(t, http.StatusOK, ok.Code, ok.Body.String())
	assert.Contains(t, ok.Body.String(), "redirect_url")
}

// 「以后不再询问」必须真的免掉交互，而新增 scope 必须回来问。
func TestOIDCSilentConsentOnlyWhenNothingNew(t *testing.T) {
	user, session, client, _, engine := setupOIDCEndToEnd(t)
	dashboardToken := oidcDashboardToken(t, user, session)
	// 用户此前静默同意过 openid profile
	require.NoError(t, model.UpsertOIDCConsent(user.Id, client.ClientId, "openid profile", true))

	preview := func(scopes string) string {
		requestToken, cookies := oidcAuthorizeForTest(t, engine, client, scopes, "")
		recorder := oidcE2ERequest(t, engine, http.MethodGet,
			"/api/oauth/consent/preview?request="+url.QueryEscape(requestToken), "", dashboardToken, cookies...)
		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
		return recorder.Body.String()
	}
	assert.Contains(t, preview("openid profile"), `"needs_consent":false`, "已静默同意且没有新增 scope ⇒ 免交互")
	assert.Contains(t, preview("openid profile email"), `"needs_consent":true`, "新增 scope 必须重新征得同意")
	assert.Contains(t, preview("openid"), `"needs_consent":false`, "scope 收缩不必再问")
}

// prompt=none：客户端明确要求不交互，需要同意时不能弹页面，要按规范回 interaction_required。
func TestOIDCPromptNoneReturnsInteractionRequired(t *testing.T) {
	user, session, client, _, engine := setupOIDCEndToEnd(t)
	dashboardToken := oidcDashboardToken(t, user, session)
	requestToken, cookies := oidcAuthorizeForTest(t, engine, client, "openid profile", service.OIDCPromptNone)
	require.NotEmpty(t, cookies)

	body, err := common.Marshal(map[string]any{"request": requestToken, "approve": false, "silent": false})
	require.NoError(t, err)
	recorder := oidcE2ERequest(t, engine, http.MethodPost, "/api/oauth/consent/decision", string(body), dashboardToken, cookies...)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), "interaction_required")
	assert.Contains(t, recorder.Body.String(), "state-flow", "state 必须原样带回")
}

// 调用明细带终端用户身份与来源 ⇒ 只给管理员；站内用户看用量只走聚合口径。
func TestOIDCCallRecordsAreAdminOnly(t *testing.T) {
	user, session, client, _, engine := setupOIDCEndToEnd(t)
	oidcRegisterExtraRoutes(engine)
	require.NoError(t, model.DB.Create(&model.OIDCAccessLog{
		ClientId: client.ClientId, UserId: user.Id, Action: "token", GrantType: service.OIDCGrantAuthorization,
		Ip: "203.0.113.7", UserAgent: "oidc-e2e-test/1.0", Success: true, CreatedAt: common.GetTimestamp(),
	}).Error)

	dashboardToken := oidcDashboardToken(t, user, session)
	denied := oidcE2ERequest(t, engine, http.MethodGet, "/api/oauth/access-logs", "", dashboardToken)
	assert.Contains(t, denied.Body.String(), "只有管理员", "站内用户不得看调用明细")

	// 提权成管理员后：既能看到明细，也能拿到应用名
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).
		Update("role", common.RoleAdminUser).Error)
	allowed := oidcE2ERequest(t, engine, http.MethodGet, "/api/oauth/access-logs", "", dashboardToken)
	require.Equal(t, http.StatusOK, allowed.Code, allowed.Body.String())
	assert.Contains(t, allowed.Body.String(), "端到端测试应用")
	assert.Contains(t, allowed.Body.String(), "203.0.113.7")
	assert.Contains(t, allowed.Body.String(), "authorization_code")

	// 聚合口径：管理员切全站能拿到按应用聚合与趋势
	usage := oidcE2ERequest(t, engine, http.MethodGet, "/api/oauth/usage?scope=all&days=7&tz_offset=480", "", dashboardToken)
	require.Equal(t, http.StatusOK, usage.Code, usage.Body.String())
	assert.Contains(t, usage.Body.String(), `"applications"`)
	assert.Contains(t, usage.Body.String(), client.ClientId)
}

// 站内用户的用量口径只能看到自己创建的应用：别人的应用既不在聚合里，也不能按 id 查。
func TestOIDCUsageScopedToOwnApplications(t *testing.T) {
	user, session, ownClient, _, engine := setupOIDCEndToEnd(t)
	oidcRegisterExtraRoutes(engine)
	now := common.GetTimestamp()
	other := &model.OIDCClient{ClientId: "muw_someone_else", Name: "别人的应用", ClientType: model.OIDCClientTypePublic,
		Status: model.OIDCClientStatusApproved, OwnerUserId: 99999, RedirectUris: "https://other.example.com/cb",
		Scopes: "openid", CreatedAt: now, UpdatedAt: now}
	require.NoError(t, model.DB.Create(other).Error)
	require.NoError(t, model.DB.Create(&model.OIDCAccessLog{
		ClientId: other.ClientId, UserId: 4242, Action: "token", Success: true, CreatedAt: now,
	}).Error)

	dashboardToken := oidcDashboardToken(t, user, session)
	usage := oidcE2ERequest(t, engine, http.MethodGet, "/api/oauth/usage?scope=self", "", dashboardToken)
	require.Equal(t, http.StatusOK, usage.Code, usage.Body.String())
	assert.NotContains(t, usage.Body.String(), other.ClientId, "别人的应用不得出现在我的口径里")

	// 也不能借 :id 直接查别人的应用用量
	foreign := oidcE2ERequest(t, engine, http.MethodGet, "/api/oauth/applications/"+itoa(other.Id)+"/usage", "", dashboardToken)
	assert.Contains(t, foreign.Body.String(), "只能查看自己应用的使用记录")

	own := oidcE2ERequest(t, engine, http.MethodGet, "/api/oauth/applications/"+itoa(ownClient.Id)+"/usage", "", dashboardToken)
	require.Equal(t, http.StatusOK, own.Code, own.Body.String())
	assert.Contains(t, own.Body.String(), `"totals"`)
	assert.NotContains(t, own.Body.String(), `"user_id"`, "站内用户看不到逐个终端用户")
}

func itoa(value int) string { return strconv.Itoa(value) }
