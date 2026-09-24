// @muw-owned
package controller

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 登录/注册/第三方入口的前置人机校验：服务端门禁，防止"只禁用按钮"被脚本直接 POST 绕过。
//
// 一条请求的判定顺序：先过校验 → 再看账号密码/注册参数。这样既能挡批量试密码，
// 也不把登录接口变成"账号是否存在"的探测面。

func withLoginChallengeForTest(t *testing.T) func() {
	t.Helper()
	previousEnabled := common.LoginChallengeEnabled
	previousBits := common.ActivationPoWBits
	common.LoginChallengeEnabled = true
	common.ActivationPoWBits = 8
	model.ResetPoWChallengesForTest()
	return func() {
		common.LoginChallengeEnabled = previousEnabled
		common.ActivationPoWBits = previousBits
	}
}

// solvePreAuthChallengeForTest 领一道 preauth 挑战并解出 nonce。
func solvePreAuthChallengeForTest(t *testing.T) (string, string) {
	t.Helper()
	challenge, err := model.IssuePoWChallenge(model.PoWPurposePreAuth, 0, "127.0.0.1", 8)
	require.NoError(t, err)
	nonce := solvePreAuthNonceForTest(t, challenge.Challenge, challenge.Bits)
	return challenge.Id, nonce
}

func solvePreAuthNonceForTest(t *testing.T, challenge string, bits int) string {
	t.Helper()
	for nonce := 0; nonce < 10_000_000; nonce++ {
		candidate := strconv.Itoa(nonce)
		if model.VerifyPoW(challenge, candidate, bits) {
			return candidate
		}
	}
	t.Fatalf("求解 PoW 失败：challenge=%s bits=%d", challenge, bits)
	return ""
}

// performLoginRequest 模拟一次密码登录提交；proof 为空表示"脚本不带校验直接 POST"。
func performLoginRequest(t *testing.T, username, password, challengeId, nonce string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := common.Marshal(map[string]string{"username": username, "password": password})
	require.NoError(t, err)
	url := "/api/user/login"
	query := []string{}
	if challengeId != "" {
		query = append(query, "challenge_id="+challengeId)
	}
	if nonce != "" {
		query = append(query, "nonce="+nonce)
	}
	if len(query) > 0 {
		url += "?" + strings.Join(query, "&")
	}
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, url, strings.NewReader(string(body)))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.RemoteAddr = "127.0.0.1:1234"
	Login(c)
	return recorder
}

func performRegisterRequest(t *testing.T, username, password, challengeId, nonce string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := common.Marshal(map[string]string{"username": username, "password": password})
	require.NoError(t, err)
	url := "/api/user/register"
	if challengeId != "" {
		url += "?challenge_id=" + challengeId + "&nonce=" + nonce
	}
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, url, strings.NewReader(string(body)))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.RemoteAddr = "127.0.0.1:1234"
	Register(c)
	return recorder
}

// 不带校验直接打登录接口（脚本绕过按钮禁用的形状）⇒ 必须被服务端挡下。
func TestLoginWithoutChallengeIsRejected(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	restore := withLoginChallengeForTest(t)
	defer restore()

	user := model.User{Username: "preauth-user", Password: "password", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Activated: 1, AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)

	recorder := performLoginRequest(t, "preauth-user", "password", "", "")
	assert.Contains(t, recorder.Body.String(), CodeLoginVerificationRequired)
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	assert.NotContains(t, recorder.Body.String(), "access_token", "未过校验不得下发会话")
}

// 校验通过后照常走凭据判定：密码错就是密码错，不是"要重新校验"。
func TestLoginWithChallengeReachesCredentialCheck(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	restore := withLoginChallengeForTest(t)
	defer restore()

	user := model.User{Username: "preauth-user2", Password: "password", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Activated: 1, AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)

	challengeId, nonce := solvePreAuthChallengeForTest(t)
	recorder := performLoginRequest(t, "preauth-user2", "wrong-password", challengeId, nonce)
	assert.NotContains(t, recorder.Body.String(), CodeLoginVerificationRequired, "过了校验就该进入凭据判定")
	assert.Contains(t, recorder.Body.String(), `"success":false`)

	// 挑战一次性：同一个挑战再用一次（这次密码是对的）也不放过，防止一次算力换多次尝试。
	recorder = performLoginRequest(t, "preauth-user2", "password", challengeId, nonce)
	assert.Contains(t, recorder.Body.String(), CodeLoginVerificationRequired)
}

// 用途隔离：激活页领的挑战不能拿来登录。
func TestLoginRejectsActivationPurposeChallenge(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	restore := withLoginChallengeForTest(t)
	defer restore()

	user := model.User{Username: "preauth-user3", Password: "password", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Activated: 0, AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)

	activationChallenge, err := model.IssuePoWChallenge(model.PoWPurposeActivation, user.Id, "127.0.0.1", 8)
	require.NoError(t, err)
	nonce := solvePreAuthNonceForTest(t, activationChallenge.Challenge, activationChallenge.Bits)

	recorder := performLoginRequest(t, "preauth-user3", "password", activationChallenge.Id, nonce)
	assert.Contains(t, recorder.Body.String(), CodeLoginVerificationRequired)
}

// 关掉开关（或难度设 0）⇒ 恢复原样，不需要校验（紧急开关）。
func TestLoginChallengeSwitchOff(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	restore := withLoginChallengeForTest(t)
	defer restore()
	common.LoginChallengeEnabled = false

	user := model.User{Username: "preauth-user4", Password: "password", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Activated: 1, AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)

	recorder := performLoginRequest(t, "preauth-user4", "wrong-password", "", "")
	assert.NotContains(t, recorder.Body.String(), CodeLoginVerificationRequired)
	assert.Contains(t, recorder.Body.String(), `"success":false`)
}

// 注册同样门禁（开放注册的站点上不门禁注册等于白做）。
func TestRegisterWithoutChallengeIsRejected(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	restore := withLoginChallengeForTest(t)
	defer restore()
	previousRegister := common.RegisterEnabled
	previousPasswordRegister := common.PasswordRegisterEnabled
	common.RegisterEnabled = true
	common.PasswordRegisterEnabled = true
	defer func() {
		common.RegisterEnabled = previousRegister
		common.PasswordRegisterEnabled = previousPasswordRegister
	}()

	recorder := performRegisterRequest(t, "brand-new-user", "password123", "", "")
	assert.Contains(t, recorder.Body.String(), CodeLoginVerificationRequired)

	challengeId, nonce := solvePreAuthChallengeForTest(t)
	recorder = performRegisterRequest(t, "brand-new-user", "password123", challengeId, nonce)
	assert.NotContains(t, recorder.Body.String(), CodeLoginVerificationRequired, "过了校验应进入注册流程")
	// 注册流程本身可能因其它配置被拒（如邮箱验证），这里只断言"不再被校验挡住"。
}

// 领挑战的接口：开关/难度为 0 时回 enabled=false，前端据此跳过整个流程。
func TestIssueLoginChallengeShape(t *testing.T) {
	restore := withLoginChallengeForTest(t)
	defer restore()

	recorder := performLoginChallengeRequest(t)
	body := recorder.Body.String()
	assert.Contains(t, body, `"enabled":true`)
	assert.Contains(t, body, `"challenge_id"`)
	assert.Contains(t, body, `"bits":8`)

	common.ActivationPoWBits = 0
	recorder = performLoginChallengeRequest(t)
	assert.Contains(t, recorder.Body.String(), `"enabled":false`)

	common.ActivationPoWBits = 8
	common.LoginChallengeEnabled = false
	recorder = performLoginChallengeRequest(t)
	assert.Contains(t, recorder.Body.String(), `"enabled":false`)
}

func performLoginChallengeRequest(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/login_challenge", nil)
	c.Request.RemoteAddr = "127.0.0.1:1234"
	IssueLoginChallenge(c)
	return recorder
}
