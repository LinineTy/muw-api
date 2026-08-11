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

// resolveChannelCodingPlanProvider 解析渠道的编码套餐厂商,优先级:
//  1. 渠道显式配置的 CodingPlanProvider(权威,覆盖聚合前置场景)
//  2. 按 base_url 探测(含上游 ChannelSpecialBases 符号键,如 glm-coding-plan)
//  3. 按渠道类型给出默认(智谱v4→zhipu、Moonshot→kimi、MiniMax→minimax、火山→volcengine)
func resolveChannelCodingPlanProvider(channel *model.Channel) (service.CodingPlanProvider, error) {
	if channel.CodingPlanProvider != nil {
		if p := strings.TrimSpace(*channel.CodingPlanProvider); p != "" {
			if service.IsKnownCodingPlanProvider(p) {
				return service.CodingPlanProvider(p), nil
			}
			return "", fmt.Errorf("unsupported coding plan provider: %s", p)
		}
	}
	var baseURL string
	if channel.BaseURL != nil {
		baseURL = *channel.BaseURL
	}
	if detected, ok := service.DetectCodingPlanProvider(baseURL); ok {
		return detected, nil
	}
	if detected, ok := service.CodingPlanProviderFromChannelType(channel.Type); ok {
		return detected, nil
	}
	return "", errors.New("coding plan quota is not enabled for this channel (set coding_plan_provider)")
}

// codingPlanQuotaGroupID 派生渠道编码套餐余量的分组指纹。生效 key 与查询一致
// (CodingPlanKey 优先,空则用渠道自身 key),sha256 截断成不可逆指纹并拼上厂商,
// 同 key 多渠道得到同一值,前端据此合并成一张余量卡。厂商无法解析或 key 为空返回空串。
func codingPlanQuotaGroupID(channel *model.Channel, effectiveKey string) string {
	if effectiveKey == "" {
		return ""
	}
	provider, err := resolveChannelCodingPlanProvider(channel)
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
	provider, err := resolveChannelCodingPlanProvider(channel)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	apiKey := channel.CodingPlanKey
	if apiKey == "" {
		apiKey = channel.Key
	}
	if strings.Contains(apiKey, "\n") {
		common.ApiErrorMsg(c, "Multi-key channels need a dedicated coding plan key to query quota")
		return
	}
	quota, err := service.QueryCodingPlanQuota(c.Request.Context(), provider, apiKey)
	if err != nil {
		common.ApiErrorMsg(c, fmt.Sprintf("Failed to query coding plan quota: %s", err.Error()))
		return
	}
	common.ApiSuccess(c, quota)
}
