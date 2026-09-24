// @muw-owned
package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 人机校验（PoW）相关的机器码：前端据此区分"要重新算一遍"和"凭据真的错了"。
const (
	// CodeActivationVerificationRequired 本次提交没带挑战、或挑战已过期/被换人/换用途使用，
	// 前端应重新领挑战并重算。
	CodeActivationVerificationRequired = "ACTIVATION_VERIFICATION_REQUIRED"
	// CodeActivationVerificationFailed 带了挑战但 nonce 不满足难度。
	CodeActivationVerificationFailed = "ACTIVATION_VERIFICATION_FAILED"
	// CodeLoginVerificationRequired 登录/注册/第三方入口未通过前置校验（同上，重新领挑战）。
	CodeLoginVerificationRequired = "LOGIN_VERIFICATION_REQUIRED"
)

type activationChallengeData struct {
	Enabled     bool   `json:"enabled"`
	ChallengeId string `json:"challenge_id,omitempty"`
	Challenge   string `json:"challenge,omitempty"`
	Bits        int    `json:"bits,omitempty"`
	ExpiresIn   int    `json:"expires_in,omitempty"`
}

// IssueActivationChallenge 激活页在提交邀请码前先领一道挑战（用户已登录但可能未激活，
// 走 UserAuthPending 中间件）。难度由 option PoWChallengeBits 控制，<=0 时返回 enabled=false，
// 表示本站不要求人机校验，前端跳过即可。
func IssueActivationChallenge(c *gin.Context) {
	if !common.InviteCodeRegisterEnabled {
		common.ApiErrorI18n(c, i18n.MsgUserNotActivated)
		return
	}
	id := c.GetInt("id")
	if id == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	writePoWChallenge(c, model.PoWPurposeActivation, id)
}

// IssueLoginChallenge 登录/注册/第三方入口的前置校验挑战（匿名可领，绑 IP 与用途）。
// 开关 option LoginChallengeEnabled 关闭或难度为 0 时返回 enabled=false，前端按"不校验收"处理。
func IssueLoginChallenge(c *gin.Context) {
	if !common.LoginChallengeEnabled {
		common.ApiSuccess(c, activationChallengeData{Enabled: false})
		return
	}
	writePoWChallenge(c, model.PoWPurposePreAuth, 0)
}

// writePoWChallenge 签发并下发一道挑战；难度为 0（校验已关）时下发 enabled=false。
func writePoWChallenge(c *gin.Context, purpose string, userId int) {
	bits := common.ActivationPoWBitsEffective()
	if bits <= 0 {
		common.ApiSuccess(c, activationChallengeData{Enabled: false})
		return
	}
	challenge, err := model.IssuePoWChallenge(purpose, userId, c.ClientIP(), bits)
	if err != nil {
		common.SysError("issue pow challenge failed: " + err.Error())
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	common.ApiSuccess(c, activationChallengeData{
		Enabled:     true,
		ChallengeId: challenge.Id,
		Challenge:   challenge.Challenge,
		Bits:        challenge.Bits,
		ExpiresIn:   int(model.ActivationPoWChallengeTTL.Seconds()),
	})
}

// requirePreAuthChallenge 校验登录/注册/第三方入口的前置校验凭据。
// 返回 true = 放行（校验关闭，或凭据有效）；返回 false = 已写好带机器码的响应，调用方直接 return。
func requirePreAuthChallenge(c *gin.Context) bool {
	if !common.LoginChallengeEnabled {
		return true
	}
	if common.ActivationPoWBitsEffective() <= 0 {
		return true
	}
	challengeId, nonce := poWProofFromRequest(c)
	switch err := model.ConsumePoWChallenge(challengeId, model.PoWPurposePreAuth, 0, nonce); {
	case err == nil:
		return true
	case err == model.ErrPoWInvalidNonce:
		securityCheckError(c, CodeLoginVerificationRequired)
		return false
	default:
		// 不存在/过期/用户不符/用途不符一律按"需要重新校验"回，不区分原因。
		securityCheckError(c, CodeLoginVerificationRequired)
		return false
	}
}

// poWProofFromRequest 前置校验的凭据走查询串（login/register/oauth-state 三个入口统一），
// 避免为了两个字段去动各请求体结构（注册体直接是 model.User）。
func poWProofFromRequest(c *gin.Context) (string, string) {
	return c.Query("challenge_id"), c.Query("nonce")
}

// securityCheckError 人机校验未通过时统一回这个形状：HTTP 200 + 机器码，
// 与项目其它接口风格一致；message 用 i18n，前端只依赖 code 做流程判断。
func securityCheckError(c *gin.Context, code string) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"code":    code,
		"message": common.TranslateMessage(c, i18n.MsgActivationVerificationRequired),
	})
}
