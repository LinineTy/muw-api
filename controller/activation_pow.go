package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 激活页人机校验（PoW）相关机器码：前端据此区分"要重新算一遍"和"邀请码真的错了"。
const (
	// CodeActivationVerificationRequired 本次提交没带挑战、或挑战已过期/被换人使用，
	// 前端应重新领挑战并重算。
	CodeActivationVerificationRequired = "ACTIVATION_VERIFICATION_REQUIRED"
	// CodeActivationVerificationFailed 带了挑战但 nonce 不满足难度。
	CodeActivationVerificationFailed = "ACTIVATION_VERIFICATION_FAILED"
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
	bits := common.ActivationPoWBitsEffective()
	if bits <= 0 {
		common.ApiSuccess(c, activationChallengeData{Enabled: false})
		return
	}
	id := c.GetInt("id")
	if id == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	challenge, err := model.IssueActivationPoWChallenge(id, c.ClientIP(), bits)
	if err != nil {
		common.SysError("issue activation pow challenge failed: " + err.Error())
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

// activationVerificationError 人机校验未通过时统一回这个形状：HTTP 200 + 机器码，
// 与项目其它接口风格一致；message 用 i18n，前端只依赖 code 做流程判断。
func activationVerificationError(c *gin.Context, code string) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"code":    code,
		"message": common.TranslateMessage(c, i18n.MsgActivationVerificationRequired),
	})
}
