// @muw-owned
package controller

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 协议端点的审计与调用明细：每一次调用都要留痕（含 IP），失败也要留 ——
// 这是"出了事能查"的最小证明。审计只收安全事件，明细每一次都收。
func TestOIDCProtocolAuditAndAccessLog(t *testing.T) {
	_, _, client, _, engine := setupOIDCEndToEnd(t)

	// ① 一次被拒的授权请求（缺 PKCE）
	rejected := url.Values{}
	rejected.Set("client_id", client.ClientId)
	rejected.Set("redirect_uri", "https://app.example.com/cb")
	rejected.Set("response_type", "code")
	rejected.Set("state", "s-rejected")
	recorder := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/authorize?"+rejected.Encode(), "", "")
	// 回调地址可信 ⇒ 按规范 302 回应用并带 error（不是裸错误页）
	require.Equal(t, http.StatusFound, recorder.Code)
	assert.Contains(t, recorder.Header().Get("Location"), "error=invalid_request")

	var accessLogs []*model.OIDCAccessLog
	require.NoError(t, model.DB.Order("id asc").Find(&accessLogs).Error)
	require.Len(t, accessLogs, 1, "被拒的授权请求也要进明细")
	assert.Equal(t, oidcActionAuthorize, accessLogs[0].Action)
	assert.False(t, accessLogs[0].Success)
	assert.Equal(t, "invalid_request", accessLogs[0].ErrorCode)
	assert.Equal(t, client.ClientId, accessLogs[0].ClientId)
	assert.NotEmpty(t, accessLogs[0].Ip, "明细必须留下调用方 IP")
	assert.Equal(t, "oidc-e2e-test/1.0", accessLogs[0].UserAgent, "明细必须留下 UA")

	var audits []*model.AuditLog
	require.NoError(t, model.LOG_DB.Order("id asc").Find(&audits).Error)
	require.Len(t, audits, 1, "被拒的授权请求也要进审计")
	assert.Equal(t, "oidc_authorize_rejected", audits[0].Action)
	assert.Equal(t, model.AuditCategorySecurity, audits[0].Category)
	assert.False(t, audits[0].Success)
	assert.Contains(t, audits[0].Content, client.ClientId)
	assert.NotEmpty(t, audits[0].Ip, "审计必须留下调用方 IP")

	// ② 一次成功的授权请求
	verifier := "audit-verifier-0123456789abcdefghijklmnop"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	approved := url.Values{}
	approved.Set("client_id", client.ClientId)
	approved.Set("redirect_uri", "https://app.example.com/cb")
	approved.Set("response_type", "code")
	approved.Set("scope", "openid profile")
	approved.Set("state", "s-approved")
	approved.Set("code_challenge", challenge)
	approved.Set("code_challenge_method", "S256")
	ok := oidcE2ERequest(t, engine, http.MethodGet, "/oauth/authorize?"+approved.Encode(), "", "")
	require.Equal(t, http.StatusFound, ok.Code, ok.Body.String())

	require.NoError(t, model.DB.Order("id asc").Find(&accessLogs).Error)
	require.Len(t, accessLogs, 2)
	assert.Equal(t, oidcActionAuthorize, accessLogs[1].Action)
	assert.True(t, accessLogs[1].Success)
	assert.Empty(t, accessLogs[1].ErrorCode)
	assert.Contains(t, accessLogs[1].Scopes, "openid")

	require.NoError(t, model.LOG_DB.Order("id asc").Find(&audits).Error)
	require.Len(t, audits, 2)
	assert.Equal(t, "oidc_authorize_requested", audits[1].Action)
	assert.True(t, audits[1].Success)

	// ③ 明细查询：按应用过滤 + 汇总口径
	logs, total, err := model.ListOIDCAccessLogs(model.OIDCAccessLogFilter{ClientId: client.ClientId})
	require.NoError(t, err)
	assert.EqualValues(t, 2, total)
	assert.Len(t, logs, 2)

	summary, err := model.SummarizeOIDCAccessLogs(model.OIDCAccessLogFilter{ClientId: client.ClientId})
	require.NoError(t, err)
	assert.EqualValues(t, 2, summary.TotalCalls)
	assert.EqualValues(t, 1, summary.FailedCalls)
	assert.EqualValues(t, 1, summary.ActiveClients)

	// ④ 别人的应用看不到：限定一组不相干的应用时，一条都不该返回
	other, total, err := model.ListOIDCAccessLogs(model.OIDCAccessLogFilter{ClientIds: []string{"muw_someone_else"}})
	require.NoError(t, err)
	assert.Len(t, other, 0)
	assert.EqualValues(t, 0, total)

	// ⑤ 没有应用可看的用户：ClientIdsEmpty 时也不能退化成"不限"
	empty, total, err := model.ListOIDCAccessLogs(model.OIDCAccessLogFilter{ClientIdsEmpty: true})
	require.NoError(t, err)
	assert.Len(t, empty, 0)
	assert.EqualValues(t, 0, total)
}
