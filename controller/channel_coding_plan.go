package controller

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// codingPlanQuotaGroupID 派生渠道编码套餐余量的分组指纹。生效 key 与查询一致
// (CodingPlanKey 优先,空则用渠道自身 key),sha256 截断成不可逆指纹并拼上厂商,
// 同 key 多渠道得到同一值,前端据此合并成一张余量卡。厂商无法解析或 key 为空返回空串。
func codingPlanQuotaGroupID(channel *model.Channel, effectiveKey string) string {
	if effectiveKey == "" {
		return ""
	}
	provider, err := service.ResolveChannelCodingPlanProvider(channel)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256([]byte(effectiveKey))
	return fmt.Sprintf("%s:%x", provider, sum[:8])
}

// ChannelCodingPlanQuota 查询渠道的编码套餐余量。
// 渠道需启用监控(显式 provider 或 base_url/类型可探测);key 优先用渠道的套餐专用
// 密钥 CodingPlanKey,留空则用渠道自身 key。多 key 渠道且无专用密钥时 key 不明确,拒绝。
func ChannelCodingPlanQuota(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "Invalid channel id")
		return
	}
	channel, err := model.GetChannelById(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	provider, apiKey, err := codingPlanTargetOfChannel(channel)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	quota, err := service.QueryCodingPlanQuota(c.Request.Context(), provider, apiKey)
	if err != nil {
		common.ApiErrorMsg(c, fmt.Sprintf("Failed to query coding plan quota: %s", err.Error()))
		return
	}
	common.ApiSuccess(c, quota)
}


// codingPlanTargetOfChannel 渠道视角的余量查询目标：优先用渠道绑定的账户（凭证真相源），
// 账户未挂载时回退渠道 legacy 列（迁移过渡期）。
func codingPlanTargetOfChannel(channel *model.Channel) (service.CodingPlanProvider, string, error) {
	if channel.Account != nil {
		provider, err := service.ResolveAccountCodingPlanProvider(channel.Account)
		if err != nil {
			return "", "", err
		}
		key, err := CodingPlanQueryKeyOfAccount(channel.Account)
		if err != nil {
			return "", "", err
		}
		return provider, key, nil
	}
	provider, err := service.ResolveChannelCodingPlanProvider(channel)
	if err != nil {
		return "", "", err
	}
	apiKey := strings.TrimSpace(channel.CodingPlanKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(channel.Key)
	}
	if apiKey == "" {
		return "", "", errors.New("channel has no key to query coding plan quota")
	}
	return provider, apiKey, nil
}

// CodingPlanQueryKeyOfAccount 账户的余量查询 key：套餐专用 key 优先；留空用账户自身 key
// （多 key 账户取第一把——2026-09-10 定，取代此前"多 key 拒绝查询"）。
func CodingPlanQueryKeyOfAccount(account *model.Account) (string, error) {
	if key := strings.TrimSpace(account.CodingPlanKey); key != "" {
		return key, nil
	}
	keys := account.GetKeys()
	if len(keys) == 0 {
		return "", errors.New("account has no key to query coding plan quota")
	}
	key := strings.TrimSpace(keys[0])
	if key == "" {
		return "", errors.New("account has no key to query coding plan quota")
	}
	return key, nil
}
