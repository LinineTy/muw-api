package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/ollama"
	"github.com/QuantumNous/new-api/relay/channel/opencodezen"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type OpenAIModel struct {
	ID         string         `json:"id"`
	Object     string         `json:"object"`
	Created    int64          `json:"created"`
	OwnedBy    string         `json:"owned_by"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	Permission []struct {
		ID                 string `json:"id"`
		Object             string `json:"object"`
		Created            int64  `json:"created"`
		AllowCreateEngine  bool   `json:"allow_create_engine"`
		AllowSampling      bool   `json:"allow_sampling"`
		AllowLogprobs      bool   `json:"allow_logprobs"`
		AllowSearchIndices bool   `json:"allow_search_indices"`
		AllowView          bool   `json:"allow_view"`
		AllowFineTuning    bool   `json:"allow_fine_tuning"`
		Organization       string `json:"organization"`
		Group              string `json:"group"`
		IsBlocking         bool   `json:"is_blocking"`
	} `json:"permission"`
	Root   string `json:"root"`
	Parent string `json:"parent"`
}

type OpenAIModelsResponse struct {
	Data    []OpenAIModel `json:"data"`
	Success bool          `json:"success"`
}

func parseStatusFilter(statusParam string) int {
	switch strings.ToLower(statusParam) {
	case "enabled", "1":
		return common.ChannelStatusEnabled
	case "disabled", "0":
		return 0
	default:
		return -1
	}
}

func clearChannelInfo(channel *model.Channel) {
	if channel.ChannelInfo.IsMultiKey {
		channel.ChannelInfo.MultiKeyDisabledReason = nil
		channel.ChannelInfo.MultiKeyDisabledTime = nil
	}
}

// maskCodingPlanKey 套餐专用密钥的脱敏预览:保留前 4 位 + **** + 后 4 位;空值原样返回。
// 真实值由 CodingPlanKey(json:"-") 持有,永不进入响应体。
func maskCodingPlanKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "****" + key[len(key)-4:]
}

func applyChannelStatusFilter(query *gorm.DB, statusFilter int) *gorm.DB {
	if statusFilter == common.ChannelStatusEnabled {
		return query.Where("status = ?", common.ChannelStatusEnabled)
	}
	if statusFilter == 0 {
		return query.Where("status != ?", common.ChannelStatusEnabled)
	}
	return query
}

func buildChannelListQuery(group string, statusFilter int, typeFilter int) *gorm.DB {
	query := model.DB.Model(&model.Channel{})
	query = model.ApplyChannelGroupFilter(query, group)
	query = applyChannelStatusFilter(query, statusFilter)
	if typeFilter >= 0 {
		query = query.Where("type = ?", typeFilter)
	}
	return query
}

func GetChannelOps(c *gin.Context) {
	common.ApiSuccess(c, gin.H{
		"retry_times": common.RetryTimes,
	})
}

func GetAllChannels(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	channelData := make([]*model.Channel, 0)
	idSort, _ := strconv.ParseBool(c.Query("id_sort"))
	sortOptions := model.NewChannelSortOptions(c.Query("sort_by"), c.Query("sort_order"), idSort)
	enableTagMode, _ := strconv.ParseBool(c.Query("tag_mode"))
	groupFilter := model.NormalizeChannelGroupFilter(c.Query("group"))
	statusParam := c.Query("status")
	// statusFilter: -1 all, 1 enabled, 0 disabled (include auto & manual)
	statusFilter := parseStatusFilter(statusParam)
	// type filter
	typeStr := c.Query("type")
	typeFilter := -1
	if typeStr != "" {
		if t, err := strconv.Atoi(typeStr); err == nil {
			typeFilter = t
		}
	}

	var total int64

	if enableTagMode {
		tags, err := model.GetPaginatedChannelTags(buildChannelListQuery(groupFilter, statusFilter, typeFilter), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
		if err != nil {
			common.SysError("failed to get paginated tags: " + err.Error())
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取标签失败，请稍后重试"})
			return
		}
		total, err = model.CountChannelTags(buildChannelListQuery(groupFilter, statusFilter, typeFilter))
		if err != nil {
			common.SysError("failed to count tags: " + err.Error())
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取标签数量失败，请稍后重试"})
			return
		}
		for _, tag := range tags {
			if tag == nil || *tag == "" {
				continue
			}
			var tagChannels []*model.Channel
			err := sortOptions.Apply(buildChannelListQuery(groupFilter, statusFilter, typeFilter).Where("tag = ?", *tag)).
				Omit("key").
				Find(&tagChannels).Error
			if err != nil {
				common.SysError("failed to get channels by tag: " + err.Error())
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取标签渠道失败，请稍后重试"})
				return
			}
			channelData = append(channelData, tagChannels...)
		}
	} else {
		if err := buildChannelListQuery(groupFilter, statusFilter, typeFilter).Count(&total).Error; err != nil {
			common.SysError("failed to count channels: " + err.Error())
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取渠道数量失败，请稍后重试"})
			return
		}

		err := sortOptions.Apply(buildChannelListQuery(groupFilter, statusFilter, typeFilter)).
			Limit(pageInfo.GetPageSize()).
			Offset(pageInfo.GetStartIdx()).
			Omit("key").
			Find(&channelData).Error
		if err != nil {
			common.SysError("failed to get channels: " + err.Error())
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取渠道列表失败，请稍后重试"})
			return
		}
	}

	// 填充渠道内模型设置（禁用/上下文覆盖），供列表展示禁用图标与上下文信息。
	// 本接口列表查询是内联的（未走 model.GetAllChannels），必须显式加载。
	if err := model.LoadChannelsModelSettings(channelData); err != nil {
		common.SysError("failed to load channel model settings: " + err.Error())
	}
	// 挂载账户：余额/多key状态等凭证侧数据以账户为准（响应侧覆盖展示）。
	if err := model.LoadChannelsAccounts(channelData); err != nil {
		common.SysError("failed to load channel accounts: " + err.Error())
	} else {
		for _, ch := range channelData {
			if ch.Account != nil {
				ch.Balance = ch.Account.Balance
				ch.BalanceUpdatedTime = ch.Account.BalanceUpdatedTime
				ch.ChannelInfo = ch.Account.ChannelInfo
			}
		}
	}

	for _, datum := range channelData {
		clearChannelInfo(datum)
	}

	// 编码套餐余量分组:列表对 key 用了 Omit 不下发,额外按 id 拉一次密钥算不可逆指纹,
	// 供前端把同 key 的多个渠道合并成一张余量卡。非套餐渠道该字段为空;查询失败仅记日志,
	// 不阻断列表返回。
	if len(channelData) > 0 {
		ids := make([]int, len(channelData))
		for i := range channelData {
			ids[i] = channelData[i].Id
		}
		var keyRows []struct {
			Id  int
			Key string
		}
		if err := model.DB.Model(&model.Channel{}).
			Where("id IN ?", ids).
			Select("id", "key").
			Find(&keyRows).Error; err != nil {
			common.SysError("failed to load channel keys for coding plan grouping: " + err.Error())
		} else {
			mainKeyByID := make(map[int]string, len(keyRows))
			for _, r := range keyRows {
				mainKeyByID[r.Id] = r.Key
			}
			for i := range channelData {
				ch := channelData[i]
				// 余量是账户级数据：挂了账户的渠道按账户分组（同一账户被多渠道引用时合并成
				// 一张余量卡）；未挂账户的渠道回退旧的「同厂商 + 同 key」指纹（迁移过渡期）。
				if len(ch.BoundAccounts) > 0 {
					ch.CodingPlanQuotaGroup = fmt.Sprintf("a:%d", ch.BoundAccounts[0].Id)
					continue
				}
				effective := ch.CodingPlanKey
				if effective == "" {
					effective = mainKeyByID[ch.Id]
				}
				ch.CodingPlanQuotaGroup = codingPlanQuotaGroupID(ch, effective)
			}
		}
	}

	countQuery := buildChannelListQuery(groupFilter, statusFilter, -1)
	var results []struct {
		Type  int64
		Count int64
	}
	if err := countQuery.Select("type, count(*) as count").Group("type").Find(&results).Error; err != nil {
		common.SysError("failed to count channel types: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取渠道类型统计失败，请稍后重试"})
		return
	}
	typeCounts := make(map[int64]int64)
	for _, r := range results {
		typeCounts[r.Type] = r.Count
	}
	common.ApiSuccess(c, gin.H{
		"items":       channelData,
		"total":       total,
		"page":        pageInfo.GetPage(),
		"page_size":   pageInfo.GetPageSize(),
		"type_counts": typeCounts,
	})
	return
}

func buildFetchModelsHeaders(channel *model.Channel, key string) (http.Header, error) {
	var headers http.Header
	switch channel.Type {
	case constant.ChannelTypeAnthropic:
		headers = GetClaudeAuthHeader(key)
	case constant.ChannelTypeOpenCodeZen:
		// OpenCode Zen 未填密钥时用 public 匿名访问免费套餐
		if strings.TrimSpace(key) == "" {
			headers = GetAuthHeader(opencodezen.PublicApiKey)
		} else {
			headers = GetAuthHeader(key)
		}
	default:
		headers = GetAuthHeader(key)
	}

	if err := applyFetchModelsHeaderOverrides(channel, key, headers); err != nil {
		return nil, err
	}
	return headers, nil
}

func applyFetchModelsHeaderOverrides(channel *model.Channel, key string, headers http.Header) error {
	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:          key,
			HeadersOverride: channel.GetHeaderOverride(),
		},
	}
	overrides, err := relaychannel.ResolveHeaderOverride(info, nil)
	if err != nil {
		return err
	}
	for name, value := range overrides {
		headers.Set(name, value)
	}

	return nil
}

func FetchUpstreamModels(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	channel, err := model.GetChannelById(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	ids, err := fetchChannelUpstreamModelIDs(channel)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("获取模型列表失败: %s", err.Error()),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    ids,
	})
}

func FixChannelsAbilities(c *gin.Context) {
	success, fails, err := model.FixAbility()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"success": success,
			"fails":   fails,
		},
	})
}

func SearchChannels(c *gin.Context) {
	keyword := c.Query("keyword")
	group := c.Query("group")
	modelKeyword := c.Query("model")
	statusParam := c.Query("status")
	statusFilter := parseStatusFilter(statusParam)
	idSort, _ := strconv.ParseBool(c.Query("id_sort"))
	sortOptions := model.NewChannelSortOptions(c.Query("sort_by"), c.Query("sort_order"), idSort)
	enableTagMode, _ := strconv.ParseBool(c.Query("tag_mode"))
	channelData := make([]*model.Channel, 0)
	if enableTagMode {
		tags, err := model.SearchTags(keyword, group, modelKeyword, idSort)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		for _, tag := range tags {
			if tag != nil && *tag != "" {
				var tagChannels []*model.Channel
				err := sortOptions.Apply(buildChannelListQuery(group, -1, -1).Where("tag = ?", *tag)).
					Omit("key").
					Find(&tagChannels).Error
				if err != nil {
					c.JSON(http.StatusOK, gin.H{
						"success": false,
						"message": err.Error(),
					})
					return
				}
				channelData = append(channelData, tagChannels...)
			}
		}
	} else {
		channels, err := model.SearchChannels(keyword, group, modelKeyword, idSort, sortOptions)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		channelData = channels
	}

	if statusFilter == common.ChannelStatusEnabled || statusFilter == 0 {
		filtered := make([]*model.Channel, 0, len(channelData))
		for _, ch := range channelData {
			if statusFilter == common.ChannelStatusEnabled && ch.Status != common.ChannelStatusEnabled {
				continue
			}
			if statusFilter == 0 && ch.Status == common.ChannelStatusEnabled {
				continue
			}
			filtered = append(filtered, ch)
		}
		channelData = filtered
	}

	// calculate type counts for search results
	typeCounts := make(map[int64]int64)
	for _, channel := range channelData {
		typeCounts[int64(channel.Type)]++
	}

	typeParam := c.Query("type")
	typeFilter := -1
	if typeParam != "" {
		if tp, err := strconv.Atoi(typeParam); err == nil {
			typeFilter = tp
		}
	}

	if typeFilter >= 0 {
		filtered := make([]*model.Channel, 0, len(channelData))
		for _, ch := range channelData {
			if ch.Type == typeFilter {
				filtered = append(filtered, ch)
			}
		}
		channelData = filtered
	}

	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	total := len(channelData)
	startIdx := min((page-1)*pageSize, total)
	endIdx := min(startIdx+pageSize, total)

	pagedData := channelData[startIdx:endIdx]

	for _, datum := range pagedData {
		clearChannelInfo(datum)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":       pagedData,
			"total":       total,
			"type_counts": typeCounts,
		},
	})
	return
}

func GetChannel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channel, err := model.GetChannelById(id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if channel != nil {
		clearChannelInfo(channel)
		channel.CodingPlanKeyMasked = maskCodingPlanKey(channel.CodingPlanKey)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    channel,
	})
	return
}

// GetChannelKey 获取渠道密钥（需要通过安全验证中间件）
// 此函数依赖 SecureVerificationRequired 中间件，确保用户已通过安全验证
func GetChannelKey(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelId <= 0 {
		common.ApiErrorMsg(c, "渠道ID格式错误")
		return
	}

	// 获取渠道信息（包含密钥）
	channel, err := model.GetChannelById(channelId, true)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorI18n(c, i18n.MsgChannelNotExists)
		return
	}
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}

	// 记录操作审计日志（高危：查看渠道密钥）
	recordManageAudit(c, "channel.key_view", map[string]any{
		"id":   channelId,
		"name": channel.Name,
	})

	// 返回渠道密钥
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "获取成功",
		"data": map[string]any{
			"key": channel.Key,
		},
	})
}

// validateChannel 通用的渠道校验函数
func validateChannel(channel *model.Channel, isAdd bool) error {
	if channel == nil {
		return fmt.Errorf("channel cannot be empty")
	}

	// 校验 channel settings
	if err := channel.ValidateSettings(); err != nil {
		return fmt.Errorf("渠道额外设置[channel setting] 格式错误：%s", err.Error())
	}
	if channel.Type == constant.ChannelTypeTaskPlugin {
		pluginKey := strings.TrimSpace(channel.GetSetting().TaskPluginKey)
		if pluginKey == "" {
			return fmt.Errorf("task plugin key is required")
		}
		if len(pluginKey) > 30 {
			return fmt.Errorf("task plugin key must not exceed 30 characters")
		}
		plugin, ok := jsplugin.DefaultRegistry.Get(pluginKey)
		if !ok {
			return fmt.Errorf("task plugin %q is not registered", pluginKey)
		}
		if channel.BaseURL == nil || strings.TrimSpace(*channel.BaseURL) == "" {
			// The plugin default is persisted onto the channel instead of being
			// resolved per request, so the destination host stays an auditable
			// channel property that only an administrator edit can change.
			if plugin.Meta.BaseURL == "" {
				return fmt.Errorf("base URL is required for task plugin channels")
			}
			defaultBaseURL := plugin.Meta.BaseURL
			channel.BaseURL = &defaultBaseURL
		}
	}

	if channel.Type == constant.ChannelTypeNewAPI && strings.TrimSpace(channel.GetBaseURL()) == "" {
		return fmt.Errorf("New API channel base URL cannot be empty")
	}

	// 如果是添加操作，检查 channel 和 key 是否为空
	if isAdd {
		// OpenCode Zen 不填密钥时走免费套餐，key 可留空；其余渠道必须填密钥
		if channel.Key == "" && channel.Type != constant.ChannelTypeOpenCodeZen {
			return fmt.Errorf("channel cannot be empty")
		}

		// 检查模型名称长度是否超过 255
		for _, m := range channel.GetModels() {
			if len(m) > 255 {
				return fmt.Errorf("模型名称过长: %s", m)
			}
		}
	}

	// VertexAI 特殊校验
	if channel.Type == constant.ChannelTypeVertexAi {
		if channel.Other == "" {
			return fmt.Errorf("部署地区不能为空")
		}

		regionMap, err := common.StrToMap(channel.Other)
		if err != nil {
			return fmt.Errorf("部署地区必须是标准的Json格式，例如{\"default\": \"us-central1\", \"region2\": \"us-east1\"}")
		}

		if regionMap["default"] == nil {
			return fmt.Errorf("部署地区必须包含default字段")
		}
	}

	// Codex OAuth key validation (optional, only when JSON object is provided)
	if channel.Type == constant.ChannelTypeCodex {
		trimmedKey := strings.TrimSpace(channel.Key)
		if isAdd || trimmedKey != "" {
			if !strings.HasPrefix(trimmedKey, "{") {
				return fmt.Errorf("Codex key must be a valid JSON object")
			}
			var keyMap map[string]any
			if err := common.Unmarshal([]byte(trimmedKey), &keyMap); err != nil {
				return fmt.Errorf("Codex key must be a valid JSON object")
			}
			if v, ok := keyMap["access_token"]; !ok || v == nil || strings.TrimSpace(fmt.Sprintf("%v", v)) == "" {
				return fmt.Errorf("Codex key JSON must include access_token")
			}
			if v, ok := keyMap["account_id"]; !ok || v == nil || strings.TrimSpace(fmt.Sprintf("%v", v)) == "" {
				return fmt.Errorf("Codex key JSON must include account_id")
			}
		}
	}

	// 编码套餐自动启停阈值校验:禁用阈值 1-100,恢复阈值 0-100 且必须严格小于禁用阈值
	// (保证滞回,避免边界抖动)。
	if channel.CodingPlanDisableThreshold != nil {
		d := *channel.CodingPlanDisableThreshold
		if d < 1 || d > 100 {
			return fmt.Errorf("编码套餐禁用阈值必须在 1-100 之间")
		}
		if channel.CodingPlanEnableThreshold != nil && *channel.CodingPlanEnableThreshold >= d {
			return fmt.Errorf("编码套餐恢复阈值必须小于禁用阈值")
		}
	}
	if channel.CodingPlanEnableThreshold != nil {
		if e := *channel.CodingPlanEnableThreshold; e < 0 || e > 100 {
			return fmt.Errorf("编码套餐恢复阈值必须在 0-100 之间")
		}
	}

	return nil
}

func RefreshCodexChannelCredential(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	oauthKey, ch, err := service.RefreshCodexChannelCredential(ctx, channelId, service.CodexCredentialRefreshOptions{ResetCaches: true})
	if err != nil {
		common.SysError("failed to refresh codex channel credential: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "刷新凭证失败，请稍后重试"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "refreshed",
		"data": gin.H{
			"expires_at":   oauthKey.Expired,
			"last_refresh": oauthKey.LastRefresh,
			"account_id":   oauthKey.AccountID,
			"email":        oauthKey.Email,
			"channel_id":   ch.Id,
			"channel_type": ch.Type,
			"channel_name": ch.Name,
		},
	})
}

type AddChannelRequest struct {
	Mode                      string                `json:"mode"`
	MultiKeyMode              constant.MultiKeyMode `json:"multi_key_mode"`
	BatchAddSetKeyPrefix2Name bool                  `json:"batch_add_set_key_prefix_2_name"`
	Channel                   *model.Channel        `json:"channel"`
	// 套餐专用密钥(可选),仅用于编码套餐余量监控,不参与转发。
	CodingPlanKey *string `json:"coding_plan_key"`
	// AccountID 单账户绑定(兼容保留):显式指定则凭证使用该账户(key/base_url 等忽略),
	// 与 batch/multi_to_single 模式互斥(账户已有固定 key 列表)。
	AccountID *int `json:"account_id"`
	// AccountIDs 账户绑定列表(N:N):一个渠道可绑多个账户,用法与渠道多 key 一致——
	// 按列表顺序轮询。与 AccountID 同时出现时以本字段为准。
	AccountIDs []int `json:"account_ids"`
	// AccountBindings 账户绑定列表(带渠道内启停):优先级最高,前端抽屉提交的形态。
	AccountBindings []BindingInput `json:"account_bindings"`
}

// specIDs 取绑定意图里的账户 id（保序）。
func specIDs(specs []model.BindingSpec) []int {
	ids := make([]int, 0, len(specs))
	for _, spec := range specs {
		if spec.AccountID > 0 {
			ids = append(ids, spec.AccountID)
		}
	}
	return ids
}

// BindingInput 渠道绑定账户的请求形态（顺序即轮询顺序）。
type BindingInput struct {
	AccountID int   `json:"account_id"`
	Enabled   *bool `json:"enabled"`
}

// normalizeBindingSpecs 归一绑定意图：account_bindings（带启停）> account_ids >
// account_id（兼容旧客户端）。去重去零、保序。
func normalizeBindingSpecs(bindings []BindingInput, ids []int, single *int) []model.BindingSpec {
	specs := make([]model.BindingSpec, 0, len(bindings))
	seen := make(map[int]bool, len(bindings))
	for _, b := range bindings {
		if b.AccountID <= 0 || seen[b.AccountID] {
			continue
		}
		seen[b.AccountID] = true
		enabled := true
		if b.Enabled != nil {
			enabled = *b.Enabled
		}
		specs = append(specs, model.BindingSpec{AccountID: b.AccountID, Enabled: enabled})
	}
	if len(specs) > 0 {
		return specs
	}
	for _, id := range normalizeBoundAccountIDs(ids, single) {
		specs = append(specs, model.BindingSpec{AccountID: id, Enabled: true})
	}
	return specs
}

// normalizeBoundAccountIDs 归一账户绑定列表：account_ids 优先（去重去零、保序），
// 否则退回单值 account_id（兼容旧客户端）。
func normalizeBoundAccountIDs(ids []int, single *int) []int {
	res := make([]int, 0, len(ids)+1)
	seen := make(map[int]bool, len(ids)+1)
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		res = append(res, id)
	}
	if len(res) == 0 && single != nil && *single > 0 {
		res = append(res, *single)
	}
	return res
}

func getVertexArrayKeys(keys string) ([]string, error) {
	if keys == "" {
		return nil, nil
	}
	var keyArray []any
	err := common.Unmarshal([]byte(keys), &keyArray)
	if err != nil {
		return nil, fmt.Errorf("批量添加 Vertex AI 必须使用标准的JsonArray格式，例如[{key1}, {key2}...]，请检查输入: %w", err)
	}
	cleanKeys := make([]string, 0, len(keyArray))
	for _, key := range keyArray {
		var keyStr string
		switch v := key.(type) {
		case string:
			keyStr = strings.TrimSpace(v)
		default:
			bytes, err := json.Marshal(v)
			if err != nil {
				return nil, fmt.Errorf("Vertex AI key JSON 编码失败: %w", err)
			}
			keyStr = string(bytes)
		}
		if keyStr != "" {
			cleanKeys = append(cleanKeys, keyStr)
		}
	}
	if len(cleanKeys) == 0 {
		return nil, fmt.Errorf("批量添加 Vertex AI 的 keys 不能为空")
	}
	return cleanKeys, nil
}

func AddChannel(c *gin.Context) {
	addChannelRequest := AddChannelRequest{}
	err := c.ShouldBindJSON(&addChannelRequest)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	if addChannelRequest.Channel != nil && addChannelRequest.Channel.Type == constant.ChannelTypeTaskPlugin &&
		!authz.Can(c.GetInt("id"), c.GetInt("role"), authz.TaskPluginBind) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "task plugin channels require the task_plugin.bind permission",
		})
		return
	}

	baseURLFromPluginDefault := addChannelRequest.Channel != nil &&
		addChannelRequest.Channel.Type == constant.ChannelTypeTaskPlugin &&
		(addChannelRequest.Channel.BaseURL == nil || strings.TrimSpace(*addChannelRequest.Channel.BaseURL) == "")
	// 使用统一的校验函数
	if err := validateChannel(addChannelRequest.Channel, true); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	// 编码套餐配置（provider / 套餐专用密钥 / 自动启停阈值）在账户改造后由账户承载，
	// 渠道创建同样忽略这些 legacy 字段。
	stripLegacyCodingPlanFields(addChannelRequest.Channel)

	addChannelRequest.Channel.CreatedTime = common.GetTimestamp()

	// 共享账户路径：凭证全部来自既有账户，忽略 key 输入；单渠道创建。
	// 账户绑定列表（N:N）：account_ids 优先，account_id 兼容保留。
	boundAccountIDs := normalizeBoundAccountIDs(addChannelRequest.AccountIDs, addChannelRequest.AccountID)
	boundSpecs := normalizeBindingSpecs(addChannelRequest.AccountBindings, addChannelRequest.AccountIDs, addChannelRequest.AccountID)
	if len(boundAccountIDs) == 0 && len(boundSpecs) > 0 {
		boundAccountIDs = specIDs(boundSpecs)
	}
	if len(boundAccountIDs) > 0 {
		if addChannelRequest.Mode != "" && addChannelRequest.Mode != "single" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "绑定账户时仅支持 single 模式（账户已持有完整 key 列表）",
			})
			return
		}
		// 类型不做校验（2026-09-10 定）：OpenAI 兼容端点在多数渠道类型下通用，
		// 拿类型卡绑定会卡死自己；能不能通由使用者判断、由渠道测试验证。
		for _, accountId := range boundAccountIDs {
			account, err := model.GetAccountById(accountId, true)
			if err != nil {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "账户不存在: " + err.Error()})
				return
			}
			if account.Status != common.ChannelStatusEnabled {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "账户已被禁用，请先启用账户: " + account.Name})
				return
			}
		}
		// 挂账户的渠道不再持有凭证；多 key 状态（IsMultiKey/Mode）以账户为准，
		// 渠道请求携带的 ChannelInfo 凭证部分忽略。
		addChannelRequest.Channel.AccountId = boundAccountIDs[0]
		addChannelRequest.Channel.Key = ""
		addChannelRequest.Channel.ChannelInfo = model.ChannelInfo{}
		if err := addChannelRequest.Channel.Insert(); err != nil {
			common.ApiError(c, err)
			return
		}
		if err := model.ReplaceChannelAccountBindingsWithSpecs(addChannelRequest.Channel.Id, boundSpecs); err != nil {
			common.ApiError(c, err)
			return
		}
		recordManageAudit(c, "channel.create", map[string]interface{}{
			"name":        addChannelRequest.Channel.Name,
			"type":        addChannelRequest.Channel.Type,
			"count":       1,
			"account_ids": boundAccountIDs,
		})
		c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
		return
	}

	keys := make([]string, 0)
	switch addChannelRequest.Mode {
	case "multi_to_single":
		addChannelRequest.Channel.ChannelInfo.IsMultiKey = true
		addChannelRequest.Channel.ChannelInfo.MultiKeyMode = addChannelRequest.MultiKeyMode
		if addChannelRequest.Channel.Type == constant.ChannelTypeVertexAi && addChannelRequest.Channel.GetOtherSettings().VertexKeyType != dto.VertexKeyTypeAPIKey {
			array, err := getVertexArrayKeys(addChannelRequest.Channel.Key)
			if err != nil {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": err.Error(),
				})
				return
			}
			addChannelRequest.Channel.ChannelInfo.MultiKeySize = len(array)
			addChannelRequest.Channel.Key = strings.Join(array, "\n")
		} else {
			cleanKeys := make([]string, 0)
			for key := range strings.SplitSeq(addChannelRequest.Channel.Key, "\n") {
				if key == "" {
					continue
				}
				key = strings.TrimSpace(key)
				cleanKeys = append(cleanKeys, key)
			}
			addChannelRequest.Channel.ChannelInfo.MultiKeySize = len(cleanKeys)
			addChannelRequest.Channel.Key = strings.Join(cleanKeys, "\n")
		}
		keys = []string{addChannelRequest.Channel.Key}
	case "batch":
		if addChannelRequest.Channel.Type == constant.ChannelTypeVertexAi && addChannelRequest.Channel.GetOtherSettings().VertexKeyType != dto.VertexKeyTypeAPIKey {
			// multi json
			keys, err = getVertexArrayKeys(addChannelRequest.Channel.Key)
			if err != nil {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": err.Error(),
				})
				return
			}
		} else {
			keys = strings.Split(addChannelRequest.Channel.Key, "\n")
		}
	case "single":
		keys = []string{addChannelRequest.Channel.Key}
	default:
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "不支持的添加模式",
		})
		return
	}

	channels := make([]model.Channel, 0, len(keys))
	for _, key := range keys {
		// OpenCode Zen 允许空密钥（免费套餐），其余渠道跳过空密钥
		if key == "" && addChannelRequest.Channel.Type != constant.ChannelTypeOpenCodeZen {
			continue
		}
		localChannel := addChannelRequest.Channel
		localChannel.Key = key
		if addChannelRequest.BatchAddSetKeyPrefix2Name && len(keys) > 1 {
			keyPrefix := localChannel.Key
			if len(localChannel.Key) > 8 {
				keyPrefix = localChannel.Key[:8]
			}
			localChannel.Name = fmt.Sprintf("%s %s", localChannel.Name, keyPrefix)
		}
		channels = append(channels, *localChannel)
	}
	err = model.BatchInsertChannels(channels)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	createAudit := map[string]any{
		"name":  addChannelRequest.Channel.Name,
		"type":  addChannelRequest.Channel.Type,
		"count": len(channels),
	}
	if baseURLFromPluginDefault {
		createAudit["base_url_source"] = "plugin_default"
	}
	recordManageAudit(c, "channel.create", createAudit)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func DeleteChannel(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	channelName := ""
	channelProxy := ""
	channelLookupFailed := false
	if existing, err := model.GetChannelById(id, false); err == nil && existing != nil {
		channelName = existing.Name
		channelProxy = existing.GetSetting().Proxy
	} else {
		channelLookupFailed = true
	}
	channel := model.Channel{Id: id}
	err := channel.Delete()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 删除渠道后回收无引用的系统生成账户（用户手建账户保留）。
	if _, err := model.CleanupOrphanPrivateAccounts(); err != nil {
		common.SysLog(fmt.Sprintf("failed to cleanup orphan accounts after channel delete: %v", err))
	}
	model.InitChannelCache()
	if channelLookupFailed {
		service.ResetProxyClientCache()
	} else {
		service.InvalidateProxyClient(channelProxy)
	}
	recordManageAudit(c, "channel.delete", map[string]any{
		"id":   id,
		"name": channelName,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func DeleteDisabledChannel(c *gin.Context) {
	rows, err := model.DeleteDisabledChannel()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	if rows > 0 {
		service.ResetProxyClientCache()
	}
	recordManageAudit(c, "channel.delete_disabled", map[string]any{
		"count": rows,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
	return
}

type ChannelTag struct {
	Tag            string  `json:"tag"`
	NewTag         *string `json:"new_tag"`
	Priority       *int64  `json:"priority"`
	Weight         *uint   `json:"weight"`
	ModelMapping   *string `json:"model_mapping"`
	Models         *string `json:"models"`
	Groups         *string `json:"groups"`
	ParamOverride  *string `json:"param_override"`
	HeaderOverride *string `json:"header_override"`
}

func DisableTagChannels(c *gin.Context) {
	channelTag := ChannelTag{}
	err := c.ShouldBindJSON(&channelTag)
	if err != nil || channelTag.Tag == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	err = model.DisableChannelByTag(channelTag.Tag)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	recordManageAudit(c, "channel.tag_disable", map[string]any{
		"tag": channelTag.Tag,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func EnableTagChannels(c *gin.Context) {
	channelTag := ChannelTag{}
	err := c.ShouldBindJSON(&channelTag)
	if err != nil || channelTag.Tag == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	err = model.EnableChannelByTag(channelTag.Tag)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	recordManageAudit(c, "channel.tag_enable", map[string]any{
		"tag": channelTag.Tag,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func EditTagChannels(c *gin.Context) {
	channelTag := ChannelTag{}
	err := c.ShouldBindJSON(&channelTag)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if channelTag.Tag == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "tag不能为空",
		})
		return
	}
	if (channelTag.ParamOverride != nil || channelTag.HeaderOverride != nil) &&
		!authz.Can(c.GetInt("id"), c.GetInt("role"), authz.ChannelSensitiveWrite) {
		common.ApiErrorI18n(c, i18n.MsgAuthInsufficientPrivilege)
		return
	}
	if channelTag.ParamOverride != nil {
		trimmed := strings.TrimSpace(*channelTag.ParamOverride)
		if trimmed != "" && !json.Valid([]byte(trimmed)) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "参数覆盖必须是合法的 JSON 格式",
			})
			return
		}
		channelTag.ParamOverride = common.GetPointer[string](trimmed)
	}
	if channelTag.HeaderOverride != nil {
		trimmed := strings.TrimSpace(*channelTag.HeaderOverride)
		if trimmed != "" && !json.Valid([]byte(trimmed)) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "请求头覆盖必须是合法的 JSON 格式",
			})
			return
		}
		channelTag.HeaderOverride = common.GetPointer[string](trimmed)
	}
	err = model.EditChannelByTag(channelTag.Tag, channelTag.NewTag, channelTag.ModelMapping, channelTag.Models, channelTag.Groups, channelTag.Priority, channelTag.Weight, channelTag.ParamOverride, channelTag.HeaderOverride)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	recordManageAudit(c, "channel.tag_edit", map[string]any{
		"tag": channelTag.Tag,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

type ChannelBatch struct {
	Ids []int   `json:"ids"`
	Tag *string `json:"tag"`
}

func DeleteChannelBatch(c *gin.Context) {
	channelBatch := ChannelBatch{}
	err := c.ShouldBindJSON(&channelBatch)
	if err != nil || len(channelBatch.Ids) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	deletedCount, err := model.BatchDeleteChannels(channelBatch.Ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 批量删除后回收无引用的系统生成账户。
	if _, err := model.CleanupOrphanPrivateAccounts(); err != nil {
		common.SysLog(fmt.Sprintf("failed to cleanup orphan accounts after batch delete: %v", err))
	}
	model.InitChannelCache()
	if deletedCount > 0 {
		service.ResetProxyClientCache()
	}
	recordManageAudit(c, "channel.delete_batch", map[string]any{
		"count": deletedCount,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    deletedCount,
	})
	return
}

type PatchChannel struct {
	model.Channel
	MultiKeyMode *string `json:"multi_key_mode"`
	KeyMode      *string `json:"key_mode"` // 多key模式下密钥覆盖或者追加
	// 套餐专用密钥(可选,敏感):显式携带 = 设置/清除,不携带 = 保持原值。
	// 内嵌 model.Channel.CodingPlanKey 是 json:"-",此处用独立字段接收客户端输入。
	CodingPlanKeyInput *string `json:"coding_plan_key"`
}

type ChannelStatusRequest struct {
	Status int `json:"status"`
}

type ChannelStatusBatchRequest struct {
	Ids    []int `json:"ids"`
	Status int   `json:"status"`
}

func UpdateChannel(c *gin.Context) {
	channel := PatchChannel{}
	rawBody, err := c.GetRawData()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := common.Unmarshal(rawBody, &channel); err != nil {
		common.ApiError(c, err)
		return
	}
	var requestData map[string]any
	if err := common.Unmarshal(rawBody, &requestData); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := requestData["status"]; ok {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	clearChannelReadOnlyFields(&channel, requestData)

	// 编码套餐配置（provider / 套餐专用密钥 / 自动启停阈值）在账户改造后由账户承载，
	// 渠道保存一律忽略这些 legacy 字段。
	stripLegacyCodingPlanFields(&channel.Channel)

	if channel.Type == constant.ChannelTypeTaskPlugin &&
		!authz.Can(c.GetInt("id"), c.GetInt("role"), authz.TaskPluginBind) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "task plugin channels require the task_plugin.bind permission",
		})
		return
	}

	baseURLFromPluginDefault := channel.Type == constant.ChannelTypeTaskPlugin &&
		(channel.BaseURL == nil || strings.TrimSpace(*channel.BaseURL) == "")
	// 使用统一的校验函数
	if err := validateChannel(&channel.Channel, false); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	// Preserve existing ChannelInfo to ensure multi-key channels keep correct state even if the client does not send ChannelInfo in the request.
	originChannel, err := model.GetChannelById(channel.Id, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	originProxy := originChannel.GetSetting().Proxy
	proxyChanged := false
	if _, settingProvided := requestData["setting"]; settingProvided {
		newProxy, _ := service.NormalizeProxyURL(channel.GetSetting().Proxy)
		normalizedOriginProxy, originProxyErr := service.NormalizeProxyURL(originProxy)
		proxyChanged = originProxyErr != nil || normalizedOriginProxy != newProxy
	}

	// Always copy the original ChannelInfo so that fields like IsMultiKey and MultiKeySize are retained.
	channel.ChannelInfo = originChannel.ChannelInfo

	// ── 账户换绑（凭证与渠道解耦）──────────────────────────────────
	// 请求显式携带 account_id 且与当前不同 = 换绑：校验新账户（存在/启用/类型匹配），
	// 更新渠道 account_id，类型同步为账户类型（反规范化副本），凭证字段全部以新账户
	// 为准。旧账户若为系统生成的私有账户且无其他引用，换绑成功后回收。
	accountRebound := false
	var reboundAccountIDs []int
	var reboundSpecs []model.BindingSpec
	if bindingsProvided, ok := requestData["account_bindings"]; ok {
		if rawList, valid := bindingsProvided.([]any); valid {
			for _, item := range rawList {
				entry, okMap := item.(map[string]any)
				if !okMap {
					continue
				}
				idValue, okID := entry["account_id"].(float64)
				if !okID || int(idValue) <= 0 {
					continue
				}
				enabled := true
				if enabledValue, okEnabled := entry["enabled"].(bool); okEnabled {
					enabled = enabledValue
				}
				reboundSpecs = append(reboundSpecs, model.BindingSpec{AccountID: int(idValue), Enabled: enabled})
			}
		}
		seen := make(map[int]bool, len(reboundSpecs))
		specs := make([]model.BindingSpec, 0, len(reboundSpecs))
		for _, spec := range reboundSpecs {
			if seen[spec.AccountID] {
				continue
			}
			seen[spec.AccountID] = true
			specs = append(specs, spec)
		}
		reboundSpecs = specs
		for _, spec := range reboundSpecs {
			account, accErr := model.GetAccountById(spec.AccountID, true)
			if accErr != nil {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "账户不存在: " + accErr.Error()})
				return
			}
			if account.Status != common.ChannelStatusEnabled {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "账户已被禁用，请先启用账户: " + account.Name})
				return
			}
		}
		reboundAccountIDs = specIDs(reboundSpecs)
		if len(reboundAccountIDs) > 0 {
			channel.AccountId = reboundAccountIDs[0]
		}
		channel.Key = ""
		channel.ChannelInfo = model.ChannelInfo{}
		accountRebound = true
	} else if accountIDsProvided, ok := requestData["account_ids"]; ok {
		// N:N 绑定列表：整体覆盖（顺序即轮询顺序）。
		if rawList, valid := accountIDsProvided.([]any); valid {
			for _, v := range rawList {
				if f, okFloat := v.(float64); okFloat && int(f) > 0 {
					reboundAccountIDs = append(reboundAccountIDs, int(f))
				}
			}
		}
		seen := make(map[int]bool, len(reboundAccountIDs))
		unique := make([]int, 0, len(reboundAccountIDs))
		for _, id := range reboundAccountIDs {
			if !seen[id] {
				seen[id] = true
				unique = append(unique, id)
			}
		}
		reboundAccountIDs = unique
		for _, accountId := range reboundAccountIDs {
			account, accErr := model.GetAccountById(accountId, true)
			if accErr != nil {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "账户不存在: " + accErr.Error()})
				return
			}
			if account.Status != common.ChannelStatusEnabled {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "账户已被禁用，请先启用账户: " + account.Name})
				return
			}
		}
		if len(reboundAccountIDs) > 0 {
			channel.AccountId = reboundAccountIDs[0]
		}
		channel.Key = ""
		channel.ChannelInfo = model.ChannelInfo{}
		accountRebound = true
	} else if accountIDProvided, ok := requestData["account_id"]; ok {
		newAccountID := 0
		if v, valid := accountIDProvided.(float64); valid {
			newAccountID = int(v)
		}
		if newAccountID != originChannel.AccountId {
			if newAccountID > 0 {
				newAccount, accErr := model.GetAccountById(newAccountID, true)
				if accErr != nil {
					c.JSON(http.StatusOK, gin.H{"success": false, "message": "账户不存在: " + accErr.Error()})
					return
				}
				if newAccount.Status != common.ChannelStatusEnabled {
					c.JSON(http.StatusOK, gin.H{"success": false, "message": "账户已被禁用，请先启用账户"})
					return
				}
				if newAccount.Type != channel.Type {
					// 换绑允许类型不同：渠道类型同步为账户类型（适配器/base_url 默认值按新类型）。
					channel.Type = newAccount.Type
				}
			}
			channel.AccountId = newAccountID
			channel.Key = ""
			channel.ChannelInfo = model.ChannelInfo{}
			accountRebound = true
		}
	}
	// 挂账户的渠道：凭证类字段（key/base_url/setting/openai_organization/
	// coding_plan_*）从渠道更新路径剥离——凭证编辑走账户接口，渠道侧忽略这些
	// 字段的变更（避免渠道 legacy 列与账户双写漂移）。未挂账户的 legacy 渠道
	// 保持原更新语义。
	if originChannel.AccountId > 0 && !accountRebound {
		channel.Key = ""
		channel.BaseURL = nil
		channel.Setting = nil
		channel.OpenAIOrganization = nil
		channel.CodingPlanProvider = nil
		channel.CodingPlanKey = ""
		channel.CodingPlanKeyInput = nil
		channel.CodingPlanAutoControl = nil
		channel.CodingPlanDisableThreshold = nil
		channel.CodingPlanEnableThreshold = nil
		channel.ChannelInfo = model.ChannelInfo{}
	}

	if channelHasSensitiveChanges(&channel, originChannel, requestData) &&
		!authz.Can(c.GetInt("id"), c.GetInt("role"), authz.ChannelSensitiveWrite) {
		common.ApiErrorI18n(c, i18n.MsgAuthInsufficientPrivilege)
		return
	}

	// If the request explicitly specifies a new MultiKeyMode, apply it on top of the original info.
	if channel.MultiKeyMode != nil && *channel.MultiKeyMode != "" {
		channel.ChannelInfo.MultiKeyMode = constant.MultiKeyMode(*channel.MultiKeyMode)
	}

	// 处理多key模式下的密钥追加/覆盖逻辑
	// 挂账户的渠道多 key 管理走账户接口（轮询状态在账户上），渠道侧跳过。
	if channel.KeyMode != nil && channel.ChannelInfo.IsMultiKey && channel.AccountId == 0 {
		switch *channel.KeyMode {
		case "append":
			// 追加模式：将新密钥添加到现有密钥列表
			if originChannel.Key != "" {
				var newKeys []string
				var existingKeys []string

				// 解析现有密钥
				if strings.HasPrefix(strings.TrimSpace(originChannel.Key), "[") {
					// JSON数组格式
					var arr []json.RawMessage
					if err := json.Unmarshal([]byte(strings.TrimSpace(originChannel.Key)), &arr); err == nil {
						existingKeys = make([]string, len(arr))
						for i, v := range arr {
							existingKeys[i] = string(v)
						}
					}
				} else {
					// 换行分隔格式
					existingKeys = strings.Split(strings.Trim(originChannel.Key, "\n"), "\n")
				}

				// 处理 Vertex AI 的特殊情况
				if channel.Type == constant.ChannelTypeVertexAi && channel.GetOtherSettings().VertexKeyType != dto.VertexKeyTypeAPIKey {
					// 尝试解析新密钥为JSON数组
					if strings.HasPrefix(strings.TrimSpace(channel.Key), "[") {
						array, err := getVertexArrayKeys(channel.Key)
						if err != nil {
							c.JSON(http.StatusOK, gin.H{
								"success": false,
								"message": "追加密钥解析失败: " + err.Error(),
							})
							return
						}
						newKeys = array
					} else {
						// 单个JSON密钥
						newKeys = []string{channel.Key}
					}
				} else {
					// 普通渠道的处理
					inputKeys := strings.SplitSeq(channel.Key, "\n")
					for key := range inputKeys {
						key = strings.TrimSpace(key)
						if key != "" {
							newKeys = append(newKeys, key)
						}
					}
				}

				seen := make(map[string]struct{}, len(existingKeys)+len(newKeys))
				for _, key := range existingKeys {
					normalized := strings.TrimSpace(key)
					if normalized == "" {
						continue
					}
					seen[normalized] = struct{}{}
				}
				dedupedNewKeys := make([]string, 0, len(newKeys))
				for _, key := range newKeys {
					normalized := strings.TrimSpace(key)
					if normalized == "" {
						continue
					}
					if _, ok := seen[normalized]; ok {
						continue
					}
					seen[normalized] = struct{}{}
					dedupedNewKeys = append(dedupedNewKeys, normalized)
				}

				allKeys := append(existingKeys, dedupedNewKeys...)
				channel.Key = strings.Join(allKeys, "\n")
			}
		case "replace":
			// 覆盖模式：直接使用新密钥（默认行为，不需要特殊处理）
		}
	}
	// OpenCode Zen 支持空密钥（免费套餐）：请求显式携带 key 且需要清空时，
	// GORM Updates 会跳过空值字段，需单独 Select key 置空。
	// 挂账户的渠道 key 归账户管理，跳过（清密钥走账户接口）。
	if channel.Type == constant.ChannelTypeOpenCodeZen && channel.AccountId == 0 {
		if _, keyProvided := requestData["key"]; keyProvided && channel.Key == "" && originChannel.Key != "" {
			if err := channel.SaveKey(); err != nil {
				common.ApiError(c, err)
				return
			}
		}
	}
	err = channel.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 渠道内模型设置（禁用/上下文覆盖）：仅当请求显式携带 model_settings 时全量对齐
	//（含空数组 = 全部恢复默认）。未携带保持现状——避免外部局部更新（如仅改名称）
	// 意外清空模型级禁用/覆盖。对齐先于 InitChannelCache，保证重建索引包含新设置。
	if _, ok := requestData["model_settings"]; ok {
		if err := model.ReplaceChannelModelSettings(channel.Id, channel.ModelSettings); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	// 换类型后清掉旧类型的编码套餐绑定(独立渠道适配):套餐厂商、专用密钥、套餐端点 base_url
	// 只对原类型有意义,保存时强制清除,避免渠道换类型后仍出现在余量卡/琥珀标签里。
	// 只清请求未显式携带的字段:同一保存里用户为新类型重新配了套餐(选套餐端点/厂商/
	// 填套餐密钥)则保留新值,避免保存一次就把刚配的套餐清掉(需二次保存)。
	if channel.Type != originChannel.Type {
		if err := clearCodingPlanOnTypeChange(channel.Id, &channel.Channel, originChannel, requestData); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	// 绑定表落库（account_ids 整体覆盖；单值 account_id 路径由 Channel.Update 双写收敛）。
	if accountRebound && len(reboundAccountIDs) > 0 {
		writeErr := model.ReplaceChannelAccountBindings(channel.Id, reboundAccountIDs)
		if len(reboundSpecs) > 0 {
			writeErr = model.ReplaceChannelAccountBindingsWithSpecs(channel.Id, reboundSpecs)
		}
		if writeErr != nil {
			common.ApiError(c, writeErr)
			return
		}
	}
	model.InitChannelCache()
	// 换绑成功：旧私有账户若无其他引用则回收（系统生成的账户不残留）。
	if accountRebound && originChannel.AccountId > 0 {
		if cleaned, err := model.CleanupOrphanPrivateAccounts(); err != nil {
			common.SysLog(fmt.Sprintf("failed to cleanup orphan accounts after rebind: channel_id=%d, error=%v", channel.Id, err))
		} else if cleaned > 0 {
			common.SysLog(fmt.Sprintf("cleanup %d orphan account(s) after channel rebind: channel_id=%d", cleaned, channel.Id))
		}
	}
	if proxyChanged {
		service.InvalidateProxyClient(originProxy)
	}
	// 记录变更的字段名（语言无关的字段标识），密钥仅记录"已更换"绝不记录内容。
	changedFields := make([]string, 0)
	if channel.Models != originChannel.Models {
		changedFields = append(changedFields, "models")
	}
	if channel.Group != originChannel.Group {
		changedFields = append(changedFields, "group")
	}
	if channel.Type != originChannel.Type {
		changedFields = append(changedFields, "type")
		// 换类型连带清掉了套餐绑定,记录到审计,便于管理员追溯绑定为何消失。
		changedFields = append(changedFields, "coding_plan_provider", "coding_plan_key")
	}
	if !equalStringPtr(channel.BaseURL, originChannel.BaseURL) {
		changedFields = append(changedFields, "base_url")
	}
	if channel.Key != "" && channel.Key != originChannel.Key {
		changedFields = append(changedFields, "key")
	}
	if accountRebound {
		changedFields = append(changedFields, "account_id")
	}
	updateAudit := map[string]any{
		"id":             channel.Id,
		"name":           channel.Name,
		"changed_fields": changedFields,
	}
	if baseURLFromPluginDefault {
		updateAudit["base_url_source"] = "plugin_default"
	}
	recordManageAudit(c, "channel.update", updateAudit)
	channel.Key = ""
	channel.CodingPlanKeyInput = nil
	clearChannelInfo(&channel.Channel)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    channel,
	})
	return
}

func UpdateChannelStatus(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req := ChannelStatusRequest{}
	if err := c.ShouldBindJSON(&req); err != nil || !isManageableChannelStatus(req.Status) {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	changed := model.UpdateChannelStatus(id, "", req.Status, "manual operation")
	if changed {
		model.InitChannelCache()
	}
	recordManageAudit(c, "channel.status_update", map[string]any{
		"id":      id,
		"status":  req.Status,
		"changed": changed,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    changed,
	})
}

func BatchUpdateChannelStatus(c *gin.Context) {
	req := ChannelStatusBatchRequest{}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Ids) == 0 || !isManageableChannelStatus(req.Status) {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	changedCount := 0
	for _, id := range req.Ids {
		if model.UpdateChannelStatus(id, "", req.Status, "manual batch operation") {
			changedCount++
		}
	}
	if changedCount > 0 {
		model.InitChannelCache()
	}
	recordManageAudit(c, "channel.status_update_batch", map[string]any{
		"count":  changedCount,
		"total":  len(req.Ids),
		"status": req.Status,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    changedCount,
	})
}

func isManageableChannelStatus(status int) bool {
	return status == common.ChannelStatusEnabled || status == common.ChannelStatusManuallyDisabled
}

// equalStringPtr 比较两个 *string 是否相等（均为 nil 视为相等）。
func equalStringPtr(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// isCodingPlanEndpoint 判断 base_url 是否为编码套餐专用端点:符号键(ChannelSpecialBases)
// 或套餐专用真实地址。只认套餐专用路径,避免把普通厂商 host(如 open.bigmodel.cn 本体、
// api.anthropic.com)误判成套餐端点。与前端 detectCodingPlanProvider 保持一致。
func isCodingPlanEndpoint(baseURL string) bool {
	if _, ok := constant.ChannelSpecialBases[baseURL]; ok {
		return true
	}
	url := strings.ToLower(strings.TrimSpace(baseURL))
	return strings.Contains(url, "api.kimi.com/coding") ||
		strings.Contains(url, "volces.com/api/coding") ||
		strings.Contains(url, "api.minimaxi.com") ||
		strings.Contains(url, "api.minimax.io") ||
		strings.Contains(url, "open.bigmodel.cn/api/coding") ||
		strings.Contains(url, "open.bigmodel.cn/api/anthropic") ||
		strings.Contains(url, "api.z.ai/api/coding") ||
		strings.Contains(url, "api.z.ai/api/anthropic") ||
		strings.Contains(url, "zenmux")
}

// codingPlanFieldsToClear 决定换类型时哪些编码套餐字段需要清掉:只清请求未显式携带的
// 字段。请求带了新值(含显式清空)就尊重表单;完全没带才清旧类型的残留绑定
// (套餐厂商、专用密钥,以及仍是套餐端点的旧 base_url)。
// codingPlanFieldsToClear 渠道换类型时要清掉的 legacy 编码套餐列。厂商与套餐专用密钥已由
// 账户承载，这里无条件清空渠道侧的过渡副本；套餐端点 base_url 只清请求未显式重设的那次。
func codingPlanFieldsToClear(requestData map[string]any, originBaseURL string) map[string]any {
	updates := map[string]any{
		"coding_plan_provider": "",
		"coding_plan_key":      "",
	}
	if _, ok := requestData["base_url"]; !ok && isCodingPlanEndpoint(originBaseURL) {
		updates["base_url"] = ""
	}
	return updates
}

// clearCodingPlanOnTypeChange 渠道换类型后清除编码套餐绑定(独立渠道适配):
// 套餐厂商、套餐专用密钥、套餐端点 base_url 一起清。GORM Updates(struct) 会跳过空值
// 字段,这里显式按列更新;成功后同步内存对象,保证响应返回一致状态。
// 套餐端点 base_url 只清请求未显式携带的那次(用户为新类型选了新端点则保留)。
// stripLegacyCodingPlanFields 渠道保存时忽略编码套餐配置（厂商 / 套餐专用密钥 / 自动启停
// 阈值）。账户改造后这些配置由账户承载（见 model.Account.CodingPlan*），渠道侧列只作迁移
// 过渡；继续接受写入会让渠道上留一份不生效的副本，浏览器缓存里的旧前端也会发这些字段，
// 因此统一静默忽略。
func stripLegacyCodingPlanFields(ch *model.Channel) {
	if ch == nil {
		return
	}
	ch.CodingPlanProvider = nil
	ch.CodingPlanKey = ""
	ch.CodingPlanAutoControl = nil
	ch.CodingPlanDisableThreshold = nil
	ch.CodingPlanEnableThreshold = nil
}

func clearCodingPlanOnTypeChange(id int, channel *model.Channel, origin *model.Channel, requestData map[string]any) error {
	var originBaseURL string
	if origin.BaseURL != nil {
		originBaseURL = *origin.BaseURL
	}
	updates := codingPlanFieldsToClear(requestData, originBaseURL)
	if len(updates) == 0 {
		return nil
	}
	if err := model.DB.Model(&model.Channel{}).
		Where("id = ?", id).
		Updates(updates).Error; err != nil {
		return err
	}
	// 同步内存对象
	channel.CodingPlanProvider = common.GetPointer[string]("")
	channel.CodingPlanKey = ""
	if _, ok := requestData["base_url"]; !ok && isCodingPlanEndpoint(originBaseURL) {
		empty := ""
		channel.BaseURL = &empty
	}
	return nil
}

type fetchModelsRequest struct {
	ChannelID      int     `json:"channel_id"`
	BaseURL        *string `json:"base_url"`
	Type           int     `json:"type"`
	Key            string  `json:"key"`
	AdvancedCustom *string `json:"advanced_custom"`
	HeaderOverride *string `json:"header_override"`
	Proxy          *string `json:"proxy"`
}

func buildAdvancedCustomModelPreviewChannel(req fetchModelsRequest) (*model.Channel, error) {
	var channel *model.Channel
	if req.ChannelID > 0 {
		savedChannel, err := model.GetChannelById(req.ChannelID, true)
		if err != nil {
			return nil, err
		}
		if savedChannel.Type != constant.ChannelTypeAdvancedCustom {
			return nil, fmt.Errorf("channel %d is not an advanced custom channel", req.ChannelID)
		}
		channel = savedChannel
	} else {
		key := strings.TrimSpace(req.Key)
		if key != "" {
			key = strings.Split(key, "\n")[0]
		}
		channel = &model.Channel{
			Type: req.Type,
			Key:  key,
		}
	}

	if channel.Type != constant.ChannelTypeAdvancedCustom {
		return nil, fmt.Errorf("channel type must be advanced custom")
	}
	if req.BaseURL != nil {
		baseURL := strings.TrimSpace(*req.BaseURL)
		channel.BaseURL = &baseURL
	}

	settings := channel.GetOtherSettings()
	if req.AdvancedCustom != nil {
		rawConfig := strings.TrimSpace(*req.AdvancedCustom)
		if rawConfig == "" {
			return nil, fmt.Errorf("advanced_custom is required")
		}
		var config dto.AdvancedCustomConfig
		if err := common.UnmarshalJsonStr(rawConfig, &config); err != nil {
			return nil, err
		}
		settings.AdvancedCustom = &config
	} else if req.ChannelID <= 0 {
		return nil, fmt.Errorf("advanced_custom is required")
	}
	channel.SetOtherSettings(settings)

	if req.HeaderOverride != nil {
		rawHeaderOverride := strings.TrimSpace(*req.HeaderOverride)
		if rawHeaderOverride != "" {
			var headerOverride map[string]any
			if err := common.UnmarshalJsonStr(rawHeaderOverride, &headerOverride); err != nil {
				return nil, fmt.Errorf("header_override must be a JSON object: %w", err)
			}
		}
		channel.HeaderOverride = &rawHeaderOverride
	}
	if req.Proxy != nil {
		channelSettings := channel.GetSetting()
		channelSettings.Proxy = strings.TrimSpace(*req.Proxy)
		channel.SetSetting(channelSettings)
	}

	if err := validateChannel(channel, false); err != nil {
		return nil, err
	}
	return channel, nil
}

func FetchModels(c *gin.Context) {
	var req fetchModelsRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request",
		})
		return
	}

	var channel *model.Channel
	if req.Type == constant.ChannelTypeAdvancedCustom || req.ChannelID > 0 {
		var err error
		channel, err = buildAdvancedCustomModelPreviewChannel(req)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	} else {
		baseURL := ""
		if req.BaseURL != nil {
			baseURL = strings.TrimSpace(*req.BaseURL)
		}
		if baseURL == "" {
			baseURL = constant.GetChannelBaseURL(req.Type)
		}

		key := strings.TrimSpace(req.Key)
		if req.Type != constant.ChannelTypeCodex {
			key = strings.Split(key, "\n")[0]
		}
		channel = &model.Channel{
			Type:    req.Type,
			Key:     key,
			BaseURL: &baseURL,
		}
	}

	models, err := fetchChannelUpstreamModelIDs(channel)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("获取模型列表失败: %s", err.Error()),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    models,
	})
}

func BatchSetChannelTag(c *gin.Context) {
	channelBatch := ChannelBatch{}
	err := c.ShouldBindJSON(&channelBatch)
	if err != nil || len(channelBatch.Ids) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	err = model.BatchSetChannelTag(channelBatch.Ids, channelBatch.Tag)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	recordManageAudit(c, "channel.tag_batch_set", map[string]any{
		"count": len(channelBatch.Ids),
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    len(channelBatch.Ids),
	})
	return
}

func GetTagModels(c *gin.Context) {
	tag := c.Query("tag")
	if tag == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "tag不能为空",
		})
		return
	}

	channels, err := model.GetChannelsByTag(tag, false, false) // idSort=false, selectAll=false
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	var longestModels string
	maxLength := 0

	// Find the longest models string among all channels with the given tag
	for _, channel := range channels {
		if channel.Models != "" {
			currentModels := strings.Split(channel.Models, ",")
			if len(currentModels) > maxLength {
				maxLength = len(currentModels)
				longestModels = channel.Models
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    longestModels,
	})
	return
}

// CopyChannel handles cloning an existing channel with its key.
// POST /api/channel/copy/:id
// Optional query params:
//
//	suffix         - string appended to the original name (default "_复制")
//	reset_balance  - bool, when true will reset balance & used_quota to 0 (default true)
func CopyChannel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}

	suffix := c.DefaultQuery("suffix", "_复制")
	resetBalance := true
	if rbStr := c.DefaultQuery("reset_balance", "true"); rbStr != "" {
		if v, err := strconv.ParseBool(rbStr); err == nil {
			resetBalance = v
		}
	}
	// new_account=true 时复制私有账户（凭证深拷贝,多 key 状态重置）；
	// 默认共享 origin 账户（凭证引用同一份,余额/轮询状态共用）。
	newAccount := false
	if naStr := c.DefaultQuery("new_account", "false"); naStr != "" {
		if v, err := strconv.ParseBool(naStr); err == nil {
			newAccount = v
		}
	}

	// fetch original channel with key
	origin, err := model.GetChannelById(id, true)
	if err != nil {
		common.SysError("failed to get channel by id: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取渠道信息失败，请稍后重试"})
		return
	}
	if origin.Type == constant.ChannelTypeTaskPlugin &&
		!authz.Can(c.GetInt("id"), c.GetInt("role"), authz.TaskPluginBind) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "task plugin channels require the task_plugin.bind permission"})
		return
	}

	// clone channel
	clone := *origin // shallow copy is sufficient as we will overwrite primitives
	clone.Id = 0     // let DB auto-generate
	clone.CreatedTime = common.GetTimestamp()
	clone.Name = origin.Name + suffix
	clone.TestTime = 0
	clone.ResponseTime = 0
	clone.Account = nil // 重新挂载（共享账户时下方重挂；避免旧指针状态污染）
	if resetBalance {
		clone.Balance = 0
		clone.UsedQuota = 0
	}
	// 凭证状态归零：多 key 轮询索引/启停状态不复制（共享账户时状态在账户上；
	// 复制私有账户时新账户状态重置）。legacy 渠道（AccountId=0）同样不复制动态状态。
	clone.ChannelInfo.MultiKeyPollingIndex = 0
	clone.ChannelInfo.MultiKeyStatusList = nil
	clone.ChannelInfo.MultiKeyDisabledReason = nil
	clone.ChannelInfo.MultiKeyDisabledTime = nil

	if origin.AccountId > 0 {
		if newAccount {
			// 复制私有账户：凭证从 origin 账户一一拷贝（真相源；渠道 legacy 列
			// 可能已过时），多 key 状态重置。
			if origin.Account == nil {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "源渠道账户加载失败，请稍后重试"})
				return
			}
			newAcc := &model.Account{
				Name:                    origin.Name + suffix + "（私有）",
				Type:                    origin.Account.Type,
				Status:                  common.ChannelStatusEnabled,
				Key:                     origin.Account.Key,
				OpenAIOrganization:      origin.Account.OpenAIOrganization,
				BaseURL:                 origin.Account.BaseURL,
				Other:                   origin.Account.Other,
				Setting:                 origin.Account.Setting,
				ChannelInfo:             model.ChannelInfo{}, // 多 key 状态重置
				CodingPlanProvider:      origin.Account.CodingPlanProvider,
				CodingPlanKey:           origin.Account.CodingPlanKey,
				CodingPlanAutoControl:   origin.Account.CodingPlanAutoControl,
				CodingPlanDisableThreshold: origin.Account.CodingPlanDisableThreshold,
				CodingPlanEnableThreshold:  origin.Account.CodingPlanEnableThreshold,
				CreatedTime:             common.GetTimestamp(),
				AutoGenerated:           true,
			}
			if err := newAcc.Insert(); err != nil {
				common.SysError("failed to create account for cloned channel: " + err.Error())
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "复制账户失败，请稍后重试"})
				return
			}
			clone.AccountId = newAcc.Id
		}
		// 默认：共享 origin 账户（clone.AccountId 已随浅拷贝带上）
		// key 归账户，渠道列不带凭证。
		clone.Key = ""
		clone.ChannelInfo = model.ChannelInfo{}
	}

	if err := clone.ValidateSettings(); err != nil {
		common.SysError("failed to validate cloned channel: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "Failed to copy channel: invalid channel settings"})
		return
	}

	// insert
	if err := clone.Insert(); err != nil {
		common.SysError("failed to clone channel: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "复制渠道失败，请稍后重试"})
		return
	}
	model.InitChannelCache()
	recordManageAudit(c, "channel.copy", map[string]any{
		"sourceId": id,
		"id":       clone.Id,
		"name":     clone.Name,
	})
	// success
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"id": clone.Id}})
}

// MultiKeyManageRequest represents the request for multi-key management operations
type MultiKeyManageRequest struct {
	ChannelId int    `json:"channel_id"`
	Action    string `json:"action"`              // "disable_key", "enable_key", "delete_key", "delete_disabled_keys", "get_key_status"
	KeyIndex  *int   `json:"key_index,omitempty"` // for disable_key, enable_key, and delete_key actions
	Page      int    `json:"page,omitempty"`      // for get_key_status pagination
	PageSize  int    `json:"page_size,omitempty"` // for get_key_status pagination
	Status    *int   `json:"status,omitempty"`    // for get_key_status filtering: 1=enabled, 2=manual_disabled, 3=auto_disabled, nil=all
}

// MultiKeyStatusResponse represents the response for key status query
type MultiKeyStatusResponse struct {
	Keys       []KeyStatus `json:"keys"`
	Total      int         `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	TotalPages int         `json:"total_pages"`
	// Statistics
	EnabledCount        int `json:"enabled_count"`
	ManualDisabledCount int `json:"manual_disabled_count"`
	AutoDisabledCount   int `json:"auto_disabled_count"`
}

type KeyStatus struct {
	Index        int    `json:"index"`
	Status       int    `json:"status"` // 1: enabled, 2: disabled
	DisabledTime int64  `json:"disabled_time,omitempty"`
	Reason       string `json:"reason,omitempty"`
	KeyPreview   string `json:"key_preview"` // first 10 chars of key for identification
}

// ManageMultiKeys handles multi-key management operations
func ManageMultiKeys(c *gin.Context) {
	request := MultiKeyManageRequest{}
	err := c.ShouldBindJSON(&request)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	channel, err := model.GetChannelById(request.ChannelId, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "渠道不存在",
		})
		return
	}

	// 多 key 管理目标解析：挂账户的渠道操作账户（轮询/启停状态跨渠道共享，
	// 改 key 直接改账户 key），legacy 渠道操作渠道自身。后续读写统一走
	// mkInfo/mkKeys/mkSetKeys/mkSave 闭包，一份逻辑双路径。
	var mkAccount *model.Account
	if channel.Account != nil {
		mkAccount = channel.Account
	}
	mkInfo := func() *model.ChannelInfo {
		if mkAccount != nil {
			return &mkAccount.ChannelInfo
		}
		return &channel.ChannelInfo
	}
	mkKeys := func() []string {
		if mkAccount != nil {
			return mkAccount.GetKeys()
		}
		return channel.GetKeys()
	}
	mkSetKeys := func(remaining []string) {
		joined := strings.Join(remaining, "\n")
		if mkAccount != nil {
			mkAccount.Key = joined
			mkAccount.ChannelInfo.MultiKeySize = len(remaining)
		} else {
			channel.Key = joined
			mkInfo().MultiKeySize = len(remaining)
		}
	}
	mkSave := func() error {
		if mkAccount != nil {
			return mkAccount.Save()
		}
		return channel.Update()
	}
	lock := model.GetChannelPollingLock(channel.Id)
	if mkAccount != nil {
		lock = model.GetAccountPollingLock(mkAccount.Id)
	}

	if !mkInfo().IsMultiKey {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该渠道不是多密钥模式",
		})
		return
	}
	if multiKeyActionRequiresSensitiveWrite(request.Action) &&
		!authz.Can(c.GetInt("id"), c.GetInt("role"), authz.ChannelSensitiveWrite) {
		common.ApiErrorI18n(c, i18n.MsgAuthInsufficientPrivilege)
		return
	}

	// get_key_status 为只读查询，不记录审计；其余为修改操作，记录审计并跳过中间件兜底。
	if request.Action == "get_key_status" {
		markAuditLogged(c)
	} else {
		recordManageAudit(c, "channel.multi_key_manage", map[string]any{
			"action": request.Action,
			"id":     channel.Id,
		})
	}

	lock.Lock()
	defer lock.Unlock()

	switch request.Action {
	case "get_key_status":
		keys := mkKeys()

		// Default pagination parameters
		page := request.Page
		pageSize := request.PageSize
		if page <= 0 {
			page = 1
		}
		if pageSize <= 0 {
			pageSize = 50 // Default page size
		}

		// Statistics for all keys (unchanged by filtering)
		var enabledCount, manualDisabledCount, autoDisabledCount int

		// Build all key status data first
		var allKeyStatusList []KeyStatus
		for i, key := range keys {
			status := 1 // default enabled
			var disabledTime int64
			var reason string

			if mkInfo().MultiKeyStatusList != nil {
				if s, exists := mkInfo().MultiKeyStatusList[i]; exists {
					status = s
				}
			}

			// Count for statistics (all keys)
			switch status {
			case 1:
				enabledCount++
			case 2:
				manualDisabledCount++
			case 3:
				autoDisabledCount++
			}

			if status != 1 {
				if mkInfo().MultiKeyDisabledTime != nil {
					disabledTime = mkInfo().MultiKeyDisabledTime[i]
				}
				if mkInfo().MultiKeyDisabledReason != nil {
					reason = mkInfo().MultiKeyDisabledReason[i]
				}
			}

			// Create key preview (first 10 chars)
			keyPreview := key
			if len(key) > 10 {
				keyPreview = key[:10] + "..."
			}

			allKeyStatusList = append(allKeyStatusList, KeyStatus{
				Index:        i,
				Status:       status,
				DisabledTime: disabledTime,
				Reason:       reason,
				KeyPreview:   keyPreview,
			})
		}

		// Apply status filter if specified
		var filteredKeyStatusList []KeyStatus
		if request.Status != nil {
			for _, keyStatus := range allKeyStatusList {
				if keyStatus.Status == *request.Status {
					filteredKeyStatusList = append(filteredKeyStatusList, keyStatus)
				}
			}
		} else {
			filteredKeyStatusList = allKeyStatusList
		}

		// Calculate pagination based on filtered results
		filteredTotal := len(filteredKeyStatusList)
		totalPages := (filteredTotal + pageSize - 1) / pageSize
		if totalPages == 0 {
			totalPages = 1
		}
		if page > totalPages {
			page = totalPages
		}

		// Calculate range for current page
		start := (page - 1) * pageSize
		end := min(start+pageSize, filteredTotal)

		// Get the page data
		var pageKeyStatusList []KeyStatus
		if start < filteredTotal {
			pageKeyStatusList = filteredKeyStatusList[start:end]
		}

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data": MultiKeyStatusResponse{
				Keys:                pageKeyStatusList,
				Total:               filteredTotal, // Total of filtered results
				Page:                page,
				PageSize:            pageSize,
				TotalPages:          totalPages,
				EnabledCount:        enabledCount,        // Overall statistics
				ManualDisabledCount: manualDisabledCount, // Overall statistics
				AutoDisabledCount:   autoDisabledCount,   // Overall statistics
			},
		})
		return

	case "disable_key":
		if request.KeyIndex == nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "未指定要禁用的密钥索引",
			})
			return
		}

		keyIndex := *request.KeyIndex
		if keyIndex < 0 || keyIndex >= mkInfo().MultiKeySize {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "密钥索引超出范围",
			})
			return
		}

		if mkInfo().MultiKeyStatusList == nil {
			mkInfo().MultiKeyStatusList = make(map[int]int)
		}
		if mkInfo().MultiKeyDisabledTime == nil {
			mkInfo().MultiKeyDisabledTime = make(map[int]int64)
		}
		if mkInfo().MultiKeyDisabledReason == nil {
			mkInfo().MultiKeyDisabledReason = make(map[int]string)
		}

		mkInfo().MultiKeyStatusList[keyIndex] = 2 // disabled

		err = mkSave()
		if err != nil {
			common.ApiError(c, err)
			return
		}

		model.InitChannelCache()
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "密钥已禁用",
		})
		return

	case "enable_key":
		if request.KeyIndex == nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "未指定要启用的密钥索引",
			})
			return
		}

		keyIndex := *request.KeyIndex
		if keyIndex < 0 || keyIndex >= mkInfo().MultiKeySize {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "密钥索引超出范围",
			})
			return
		}

		// 从状态列表中删除该密钥的记录，使其回到默认启用状态
		if mkInfo().MultiKeyStatusList != nil {
			delete(mkInfo().MultiKeyStatusList, keyIndex)
		}
		if mkInfo().MultiKeyDisabledTime != nil {
			delete(mkInfo().MultiKeyDisabledTime, keyIndex)
		}
		if mkInfo().MultiKeyDisabledReason != nil {
			delete(mkInfo().MultiKeyDisabledReason, keyIndex)
		}

		err = mkSave()
		if err != nil {
			common.ApiError(c, err)
			return
		}

		model.InitChannelCache()
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "密钥已启用",
		})
		return

	case "enable_all_keys":
		// 清空所有禁用状态，使所有密钥回到默认启用状态
		var enabledCount int
		if mkInfo().MultiKeyStatusList != nil {
			enabledCount = len(mkInfo().MultiKeyStatusList)
		}

		mkInfo().MultiKeyStatusList = make(map[int]int)
		mkInfo().MultiKeyDisabledTime = make(map[int]int64)
		mkInfo().MultiKeyDisabledReason = make(map[int]string)

		err = mkSave()
		if err != nil {
			common.ApiError(c, err)
			return
		}

		model.InitChannelCache()
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": fmt.Sprintf("已启用 %d 个密钥", enabledCount),
		})
		return

	case "disable_all_keys":
		// 禁用所有启用的密钥
		if mkInfo().MultiKeyStatusList == nil {
			mkInfo().MultiKeyStatusList = make(map[int]int)
		}
		if mkInfo().MultiKeyDisabledTime == nil {
			mkInfo().MultiKeyDisabledTime = make(map[int]int64)
		}
		if mkInfo().MultiKeyDisabledReason == nil {
			mkInfo().MultiKeyDisabledReason = make(map[int]string)
		}

		var disabledCount int
		for i := 0; i < mkInfo().MultiKeySize; i++ {
			status := 1 // default enabled
			if s, exists := mkInfo().MultiKeyStatusList[i]; exists {
				status = s
			}

			// 只禁用当前启用的密钥
			if status == 1 {
				mkInfo().MultiKeyStatusList[i] = 2 // disabled
				disabledCount++
			}
		}

		if disabledCount == 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "没有可禁用的密钥",
			})
			return
		}

		err = mkSave()
		if err != nil {
			common.ApiError(c, err)
			return
		}

		model.InitChannelCache()
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": fmt.Sprintf("已禁用 %d 个密钥", disabledCount),
		})
		return

	case "delete_key":
		if request.KeyIndex == nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "未指定要删除的密钥索引",
			})
			return
		}

		keyIndex := *request.KeyIndex
		if keyIndex < 0 || keyIndex >= mkInfo().MultiKeySize {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "密钥索引超出范围",
			})
			return
		}

		keys := mkKeys()
		var remainingKeys []string
		var newStatusList = make(map[int]int)
		var newDisabledTime = make(map[int]int64)
		var newDisabledReason = make(map[int]string)

		newIndex := 0
		for i, key := range keys {
			// 跳过要删除的密钥
			if i == keyIndex {
				continue
			}

			remainingKeys = append(remainingKeys, key)

			// 保留其他密钥的状态信息，重新索引
			if mkInfo().MultiKeyStatusList != nil {
				if status, exists := mkInfo().MultiKeyStatusList[i]; exists && status != 1 {
					newStatusList[newIndex] = status
				}
			}
			if mkInfo().MultiKeyDisabledTime != nil {
				if t, exists := mkInfo().MultiKeyDisabledTime[i]; exists {
					newDisabledTime[newIndex] = t
				}
			}
			if mkInfo().MultiKeyDisabledReason != nil {
				if r, exists := mkInfo().MultiKeyDisabledReason[i]; exists {
					newDisabledReason[newIndex] = r
				}
			}
			newIndex++
		}

		if len(remainingKeys) == 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "不能删除最后一个密钥",
			})
			return
		}

		// Update channel with remaining keys
		mkSetKeys(remainingKeys)
		mkInfo().MultiKeyStatusList = newStatusList
		mkInfo().MultiKeyDisabledTime = newDisabledTime
		mkInfo().MultiKeyDisabledReason = newDisabledReason

		err = mkSave()
		if err != nil {
			common.ApiError(c, err)
			return
		}

		model.InitChannelCache()
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "密钥已删除",
		})
		return

	case "delete_disabled_keys":
		keys := mkKeys()
		var remainingKeys []string
		var deletedCount int
		var newStatusList = make(map[int]int)
		var newDisabledTime = make(map[int]int64)
		var newDisabledReason = make(map[int]string)

		newIndex := 0
		for i, key := range keys {
			status := 1 // default enabled
			if mkInfo().MultiKeyStatusList != nil {
				if s, exists := mkInfo().MultiKeyStatusList[i]; exists {
					status = s
				}
			}

			// 只删除自动禁用（status == 3）的密钥，保留启用（status == 1）和手动禁用（status == 2）的密钥
			if status == 3 {
				deletedCount++
			} else {
				remainingKeys = append(remainingKeys, key)
				// 保留非自动禁用密钥的状态信息，重新索引
				if status != 1 {
					newStatusList[newIndex] = status
					if mkInfo().MultiKeyDisabledTime != nil {
						if t, exists := mkInfo().MultiKeyDisabledTime[i]; exists {
							newDisabledTime[newIndex] = t
						}
					}
					if mkInfo().MultiKeyDisabledReason != nil {
						if r, exists := mkInfo().MultiKeyDisabledReason[i]; exists {
							newDisabledReason[newIndex] = r
						}
					}
				}
				newIndex++
			}
		}

		if deletedCount == 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "没有需要删除的自动禁用密钥",
			})
			return
		}

		// Update channel with remaining keys
		mkSetKeys(remainingKeys)
		mkInfo().MultiKeyStatusList = newStatusList
		mkInfo().MultiKeyDisabledTime = newDisabledTime
		mkInfo().MultiKeyDisabledReason = newDisabledReason

		err = mkSave()
		if err != nil {
			common.ApiError(c, err)
			return
		}

		model.InitChannelCache()
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": fmt.Sprintf("已删除 %d 个自动禁用的密钥", deletedCount),
			"data":    deletedCount,
		})
		return

	default:
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "不支持的操作",
		})
		return
	}
}

func multiKeyActionRequiresSensitiveWrite(action string) bool {
	return action == "delete_key" || action == "delete_disabled_keys"
}

// OllamaPullModel 拉取 Ollama 模型
func OllamaPullModel(c *gin.Context) {
	var req struct {
		ChannelID int    `json:"channel_id"`
		ModelName string `json:"model_name"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request parameters",
		})
		return
	}

	if req.ChannelID == 0 || req.ModelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Channel ID and model name are required",
		})
		return
	}

	// 获取渠道信息
	channel, err := model.GetChannelById(req.ChannelID, true)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Channel not found",
		})
		return
	}

	// 检查是否是 Ollama 渠道
	if channel.Type != constant.ChannelTypeOllama {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "This operation is only supported for Ollama channels",
		})
		return
	}

	baseURL := constant.GetChannelBaseURL(channel.Type)
	if channel.GetBaseURL() != "" {
		baseURL = channel.GetBaseURL()
	}

	key := strings.Split(channel.Key, "\n")[0]
	err = ollama.PullOllamaModel(baseURL, key, req.ModelName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": fmt.Sprintf("Failed to pull model: %s", err.Error()),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("Model %s pulled successfully", req.ModelName),
	})
}

// OllamaPullModelStream 流式拉取 Ollama 模型
func OllamaPullModelStream(c *gin.Context) {
	var req struct {
		ChannelID int    `json:"channel_id"`
		ModelName string `json:"model_name"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request parameters",
		})
		return
	}

	if req.ChannelID == 0 || req.ModelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Channel ID and model name are required",
		})
		return
	}

	// 获取渠道信息
	channel, err := model.GetChannelById(req.ChannelID, true)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Channel not found",
		})
		return
	}

	// 检查是否是 Ollama 渠道
	if channel.Type != constant.ChannelTypeOllama {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "This operation is only supported for Ollama channels",
		})
		return
	}

	baseURL := constant.GetChannelBaseURL(channel.Type)
	if channel.GetBaseURL() != "" {
		baseURL = channel.GetBaseURL()
	}

	// 设置 SSE 头部
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")

	key := strings.Split(channel.Key, "\n")[0]

	// 创建进度回调函数
	progressCallback := func(progress ollama.OllamaPullResponse) {
		data, _ := json.Marshal(progress)
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(data))
		c.Writer.Flush()
	}

	// 执行拉取
	err = ollama.PullOllamaModelStream(baseURL, key, req.ModelName, progressCallback)

	if err != nil {
		errorData, _ := json.Marshal(gin.H{
			"error": err.Error(),
		})
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(errorData))
	} else {
		successData, _ := json.Marshal(gin.H{
			"message": fmt.Sprintf("Model %s pulled successfully", req.ModelName),
		})
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(successData))
	}

	// 发送结束标志
	fmt.Fprintf(c.Writer, "data: [DONE]\n\n")
	c.Writer.Flush()
}

// OllamaDeleteModel 删除 Ollama 模型
func OllamaDeleteModel(c *gin.Context) {
	var req struct {
		ChannelID int    `json:"channel_id"`
		ModelName string `json:"model_name"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request parameters",
		})
		return
	}

	if req.ChannelID == 0 || req.ModelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Channel ID and model name are required",
		})
		return
	}

	// 获取渠道信息
	channel, err := model.GetChannelById(req.ChannelID, true)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Channel not found",
		})
		return
	}

	// 检查是否是 Ollama 渠道
	if channel.Type != constant.ChannelTypeOllama {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "This operation is only supported for Ollama channels",
		})
		return
	}

	baseURL := constant.GetChannelBaseURL(channel.Type)
	if channel.GetBaseURL() != "" {
		baseURL = channel.GetBaseURL()
	}

	key := strings.Split(channel.Key, "\n")[0]
	err = ollama.DeleteOllamaModel(baseURL, key, req.ModelName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": fmt.Sprintf("Failed to delete model: %s", err.Error()),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("Model %s deleted successfully", req.ModelName),
	})
}

// OllamaVersion 获取 Ollama 服务版本信息
func OllamaVersion(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid channel id",
		})
		return
	}

	channel, err := model.GetChannelById(id, true)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "Channel not found",
		})
		return
	}

	if channel.Type != constant.ChannelTypeOllama {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "This operation is only supported for Ollama channels",
		})
		return
	}

	baseURL := constant.GetChannelBaseURL(channel.Type)
	if channel.GetBaseURL() != "" {
		baseURL = channel.GetBaseURL()
	}

	key := strings.Split(channel.Key, "\n")[0]
	version, err := ollama.FetchOllamaVersion(baseURL, key)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("获取Ollama版本失败: %s", err.Error()),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"version": version,
		},
	})
}

// GetChannelModelSettings 获取渠道的模型设置列表（渠道内模型级禁用 / context_window 覆盖）。
func GetChannelModelSettings(c *gin.Context) {
	id := common.String2Int(c.Param("id"))
	settings, err := model.GetChannelModelSettings(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, settings)
}

// UpdateChannelModelSettings 保存渠道的模型设置（禁用/上下文覆盖），并重建
// abilities 应用禁用态（选路排除被禁用的模型）。
func UpdateChannelModelSettings(c *gin.Context) {
	id := common.String2Int(c.Param("id"))
	if _, err := model.GetChannelById(id, false); err != nil {
		common.ApiError(c, err)
		return
	}
	var settings []model.ChannelModelSetting
	if err := c.ShouldBindJSON(&settings); err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range settings {
		settings[i].ChannelId = id
	}
	if err := model.UpsertChannelModelSettings(id, settings); err != nil {
		common.ApiError(c, err)
		return
	}
	full, err := model.GetChannelById(id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.CleanupStaleChannelModelSettings(id, full.GetModels()); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := full.UpdateAbilities(nil); err != nil {
		common.ApiError(c, err)
		return
	}
	// 重建渠道内存索引：禁用模型要即时退出选路，覆盖模型集合同步进热路径缓存
	model.InitChannelCache()
	common.ApiSuccess(c, nil)
}
