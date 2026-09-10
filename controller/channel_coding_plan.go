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

// codingPlanAutoControlFields 自动启停配置在渠道保存请求里的字段名。
var codingPlanAutoControlFields = []string{
	"coding_plan_auto_control",
	"coding_plan_disable_threshold",
	"coding_plan_enable_threshold",
}

// requestCarriesCodingPlanAutoControl 请求是否携带任一自动启停字段。
func requestCarriesCodingPlanAutoControl(requestData map[string]any) bool {
	for _, f := range codingPlanAutoControlFields {
		if _, ok := requestData[f]; ok {
			return true
		}
	}
	return false
}

// syncCodingPlanAutoControlToGroup 渠道保存后,把本次请求携带的编码套餐自动启停配置
// 同步到同组(同厂商 + 同生效 key)其余渠道。同 key 多渠道共享同一套餐账号,配置必须
// 一致——编辑任一支渠道即改整个账号(余量卡合并显示正是这个语义)。未携带自动启停
// 字段的局部更新(改名称、权重等)不受影响。厂商无法解析/多 key 无单一账号的渠道
// 不构成分组,直接跳过。
func syncCodingPlanAutoControlToGroup(source *model.Channel, requestData map[string]any) error {
	if !requestCarriesCodingPlanAutoControl(requestData) {
		return nil
	}
	if _, err := service.ResolveChannelCodingPlanProvider(source); err != nil {
		return nil
	}
	srcKey := source.CodingPlanKey
	if srcKey == "" {
		srcKey = source.Key
	}
	if strings.Contains(srcKey, "\n") {
		return nil
	}
	srcGroup := codingPlanQuotaGroupID(source, srcKey)
	if srcGroup == "" {
		return nil
	}

	var channels []*model.Channel
	if err := model.DB.
		Select("id", "type", "base_url", "key", "coding_plan_provider", "coding_plan_key").
		Find(&channels).Error; err != nil {
		return err
	}
	updates := make(map[string]any)
	for _, f := range codingPlanAutoControlFields {
		if v, ok := requestData[f]; ok {
			updates[f] = v
		}
	}
	if len(updates) == 0 {
		return nil
	}
	var siblingIDs []int
	for _, ch := range channels {
		if ch.Id == source.Id {
			continue
		}
		if _, err := service.ResolveChannelCodingPlanProvider(ch); err != nil {
			continue
		}
		k := ch.CodingPlanKey
		if k == "" {
			k = ch.Key
		}
		if strings.Contains(k, "\n") {
			continue
		}
		if codingPlanQuotaGroupID(ch, k) == srcGroup {
			siblingIDs = append(siblingIDs, ch.Id)
		}
	}
	if len(siblingIDs) == 0 {
		return nil
	}
	return model.DB.Model(&model.Channel{}).Where("id IN ?", siblingIDs).Updates(updates).Error
}
