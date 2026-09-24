// @muw-owned
package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 人机校验（PoW）返回的机器码，前端据此判断是否需要重新取挑战。
const (
	// CodeActivationVerificationRequired 未带挑战，或挑战已过期/已使用/用途不符。
	CodeActivationVerificationRequired = "ACTIVATION_VERIFICATION_REQUIRED"
	// CodeActivationVerificationFailed 挑战有效但 nonce 不满足难度。
	CodeActivationVerificationFailed = "ACTIVATION_VERIFICATION_FAILED"
	// CodeLoginVerificationRequired 登录、注册或第三方登录入口未通过前置校验。
	CodeLoginVerificationRequired = "LOGIN_VERIFICATION_REQUIRED"
)

type activationChallengeData struct {
	Enabled     bool   `json:"enabled"`
	ChallengeId string `json:"challenge_id,omitempty"`
	Challenge   string `json:"challenge,omitempty"`
	Bits        int    `json:"bits,omitempty"`
	ExpiresIn   int    `json:"expires_in,omitempty"`
}

// IssueActivationChallenge 激活页领取挑战（UserAuthPending）。
// 难度为 0 时返回 enabled=false，前端跳过校验。
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

// IssueLoginChallenge 登录、注册与第三方登录入口的前置校验挑战（匿名可领）。
// 开关关闭或难度为 0 时返回 enabled=false。
func IssueLoginChallenge(c *gin.Context) {
	if !common.LoginChallengeEnabled {
		common.ApiSuccess(c, activationChallengeData{Enabled: false})
		return
	}
	writePoWChallenge(c, model.PoWPurposePreAuth, 0)
}

// writePoWChallenge 签发挑战；校验关闭（难度 0）时下发 enabled=false。
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

// requirePreAuthChallenge 校验前置凭据。返回 false 时响应已写好，调用方直接 return。
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
	default:
		// 不存在、过期、用途或用户不符，统一按"需要重新校验"返回，不区分原因。
		securityCheckError(c, CodeLoginVerificationRequired)
		return false
	}
}

// poWProofFromRequest 前置凭据走查询串，三个入口（登录/注册/oauth state）口径一致。
func poWProofFromRequest(c *gin.Context) (string, string) {
	return c.Query("challenge_id"), c.Query("nonce")
}

// securityCheckError 校验未通过的统一响应：HTTP 200 + 机器码 + i18n 文案。
func securityCheckError(c *gin.Context, code string) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"code":    code,
		"message": common.TranslateMessage(c, i18n.MsgActivationVerificationRequired),
	})
}
