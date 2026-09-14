package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/samber/lo"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Channel struct {
	Id                 int     `json:"id"`
	Type               int     `json:"type" gorm:"default:0"`
	Key                string  `json:"key" gorm:"not null"`
	OpenAIOrganization *string `json:"openai_organization"`
	TestModel          *string `json:"test_model"`
	Status             int     `json:"status" gorm:"default:1"`
	Name               string  `json:"name" gorm:"index"`
	Weight             *uint   `json:"weight" gorm:"default:0"`
	CreatedTime        int64   `json:"created_time" gorm:"bigint"`
	TestTime           int64   `json:"test_time" gorm:"bigint"`
	ResponseTime       int     `json:"response_time"` // in milliseconds
	BaseURL            *string `json:"base_url" gorm:"column:base_url;default:''"`
	Other              string  `json:"other"`
	Balance            float64 `json:"balance"` // in USD
	BalanceUpdatedTime int64   `json:"balance_updated_time" gorm:"bigint"`
	Models             string  `json:"models"`
	Group              string  `json:"group" gorm:"type:varchar(64);default:'default'"`
	UsedQuota          int64   `json:"used_quota" gorm:"bigint;default:0"`
	ModelMapping       *string `json:"model_mapping" gorm:"type:text"`
	//MaxInputTokens     *int    `json:"max_input_tokens" gorm:"default:0"`
	StatusCodeMapping *string `json:"status_code_mapping" gorm:"type:varchar(1024);default:''"`
	Priority          *int64  `json:"priority" gorm:"bigint;default:0"`
	AutoBan           *int    `json:"auto_ban" gorm:"default:1"`
	OtherInfo         string  `json:"other_info"`
	Tag               *string `json:"tag" gorm:"index"`
	Setting           *string `json:"setting" gorm:"type:text"` // 渠道额外设置
	ParamOverride     *string `json:"param_override" gorm:"type:text"`
	HeaderOverride    *string `json:"header_override" gorm:"type:text"`
	Remark            *string `json:"remark" gorm:"type:varchar(255)" validate:"max=255"`
	// add after v0.8.5
	ChannelInfo ChannelInfo `json:"channel_info" gorm:"type:json"`

	// 编码套餐余量监控(仅影响余量查询,不影响转发):
	// CodingPlanProvider 为空 = 关闭;否则启用,用 CodingPlanKey(为空则用渠道自身
	// key)打该厂商官方 quota 端点。支持走前置聚合的渠道:转发用聚合地址+聚合 token,
	// 余量用 CodingPlanKey 直接打厂商官方,互不干扰。
	// CodingPlanProvider 用 *string:与 tag/remark 一致,允许 Updates(struct) 写入空串关闭。
	CodingPlanProvider  *string `json:"coding_plan_provider" gorm:"size:32"`
	CodingPlanKey       string  `json:"-" gorm:"size:512"`               // 套餐专用密钥,永不下发
	CodingPlanKeyMasked string  `json:"coding_plan_key_masked" gorm:"-"` // 响应脱敏预览

	// 编码套餐自动启停(按余量):开启后定时任务按用量自动禁用(≥禁用阈值)与恢复
	// (<恢复阈值)。阈值用 *int、开关用 *bool:与 CodingPlanProvider 同理由,允许
	// GORM Updates(struct) 写入零值(否则 false/0 会被跳过、关不掉)。
	// 组级语义:同 key 多渠道共享同一套餐账号,保存时经 controller 同步到同组渠道。
	CodingPlanAutoControl      *bool `json:"coding_plan_auto_control"`
	CodingPlanDisableThreshold *int  `json:"coding_plan_disable_threshold"`
	CodingPlanEnableThreshold  *int  `json:"coding_plan_enable_threshold"`

	// CodingPlanQuotaGroup 编码套餐余量的分组指纹("厂商:密钥指纹"):同 key 多渠道共享
	// 同一值,前端据此把同 key 的渠道合并成一张余量卡。由查询生效 key 派生,不可逆,
	// 不下发原始密钥。仅在渠道列表(GetAllChannels)填充;非套餐渠道为空。
	CodingPlanQuotaGroup string `json:"coding_plan_quota_group,omitempty" gorm:"-"`

	OtherSettings string `json:"settings" gorm:"column:settings"` // 其他设置，存储azure版本等不需要检索的信息，详见dto.ChannelOtherSettings

	// cache info
	Keys []string `json:"-" gorm:"-"`

	// DisabledModels 该渠道内被禁用的模型集合（由 channel_model_settings 加载，
	// abilities 重建/缓存索引展开时合并：禁用模型不进入选路）。
	DisabledModels map[string]bool `json:"-" gorm:"-"`

	// ModelContextWindows 该渠道内按模型覆盖的上下文窗口（channel_model_settings，
	// 渠道级覆盖 > 模型默认 > 不限制）。与 DisabledModels 同批加载。
	ModelContextWindows map[string]int `json:"-" gorm:"-"`

	// ModelSettings 创建/更新渠道时随请求提交的模型设置（非持久列，写入口
	// BatchInsertChannels / Channel.Update 落库到 channel_model_settings）。
	ModelSettings []ChannelModelSetting `json:"model_settings,omitempty" gorm:"-"`

	// AccountId 挂载的账户（凭证与渠道解耦）：>0 时凭证类字段（key/base_url/代理/
	// 多key状态/套餐/余额）以账户为唯一真相源，本表同名列保留为 legacy 只读降级
	// （AccountId=0 时访问器回退渠道列）。存量渠道由迁移 backfill 生成私有账户。
	//
	// 已废弃：绑定关系真相源是 channel_accounts（一个渠道可绑多个账户）；本列只读兼容，
	// 迁移完成后删除。
	AccountId int `json:"account_id" gorm:"index"`

	// BoundAccounts 本渠道绑定的账户（按绑定轮询顺序，仅含渠道内启用的绑定；运行时挂载、
	// 不入库）。长度 >0 时 GetNextEnabledKey 在账户之间轮询；对象与缓存共享同一指针
	// （多 key 轮询状态跨渠道一致）。
	BoundAccounts []*Account `json:"-" gorm:"-"`

	// BoundAccountViews 绑定关系视图（含渠道内停用的绑定），下发给出渠道抽屉用。
	BoundAccountViews []BoundAccountView `json:"account_bindings,omitempty" gorm:"-"`

	// Account 运行时挂载的账户对象（缓存路径同一账户的多个渠道共享同一指针，
	// 多 key 轮询状态跨渠道一致；非持久列，由 loadAccount/loadChannelsAccounts
	// 或 InitChannelCache 填充）。
	Account *Account `json:"account,omitempty" gorm:"-"`
}

const ChannelStatusReasonAllKeysDisabled = "All keys are disabled"

type ChannelInfo struct {
	IsMultiKey             bool                  `json:"is_multi_key"`                        // 是否多Key模式
	MultiKeySize           int                   `json:"multi_key_size"`                      // 多Key模式下的Key数量
	MultiKeyStatusList     map[int]int           `json:"multi_key_status_list"`               // key状态列表，key index -> status
	MultiKeyDisabledReason map[int]string        `json:"multi_key_disabled_reason,omitempty"` // key禁用原因列表，key index -> reason
	MultiKeyDisabledTime   map[int]int64         `json:"multi_key_disabled_time,omitempty"`   // key禁用时间列表，key index -> time
	MultiKeyPollingIndex   int                   `json:"multi_key_polling_index"`             // 多Key模式下轮询的key索引
	MultiKeyMode           constant.MultiKeyMode `json:"multi_key_mode"`
}

type ChannelSortOptions struct {
	SortBy    string
	SortOrder string
	IDSort    bool
}

var channelSortColumns = map[string]string{
	"id":            "id",
	"name":          "name",
	"priority":      "priority",
	"balance":       "balance",
	"response_time": "response_time",
	"test_time":     "test_time",
}

func NewChannelSortOptions(sortBy string, sortOrder string, idSort bool) ChannelSortOptions {
	normalizedSortBy := strings.ToLower(strings.TrimSpace(sortBy))
	normalizedSortOrder := strings.ToLower(strings.TrimSpace(sortOrder))
	if _, ok := channelSortColumns[normalizedSortBy]; !ok {
		normalizedSortBy = ""
		normalizedSortOrder = ""
	} else if normalizedSortOrder != "asc" {
		normalizedSortOrder = "desc"
	}

	return ChannelSortOptions{
		SortBy:    normalizedSortBy,
		SortOrder: normalizedSortOrder,
		IDSort:    idSort,
	}
}

func (options ChannelSortOptions) Apply(query *gorm.DB) *gorm.DB {
	if columnName, ok := channelSortColumns[options.SortBy]; ok {
		return query.Order(clause.OrderByColumn{
			Column: clause.Column{Name: columnName},
			Desc:   options.SortOrder != "asc",
		})
	}
	if options.IDSort {
		return query.Order(clause.OrderByColumn{
			Column: clause.Column{Name: "id"},
			Desc:   true,
		})
	}
	return query.Order(clause.OrderByColumn{
		Column: clause.Column{Name: "priority"},
		Desc:   true,
	})
}

func resolveChannelSortOptions(idSort bool, sortOptions []ChannelSortOptions) ChannelSortOptions {
	if len(sortOptions) == 0 {
		return NewChannelSortOptions("", "", idSort)
	}
	options := sortOptions[0]
	options.IDSort = options.IDSort || idSort
	return options
}

func NormalizeChannelGroupFilter(group string) string {
	group = strings.TrimSpace(group)
	if group == "" || strings.EqualFold(group, "all") || strings.EqualFold(group, "null") {
		return ""
	}
	return group
}

func channelGroupFilterCondition() string {
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return `CONCAT(',', ` + commonGroupCol + `, ',') LIKE ? ESCAPE '!'`
	}
	return `(',' || ` + commonGroupCol + ` || ',') LIKE ? ESCAPE '!'`
}

func channelGroupFilterPattern(group string) string {
	group = strings.NewReplacer(
		"!", "!!",
		"%", "!%",
		"_", "!_",
	).Replace(group)
	return "%," + group + ",%"
}

func ApplyChannelGroupFilter(query *gorm.DB, group string) *gorm.DB {
	group = NormalizeChannelGroupFilter(group)
	if group == "" {
		return query
	}
	return query.Where(channelGroupFilterCondition(), channelGroupFilterPattern(group))
}

// Value implements driver.Valuer interface
// 必须返回 string 而非 []byte:PG simple protocol 下 []byte 参数按 bytea
// 编码,写 json 列会触发 SQLSTATE 22P02。
func (c ChannelInfo) Value() (driver.Value, error) {
	b, err := common.Marshal(&c)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// Scan implements sql.Scanner interface
func (c *ChannelInfo) Scan(value any) error {
	return common.Unmarshal(jsonScanBytes(value), c)
}

// loadAccount 挂载渠道引用的账户（凭证真相源）。AccountId>0 时查账户并挂到
// channel.Account；查询失败不阻断（回退 legacy 渠道列降级）但记日志。
func (channel *Channel) loadAccount() error {
	// 凭证真相源：先按绑定表取"主账户"（Phase A = 轮询顺序第一个可用绑定），取不到再
	// 回落 channels.account_id（迁移未跑到的库，保证不断流）。
	if accountId, err := GetPrimaryBoundAccountId(channel.Id); err == nil && accountId > 0 {
		channel.AccountId = accountId
	}
	if channel.AccountId <= 0 {
		return nil
	}
	channel.loadBoundAccounts()
	account, err := GetAccountById(channel.AccountId, true)
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to load account for channel: channel_id=%d, account_id=%d, error=%v", channel.Id, channel.AccountId, err))
		return err
	}
	prefillAccountMasked(account)
	channel.Account = account
	return nil
}

// loadChannelsAccounts 批量挂载渠道账户：一次 IN 查询 + 按 id 去重——同一账户的
// 多个渠道共享同一 *Account 指针，内存缓存下多 key 轮询状态/启停跨渠道一致。
// 供 InitChannelCache / 管理端列表路径调用。
func loadChannelsAccounts(channels []*Channel) error {
	// 主账户解析：一次查全部绑定，按 (account_order, id) 取每渠道第一条启用的绑定；
	// 没有绑定的渠道回落 channels.account_id（迁移过渡期）。
	channelIds := make([]int, 0, len(channels))
	for _, ch := range channels {
		if ch.Id > 0 {
			channelIds = append(channelIds, ch.Id)
		}
	}
	primary := make(map[int]int, len(channelIds))
	if len(channelIds) > 0 {
		var bindings []*ChannelAccount
		if err := DB.Where("channel_id IN ?", channelIds).
			Order("account_order asc, id asc").Find(&bindings).Error; err != nil {
			return err
		}
		for _, b := range bindings {
			if !b.Enabled {
				continue
			}
			if _, ok := primary[b.ChannelId]; !ok {
				primary[b.ChannelId] = b.AccountId
			}
		}
	}
	ids := make(map[int]bool)
	for _, ch := range channels {
		if accountId, ok := primary[ch.Id]; ok && accountId > 0 {
			ch.AccountId = accountId
			ids[accountId] = true
			continue
		}
		if ch.AccountId > 0 {
			ids[ch.AccountId] = true
		}
	}
	if len(ids) == 0 {
		return nil
	}
	accounts, err := GetAccountsByIds(lo.Keys(ids))
	if err != nil {
		return err
	}
	byId := make(map[int]*Account, len(accounts))
	for _, acc := range accounts {
		prefillAccountMasked(acc)
		byId[acc.Id] = acc
	}
	for _, ch := range channels {
		if ch.AccountId > 0 {
			ch.Account = byId[ch.AccountId]
		}
	}
	// 多账户：按绑定顺序挂全部启用账户（共享同一批 *Account 指针，与上面的主账户一致）
	bindingsByChannel := make(map[int][]int)
	// 视图需要含停用项，这里查全量绑定（启用项另外用于选路挂载）。
	allBindingsByChannel := make(map[int][]*ChannelAccount)
	{
		boundIds := make([]int, 0, len(channelIds))
		for _, ch := range channels {
			bindingsByChannel[ch.Id] = nil
			boundIds = append(boundIds, ch.Id)
		}
		var allBindings []*ChannelAccount
		if len(channelIds) > 0 {
			if err := DB.Where("channel_id IN ?", channelIds).
				Order("account_order asc, id asc").Find(&allBindings).Error; err == nil {
				for _, b := range allBindings {
					allBindingsByChannel[b.ChannelId] = append(allBindingsByChannel[b.ChannelId], b)
				}
			}
		}
		var bindings []*ChannelAccount
		if len(boundIds) > 0 {
			if err := DB.Where("channel_id IN ? AND enabled = ?", boundIds, true).
				Order("account_order asc, id asc").Find(&bindings).Error; err == nil {
				for _, b := range bindings {
					bindingsByChannel[b.ChannelId] = append(bindingsByChannel[b.ChannelId], b.AccountId)
				}
			}
		}
	}
	missing := make(map[int]bool)
	for _, ids := range bindingsByChannel {
		for _, id := range ids {
			if _, ok := byId[id]; !ok {
				missing[id] = true
			}
		}
	}
	if len(missing) > 0 {
		extra, err := GetAccountsByIds(lo.Keys(missing))
		if err == nil {
			for _, acc := range extra {
				prefillAccountMasked(acc)
				byId[acc.Id] = acc
			}
		}
	}
	// 视图里也要能显示停用绑定的账户摘要，补齐缺失的账户对象。
	viewMissing := make(map[int]bool)
	for _, list := range allBindingsByChannel {
		for _, b := range list {
			if _, ok := byId[b.AccountId]; !ok {
				viewMissing[b.AccountId] = true
			}
		}
	}
	if len(viewMissing) > 0 {
		extra, err := GetAccountsByIds(lo.Keys(viewMissing))
		if err == nil {
			for _, acc := range extra {
				prefillAccountMasked(acc)
				byId[acc.Id] = acc
			}
		}
	}
	for _, ch := range channels {
		bound := make([]*Account, 0, len(bindingsByChannel[ch.Id]))
		for _, id := range bindingsByChannel[ch.Id] {
			if acc := byId[id]; acc != nil {
				bound = append(bound, acc)
			}
		}
		ch.BoundAccounts = bound
		ch.BoundAccountViews = buildBoundAccountViews(allBindingsByChannel[ch.Id], byId)
	}
	return nil
}

// loadBoundAccounts 单渠道版：按绑定轮询顺序挂全部启用账户（渠道缓存刷新/详情路径）。
// 查询失败不阻断（保持主账户可用，调用方仍能按单账户工作）。
func (channel *Channel) loadBoundAccounts() {
	if channel.Id <= 0 {
		return
	}
	bindings, err := GetChannelAccountBindings(channel.Id)
	if err != nil {
		common.SysLog(fmt.Sprintf("load channel account bindings failed: channel_id=%d, error=%v", channel.Id, err))
		return
	}
	ids := make([]int, 0, len(bindings))
	for _, b := range bindings {
		if b.Enabled {
			ids = append(ids, b.AccountId)
		}
	}
	if len(ids) == 0 {
		return
	}
	accounts, err := GetAccountsByIds(ids)
	if err != nil {
		common.SysLog(fmt.Sprintf("load channel bound accounts failed: channel_id=%d, error=%v", channel.Id, err))
		return
	}
	byId := make(map[int]*Account, len(accounts))
	for _, acc := range accounts {
		prefillAccountMasked(acc)
		byId[acc.Id] = acc
	}
	bound := make([]*Account, 0, len(ids))
	for _, id := range ids {
		if acc := byId[id]; acc != nil {
			bound = append(bound, acc)
		}
	}
	channel.BoundAccounts = bound
	channel.BoundAccountViews = buildBoundAccountViews(bindings, byId)
}

// prefillAccountMasked 填充响应侧脱敏预览（key 多行时展示首个 + 计数）。
// Account.Key json:"-" 永不下发，前端凭 key_masked 呈现。
func prefillAccountMasked(account *Account) {
	if account == nil {
		return
	}
	account.KeyMasked = maskAccountKeyPreview(account.Key)
	if account.CodingPlanKey != "" {
		account.CodingPlanKeyMasked = maskAccountKeyPreview(account.CodingPlanKey)
	}
}

// maskAccountKeyPreview 脱敏：保留前 6 后 4；多行 key 显示首个 + 总数。
func maskAccountKeyPreview(key string) string {
	if key == "" {
		return ""
	}
	if strings.Contains(key, "\n") {
		parts := strings.Split(strings.Trim(key, "\n"), "\n")
		return maskAccountKeyPreview(parts[0]) + fmt.Sprintf(" 等 %d 个", len(parts))
	}
	if len(key) <= 10 {
		return strings.Repeat("*", len(key))
	}
	return key[:6] + "****" + key[len(key)-4:]
}

// LoadChannelsAccounts 导出版批量挂载渠道账户（供 controller 在内联列表查询
// ——不走 model.GetAllChannels——后调用，如渠道列表/标签模式）。
func LoadChannelsAccounts(channels []*Channel) error {
	return loadChannelsAccounts(channels)
}

// effectiveChannelInfo 返回多 key 状态的真相源：挂账户时为账户的 ChannelInfo
// （跨渠道共享），否则为渠道 legacy 列。多 key 读写路径（轮询/启停）统一经此取。
func (channel *Channel) effectiveChannelInfo() *ChannelInfo {
	if channel.Account != nil {
		return &channel.Account.ChannelInfo
	}
	return &channel.ChannelInfo
}

func (channel *Channel) GetKeys() []string {
	if channel.Account != nil {
		return channel.Account.GetKeys()
	}
	if channel.Key == "" {
		return []string{}
	}
	if len(channel.Keys) > 0 {
		return channel.Keys
	}
	trimmed := strings.TrimSpace(channel.Key)
	// If the key starts with '[', try to parse it as a JSON array (e.g., for Vertex AI scenarios)
	if strings.HasPrefix(trimmed, "[") {
		var arr []json.RawMessage
		if err := common.Unmarshal([]byte(trimmed), &arr); err == nil {
			res := make([]string, len(arr))
			for i, v := range arr {
				res[i] = string(v)
			}
			return res
		}
	}
	// Otherwise, fall back to splitting by newline
	keys := strings.Split(strings.Trim(channel.Key, "\n"), "\n")
	return keys
}

func (channel *Channel) GetNextEnabledKey() (string, int, *types.NewAPIError) {
	// 多账户：绑定的多个账户参与轮询，用法与渠道自身的多 key 完全一致（顺序轮询、
	// 单个在账户侧启停、失败切走）。只绑一个账户时行为与单账户路径完全一致。
	if len(channel.BoundAccounts) > 0 {
		// 单账户时该路径恒选中同一个账户，与下面"委托 Account"完全等价；
		// 零个已挂账户时才落到 legacy 渠道列。
		return channel.getNextKeyAcrossAccounts()
	}
	// 挂账户时凭证与多 key 状态全部委托账户（锁按账户 id，共享账户跨渠道轮询安全）。
	if channel.Account != nil {
		return channel.Account.GetNextEnabledKey()
	}
	// If not in multi-key mode, return the original key string directly.
	if !channel.ChannelInfo.IsMultiKey {
		return channel.Key, 0, nil
	}

	// Obtain all keys (split by \n)
	keys := channel.GetKeys()
	if len(keys) == 0 {
		// No keys available, return error, should disable the channel
		return "", 0, types.NewError(errors.New("no keys available"), types.ErrorCodeChannelNoAvailableKey)
	}

	lock := GetChannelPollingLock(channel.Id)
	lock.Lock()
	defer lock.Unlock()

	statusList := channel.ChannelInfo.MultiKeyStatusList
	// helper to get key status, default to enabled when missing
	getStatus := func(idx int) int {
		if statusList == nil {
			return common.ChannelStatusEnabled
		}
		if status, ok := statusList[idx]; ok {
			return status
		}
		return common.ChannelStatusEnabled
	}

	// Collect indexes of enabled keys
	enabledIdx := make([]int, 0, len(keys))
	for i := range keys {
		if getStatus(i) == common.ChannelStatusEnabled {
			enabledIdx = append(enabledIdx, i)
		}
	}
	// If no specific status list or none enabled, return an explicit error so caller can
	// properly handle a channel with no available keys (e.g. mark channel disabled).
	// Returning the first key here caused requests to keep using an already-disabled key.
	if len(enabledIdx) == 0 {
		return "", 0, types.NewError(errors.New("no enabled keys"), types.ErrorCodeChannelNoAvailableKey)
	}

	switch channel.ChannelInfo.MultiKeyMode {
	case constant.MultiKeyModeRandom:
		// Randomly pick one enabled key
		selectedIdx := enabledIdx[rand.Intn(len(enabledIdx))]
		return keys[selectedIdx], selectedIdx, nil
	case constant.MultiKeyModePolling:
		// Use channel-specific lock to ensure thread-safe polling

		channelInfo, err := CacheGetChannelInfo(channel.Id)
		if err != nil {
			return "", 0, types.NewError(err, types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
		}
		defer func() {
			if common.DebugEnabled {
				logger.LogDebug(nil, "channel %d polling index: %d", channel.Id, channel.ChannelInfo.MultiKeyPollingIndex)
			}
			if !common.MemoryCacheEnabled {
				_ = channel.SaveChannelInfo()
			} else {
				// CacheUpdateChannel(channel)
			}
		}()
		// Start from the saved polling index and look for the next enabled key
		start := channelInfo.MultiKeyPollingIndex
		if start < 0 || start >= len(keys) {
			start = 0
		}
		for i := range keys {
			idx := (start + i) % len(keys)
			if getStatus(idx) == common.ChannelStatusEnabled {
				// update polling index for next call (point to the next position)
				channel.ChannelInfo.MultiKeyPollingIndex = (idx + 1) % len(keys)
				return keys[idx], idx, nil
			}
		}
		// Fallback – should not happen, but return first enabled key
		return keys[enabledIdx[0]], enabledIdx[0], nil
	default:
		// Unknown mode, default to first enabled key (or original key string)
		return keys[enabledIdx[0]], enabledIdx[0], nil
	}
}

func (channel *Channel) SaveChannelInfo() error {
	if channel.Account != nil {
		return channel.Account.SaveChannelInfo()
	}
	return DB.Model(channel).Update("channel_info", channel.ChannelInfo).Error
}

func (channel *Channel) GetModels() []string {
	if channel.Models == "" {
		return []string{}
	}
	return strings.Split(strings.Trim(channel.Models, ","), ",")
}

// loadModelSettings 从 channel_model_settings 加载该渠道的模型覆盖设置：
// 被禁用的模型集合 + 按模型覆盖的上下文窗口（并填充 ModelSettings 供 API 输出）。
// db 为 nil 时用全局 DB；事务内调用（BatchInsertChannels → AddAbilities）必须传
// 事务句柄——单连接库（测试 sqlite MaxOpenConns=1）里用全局 DB 会等不到连接死锁，
// 多连接库也有"事务内读事务外快照"的一致性隐患。
func (channel *Channel) loadModelSettings(db *gorm.DB) error {
	if db == nil {
		db = DB
	}
	var settings []ChannelModelSetting
	if err := db.Where("channel_id = ?", channel.Id).Find(&settings).Error; err != nil {
		return err
	}
	if len(settings) == 0 {
		// 无设置行时保持 nil（而非空集合）：内存对象与从 DB 直接读回的对象
		// 必须逐字段相等，否则「读回来再比较」的断言会看到空 map vs nil 的差异。
		channel.DisabledModels, channel.ModelContextWindows, channel.ModelSettings = nil, nil, nil
		return nil
	}
	channel.DisabledModels, channel.ModelContextWindows, channel.ModelSettings = splitModelSettings(settings)
	return nil
}

// splitModelSettings 把模型设置行拆成禁用集合 + 上下文覆盖集合 + 原列表。
func splitModelSettings(settings []ChannelModelSetting) (map[string]bool, map[string]int, []ChannelModelSetting) {
	disabled := make(map[string]bool)
	contextWindows := make(map[string]int)
	for _, s := range settings {
		if !s.Enabled {
			disabled[s.Model] = true
		}
		if s.ContextWindow != nil {
			contextWindows[s.Model] = *s.ContextWindow
		}
	}
	return disabled, contextWindows, settings
}

// loadChannelsModelSettings 批量加载渠道的模型设置（禁用/上下文覆盖）并填充到各渠道。
// 供管理端列表/搜索一次 IN 查询，避免每渠道一次 DB 查询。
func loadChannelsModelSettings(channels []*Channel) error {
	ids := lo.Map(channels, func(ch *Channel, _ int) int { return ch.Id })
	if len(ids) == 0 {
		return nil
	}
	var settings []ChannelModelSetting
	if err := DB.Where("channel_id IN (?)", ids).Find(&settings).Error; err != nil {
		return err
	}
	byChannel := make(map[int][]ChannelModelSetting)
	for _, s := range settings {
		byChannel[s.ChannelId] = append(byChannel[s.ChannelId], s)
	}
	for _, ch := range channels {
		ch.DisabledModels, ch.ModelContextWindows, ch.ModelSettings = splitModelSettings(byChannel[ch.Id])
	}
	return nil
}

// LoadChannelsModelSettings 加载渠道的模型覆盖设置（禁用/上下文覆盖）并填充到各渠道。
// 导出版供 controller 在内联列表查询（不走 model.GetAllChannels）后调用。
func LoadChannelsModelSettings(channels []*Channel) error {
	return loadChannelsModelSettings(channels)
}

// ensureDisabledModelsLoaded 保证 DisabledModels 已加载（abilities 重建/缓存索引
// 展开时调用；已加载则跳过，避免每次重建都查一次 DB）。db 语义同 loadModelSettings。
func (channel *Channel) ensureDisabledModelsLoaded(db *gorm.DB) error {
	if channel.DisabledModels != nil {
		return nil
	}
	// 调用方已携带模型设置（创建/更新渠道流程）时禁用集合从携带行推导，不回读
	// 数据库：设置落库发生在 abilities 重建之后（BatchInsertChannels 的 upsert /
	// controller.UpdateChannel 的 ReplaceChannelModelSettings），此刻表里只有旧
	// 状态，loadModelSettings 会把携带的 ModelSettings 覆盖为空——更新流程随后
	// Replace(id, 空) 全量对齐等于删光，创建流程 len==0 判空跳过 upsert 静默丢失。
	// 附带修正：同次保存内 abilities 重建由此感知请求携带的禁用行。
	if channel.ModelSettings != nil {
		channel.DisabledModels, _, _ = splitModelSettings(channel.ModelSettings)
		return nil
	}
	return channel.loadModelSettings(db)
}

// LoadModelSettings 加载渠道的模型覆盖设置（禁用/上下文覆盖）。供 controller
// 在从 gin context 重建渠道对象后调用，保证渠道级 context_window 校验有数据。
func (channel *Channel) LoadModelSettings() error {
	return channel.loadModelSettings(nil)
}

// GetModelContextWindow 返回该渠道内某模型的上下文窗口覆盖；无覆盖返回 (0, false)。
// 覆盖优先级：渠道覆盖 > 模型默认（GetModelContextWindow）> 不限制。
func (channel *Channel) GetModelContextWindow(model string) (int, bool) {
	cw, ok := channel.ModelContextWindows[model]
	return cw, ok
}

func (channel *Channel) GetGroups() []string {
	if channel.Group == "" {
		return []string{}
	}
	groups := strings.Split(strings.Trim(channel.Group, ","), ",")
	for i, group := range groups {
		groups[i] = strings.TrimSpace(group)
	}
	return groups
}

func (channel *Channel) GetOtherInfo() map[string]any {
	otherInfo := make(map[string]any)
	if channel.OtherInfo != "" {
		err := common.Unmarshal([]byte(channel.OtherInfo), &otherInfo)
		if err != nil {
			common.SysLog(fmt.Sprintf("failed to unmarshal other info: channel_id=%d, tag=%s, name=%s, error=%v", channel.Id, channel.GetTag(), channel.Name, err))
		}
	}
	return otherInfo
}

func (channel *Channel) SetOtherInfo(otherInfo map[string]any) {
	otherInfoBytes, err := json.Marshal(otherInfo)
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to marshal other info: channel_id=%d, tag=%s, name=%s, error=%v", channel.Id, channel.GetTag(), channel.Name, err))
		return
	}
	channel.OtherInfo = string(otherInfoBytes)
}

func (channel *Channel) GetTag() string {
	if channel.Tag == nil {
		return ""
	}
	return *channel.Tag
}

func (channel *Channel) SetTag(tag string) {
	channel.Tag = &tag
}

func (channel *Channel) GetAutoBan() bool {
	if channel.AutoBan == nil {
		return false
	}
	return *channel.AutoBan == 1
}

func (channel *Channel) Save() error {
	return DB.Save(channel).Error
}

// saveStatusState persists only the fields owned by the channel status flow.
// Keeping this allowlist here prevents a stale channel snapshot from
// overwriting credentials, accounting counters, or channel configuration.
// 挂账户时多 key 状态（channel_info）归账户列，渠道只落 status/other_info。
func (channel *Channel) saveStatusState() error {
	if channel.Id == 0 {
		return errors.New("channel ID is 0")
	}
	updates := map[string]any{
		"status":     channel.Status,
		"other_info": channel.OtherInfo,
	}
	if channel.effectiveChannelInfo().IsMultiKey {
		if channel.Account != nil {
			if err := channel.Account.SaveChannelInfo(); err != nil {
				return err
			}
		} else {
			updates["channel_info"] = channel.ChannelInfo
		}
	}
	return DB.Model(&Channel{}).Where("id = ?", channel.Id).Updates(updates).Error
}

// SaveKey 仅更新密钥列。GORM Updates 会跳过空值字段，无法用空字符串清空密钥；
// 此方法显式 Select key，供 OpenCode Zen 等允许空密钥的渠道清空密钥（切回免费套餐）使用。
func (channel *Channel) SaveKey() error {
	if channel.Id == 0 {
		return errors.New("channel ID is 0")
	}
	return DB.Model(channel).Select("key").Update("key", channel.Key).Error
}

func GetAllChannels(startIdx int, num int, selectAll bool, idSort bool, sortOptions ...ChannelSortOptions) ([]*Channel, error) {
	var channels []*Channel
	var err error
	order := resolveChannelSortOptions(idSort, sortOptions)
	if selectAll {
		err = order.Apply(DB).Find(&channels).Error
	} else {
		err = order.Apply(DB).Limit(num).Offset(startIdx).Omit("key").Find(&channels).Error
	}
	if err != nil {
		return nil, err
	}
	// 填充渠道内模型设置（禁用/上下文覆盖），供列表展示
	_ = loadChannelsModelSettings(channels)
	// 挂载账户（凭证真相源；共享账户的渠道持有同一 *Account 指针）
	_ = loadChannelsAccounts(channels)
	return channels, nil
}

func GetChannelsByTag(tag string, idSort bool, selectAll bool, sortOptions ...ChannelSortOptions) ([]*Channel, error) {
	var channels []*Channel
	order := resolveChannelSortOptions(idSort, sortOptions)
	query := order.Apply(DB.Where("tag = ?", tag))
	if !selectAll {
		query = query.Omit("key")
	}
	err := query.Find(&channels).Error
	if err != nil {
		return nil, err
	}
	_ = loadChannelsModelSettings(channels)
	_ = loadChannelsAccounts(channels)
	return channels, nil
}

func SearchChannels(keyword string, group string, model string, idSort bool, sortOptions ...ChannelSortOptions) ([]*Channel, error) {
	var channels []*Channel
	modelsCol := "`models`"

	// 如果是 PostgreSQL，使用双引号
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		modelsCol = `"models"`
	}

	baseURLCol := "`base_url`"
	// 如果是 PostgreSQL，使用双引号
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		baseURLCol = `"base_url"`
	}

	order := resolveChannelSortOptions(idSort, sortOptions)

	// 构造基础查询
	baseQuery := DB.Model(&Channel{}).Omit("key")

	// 构造WHERE子句
	whereClause := "(id = ? OR name LIKE ? OR " + commonKeyCol + " = ? OR " + baseURLCol + " LIKE ?) AND " + modelsCol + " LIKE ?"
	args := []any{common.String2Int(keyword), "%" + keyword + "%", keyword, "%" + keyword + "%", "%" + model + "%"}
	baseQuery = ApplyChannelGroupFilter(baseQuery.Where(whereClause, args...), group)

	// 执行查询
	err := order.Apply(baseQuery).Find(&channels).Error
	if err != nil {
		return nil, err
	}
	_ = loadChannelsModelSettings(channels)
	_ = loadChannelsAccounts(channels)
	return channels, nil
}

// GetChannelById loads a channel directly from the database, bypassing the
// in-memory channel cache.
//
// WARNING: do NOT call this on request hot paths (middleware, distribution,
// relay submit/retry, polling). Every call is a synchronous DB query and will
// not see cache-only state. Use CacheGetChannel instead: it serves from the
// in-memory cache and falls back to this function automatically when
// MemoryCacheEnabled is false. Direct use is appropriate only where fresh DB
// state is required, e.g. admin CRUD, channel testing, or cache (re)building.
func GetChannelById(id int, selectAll bool) (*Channel, error) {
	channel := &Channel{Id: id}
	var err error = nil
	if selectAll {
		err = DB.First(channel, "id = ?", id).Error
	} else {
		err = DB.Omit("key").First(channel, "id = ?", id).Error
	}
	if err != nil {
		return nil, err
	}
	// 填充渠道内模型设置（禁用/上下文覆盖），供编辑抽屉回显
	_ = channel.loadModelSettings(nil)
	// 挂载账户（凭证真相源）
	_ = channel.loadAccount()
	// 绑定关系视图（含渠道内停用的绑定），渠道抽屉回显用
	channel.LoadBoundAccountViews()
	return channel, nil
}

func BatchInsertChannels(channels []Channel) error {
	if len(channels) == 0 {
		return nil
	}
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	for _, chunk := range lo.Chunk(channels, 50) {
		for i := range chunk {
			// 凭证与渠道解耦：未显式绑定账户的渠道在事务内生成私有账户
			// （凭证字段一一搬运，AutoGenerated=true 标记系统生成，删除渠道后
			// 孤儿清理只回收此类账户）。显式携带 AccountId（共享账户）跳过。
			if chunk[i].AccountId == 0 {
				account := buildPrivateAccountFromChannel(&chunk[i])
				if err := tx.Create(account).Error; err != nil {
					tx.Rollback()
					return err
				}
				chunk[i].AccountId = account.Id
			}
		}
		if err := tx.Create(&chunk).Error; err != nil {
			tx.Rollback()
			return err
		}
		for i := range chunk {
			if err := BindChannelAccountWithDB(tx, chunk[i].Id, chunk[i].AccountId, 0); err != nil {
				common.SysLog(fmt.Sprintf("bind channel account failed: channel_id=%d, account_id=%d, error=%v", chunk[i].Id, chunk[i].AccountId, err))
			}
			if err := chunk[i].AddAbilities(tx); err != nil {
				tx.Rollback()
				return err
			}
			// 渠道内模型设置（禁用/上下文覆盖）随创建一并落库
			if len(chunk[i].ModelSettings) > 0 {
				if err := upsertChannelModelSettingsWithDB(tx, chunk[i].Id, chunk[i].ModelSettings); err != nil {
					tx.Rollback()
					return err
				}
			}
		}
	}
	return tx.Commit().Error
}

// buildPrivateAccountFromChannel 从渠道对象生成私有账户（创建路径与
// ensureChannelAccountBackfill 同一套字段搬运，保持语义一致）。
func buildPrivateAccountFromChannel(channel *Channel) *Account {
	return &Account{
		Name:                       channel.Name + "（私有）",
		Type:                       channel.Type,
		Status:                     common.ChannelStatusEnabled,
		Key:                        channel.Key,
		OpenAIOrganization:         channel.OpenAIOrganization,
		BaseURL:                    channel.BaseURL,
		Other:                      channel.Other,
		Setting:                    channel.Setting,
		ChannelInfo:                channel.ChannelInfo,
		Balance:                    channel.Balance,
		BalanceUpdatedTime:         channel.BalanceUpdatedTime,
		CodingPlanProvider:         channel.CodingPlanProvider,
		CodingPlanKey:              channel.CodingPlanKey,
		CodingPlanAutoControl:      channel.CodingPlanAutoControl,
		CodingPlanDisableThreshold: channel.CodingPlanDisableThreshold,
		CodingPlanEnableThreshold:  channel.CodingPlanEnableThreshold,
		CreatedTime:                common.GetTimestamp(),
		AutoGenerated:              true,
	}
}

func BatchDeleteChannels(ids []int) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	// 使用事务 分批删除channel表和abilities表
	tx := DB.Begin()
	if tx.Error != nil {
		return 0, tx.Error
	}
	var deletedCount int64
	for _, chunk := range lo.Chunk(ids, 200) {
		result := tx.Where("id in (?)", chunk).Delete(&Channel{})
		if result.Error != nil {
			tx.Rollback()
			return 0, result.Error
		}
		deletedCount += result.RowsAffected
		if err := tx.Where("channel_id in (?)", chunk).Delete(&Ability{}).Error; err != nil {
			tx.Rollback()
			return 0, err
		}
		if err := DeleteChannelAccountBindingsForChannels(tx, chunk); err != nil {
			common.SysLog(fmt.Sprintf("delete channel account bindings failed: %v", err))
		}
	}
	if err := tx.Commit().Error; err != nil {
		return 0, err
	}
	return deletedCount, nil
}

func (channel *Channel) GetPriority() int64 {
	if channel.Priority == nil {
		return 0
	}
	return *channel.Priority
}

func (channel *Channel) GetWeight() int {
	if channel.Weight == nil {
		return 0
	}
	return int(*channel.Weight)
}

func (channel *Channel) GetBaseURL() string {
	// 挂账户时上游地址以账户为准（语义与渠道列一致：nil=未配置返回空串，
	// 空串=用厂商默认地址；backfill 时账户列从渠道列指针拷贝，语义等价）。
	if channel.Account != nil {
		if channel.Account.BaseURL == nil {
			return ""
		}
		url := *channel.Account.BaseURL
		if url == "" {
			url = constant.ChannelBaseURLs[channel.Type]
		}
		return url
	}
	if channel.BaseURL == nil {
		return ""
	}
	url := *channel.BaseURL
	if url == "" {
		url = constant.GetChannelBaseURL(channel.Type)
	}
	return url
}

func (channel *Channel) GetModelMapping() string {
	if channel.ModelMapping == nil {
		return ""
	}
	return *channel.ModelMapping
}

func (channel *Channel) GetStatusCodeMapping() string {
	if channel.StatusCodeMapping == nil {
		return ""
	}
	return *channel.StatusCodeMapping
}

func (channel *Channel) Insert() error {
	var err error
	err = DB.Create(channel).Error
	if err != nil {
		return err
	}
	// 绑定表双写：channels.account_id 仍是 controller 的写入口，这里收敛出绑定行。
	if err := syncPrimaryBindingFromChannelColumn(channel.Id, channel.AccountId); err != nil {
		common.SysLog(fmt.Sprintf("sync channel account binding failed: channel_id=%d, error=%v", channel.Id, err))
	}
	err = channel.AddAbilities(nil)
	return err
}

func (channel *Channel) Update() error {
	// If this is a multi-key channel, recalculate MultiKeySize based on the current key list to avoid inconsistency after editing keys
	if channel.ChannelInfo.IsMultiKey {
		var keyStr string
		if channel.Key != "" {
			keyStr = channel.Key
		} else {
			// If key is not provided, read the existing key from the database
			if existing, err := GetChannelById(channel.Id, true); err == nil {
				keyStr = existing.Key
			}
		}
		// Parse the key list (supports newline separation or JSON array)
		keys := []string{}
		if keyStr != "" {
			trimmed := strings.TrimSpace(keyStr)
			if strings.HasPrefix(trimmed, "[") {
				var arr []json.RawMessage
				if err := common.Unmarshal([]byte(trimmed), &arr); err == nil {
					keys = make([]string, len(arr))
					for i, v := range arr {
						keys[i] = string(v)
					}
				}
			}
			if len(keys) == 0 { // fallback to newline split
				keys = strings.Split(strings.Trim(keyStr, "\n"), "\n")
			}
		}
		channel.ChannelInfo.MultiKeySize = len(keys)
		// Clean up status data that exceeds the new key count to prevent index out of range
		if channel.ChannelInfo.MultiKeyStatusList != nil {
			for idx := range channel.ChannelInfo.MultiKeyStatusList {
				if idx >= channel.ChannelInfo.MultiKeySize {
					delete(channel.ChannelInfo.MultiKeyStatusList, idx)
				}
			}
		}
	}
	var err error
	err = DB.Model(channel).Updates(channel).Error
	if err != nil {
		return err
	}
	DB.Model(channel).First(channel, "id = ?", channel.Id)
	// 渠道内模型设置（禁用/上下文覆盖）不在此处落库：全量对齐以调用方携带的
	// ModelSettings 为准，任何未显式携带 model_settings 的局部更新（改名称、MultiKey
	// 操作等）都会把 settings 表清空。写入口收敛到 controller.UpdateChannel（请求显式
	// 携带 model_settings 时调用 ReplaceChannelModelSettings），其余路径保持不动。
	// 绑定表双写（换绑/解绑后收敛绑定行）。
	if err := syncPrimaryBindingFromChannelColumn(channel.Id, channel.AccountId); err != nil {
		common.SysLog(fmt.Sprintf("sync channel account binding failed: channel_id=%d, error=%v", channel.Id, err))
	}
	err = channel.UpdateAbilities(nil)
	return err
}

func (channel *Channel) UpdateResponseTime(responseTime int64) {
	err := DB.Model(channel).Select("response_time", "test_time").Updates(Channel{
		TestTime:     common.GetTimestamp(),
		ResponseTime: int(responseTime),
	}).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to update response time: channel_id=%d, error=%v", channel.Id, err))
	}
}

func (channel *Channel) UpdateBalance(balance float64) {
	// 余额归账户：多渠道共享同一份余额，查一次全刷新。
	if channel.Account != nil {
		channel.Account.UpdateBalance(balance)
		return
	}
	err := DB.Model(channel).Select("balance_updated_time", "balance").Updates(Channel{
		BalanceUpdatedTime: common.GetTimestamp(),
		Balance:            balance,
	}).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to update balance: channel_id=%d, error=%v", channel.Id, err))
	}
}

func (channel *Channel) Delete() error {
	var err error
	err = DB.Delete(channel).Error
	if err != nil {
		return err
	}
	if err := DeleteChannelAccountBindings(DB, channel.Id); err != nil {
		common.SysLog(fmt.Sprintf("delete channel account bindings failed: channel_id=%d, error=%v", channel.Id, err))
	}
	err = channel.DeleteAbilities()
	return err
}

var channelStatusLock sync.Mutex

// channelPollingLocks stores locks for each channel.id to ensure thread-safe polling
var channelPollingLocks sync.Map

// GetChannelPollingLock returns or creates a mutex for the given channel ID
func GetChannelPollingLock(channelId int) *sync.Mutex {
	if lock, exists := channelPollingLocks.Load(channelId); exists {
		return lock.(*sync.Mutex)
	}
	// Create new lock for this channel
	newLock := &sync.Mutex{}
	actual, _ := channelPollingLocks.LoadOrStore(channelId, newLock)
	return actual.(*sync.Mutex)
}

// CleanupChannelPollingLocks removes locks for channels that no longer exist
// This is optional and can be called periodically to prevent memory leaks
func CleanupChannelPollingLocks() {
	var activeChannelIds []int
	DB.Model(&Channel{}).Pluck("id", &activeChannelIds)

	activeChannelSet := make(map[int]bool)
	for _, id := range activeChannelIds {
		activeChannelSet[id] = true
	}

	channelPollingLocks.Range(func(key, value any) bool {
		channelId := key.(int)
		if !activeChannelSet[channelId] {
			channelPollingLocks.Delete(channelId)
		}
		return true
	})
}

// resolveChannelStateLock 返回渠道状态流（多 key 读写+持久化）应持的锁：
// 挂账户时为账户锁（共享账户的多渠道互斥，锁的是凭证状态真相源），否则渠道锁。
// 缓存路径直接读缓存对象的 AccountId；非缓存轻量查一次 account_id 列。
// 非热路径（状态变更），多一次轻量解析可接受。
func resolveChannelStateLock(channelId int) *sync.Mutex {
	if common.MemoryCacheEnabled {
		if channelCache, _ := CacheGetChannel(channelId); channelCache != nil {
			if channelCache.Account != nil {
				return GetAccountPollingLock(channelCache.Account.Id)
			}
			return GetChannelPollingLock(channelId)
		}
	}
	if accountId, err := GetPrimaryBoundAccountId(channelId); err == nil && accountId > 0 {
		return GetAccountPollingLock(accountId)
	}
	return GetChannelPollingLock(channelId)
}

func handlerMultiKeyUpdate(channel *Channel, usingKey string, status int, reason string) {
	// 多 key 状态真相源：挂账户时为账户 ChannelInfo（跨渠道共享），否则渠道列。
	ci := channel.effectiveChannelInfo()
	keys := channel.GetKeys()
	if len(keys) == 0 {
		channel.Status = status
	} else {
		keyIndex := -1
		for i, key := range keys {
			if key == usingKey {
				keyIndex = i
				break
			}
		}
		if keyIndex < 0 {
			if usingKey != "" {
				common.SysLog(fmt.Sprintf("failed to update multi-key status: channel_id=%d, using key not found", channel.Id))
				return
			}
			channel.Status = status
			info := channel.GetOtherInfo()
			info["status_reason"] = reason
			info["status_time"] = common.GetTimestamp()
			channel.SetOtherInfo(info)
			return
		}
		if ci.MultiKeyStatusList == nil {
			ci.MultiKeyStatusList = make(map[int]int)
		}
		if status == common.ChannelStatusEnabled {
			delete(ci.MultiKeyStatusList, keyIndex)
		} else {
			ci.MultiKeyStatusList[keyIndex] = status
			if ci.MultiKeyDisabledReason == nil {
				ci.MultiKeyDisabledReason = make(map[int]string)
			}
			if ci.MultiKeyDisabledTime == nil {
				ci.MultiKeyDisabledTime = make(map[int]int64)
			}
			ci.MultiKeyDisabledReason[keyIndex] = reason
			ci.MultiKeyDisabledTime[keyIndex] = common.GetTimestamp()
		}
		if !hasEnabledMultiKey(keys, ci.MultiKeyStatusList) {
			channel.Status = common.ChannelStatusAutoDisabled
			info := channel.GetOtherInfo()
			info["status_reason"] = ChannelStatusReasonAllKeysDisabled
			info["status_time"] = common.GetTimestamp()
			channel.SetOtherInfo(info)
		} else if status == common.ChannelStatusEnabled {
			channel.Status = common.ChannelStatusEnabled
		}
	}
}

func hasEnabledMultiKey(keys []string, statusList map[int]int) bool {
	for i := range keys {
		if statusList == nil {
			return true
		}
		status, ok := statusList[i]
		if !ok || status == common.ChannelStatusEnabled {
			return true
		}
	}
	return false
}

func UpdateChannelStatus(channelId int, usingKey string, status int, reason string) bool {
	if common.MemoryCacheEnabled {
		channelStatusLock.Lock()
		defer channelStatusLock.Unlock()
	}

	// ChannelInfo stores both multi-key status and the polling cursor. Hold the
	// same per-channel lock from the first read through persistence so neither
	// writer can save a stale JSON snapshot over the other.
	// 挂账户时多 key 状态在账户上（跨渠道共享），锁升级为账户锁：共享同一账户的
	// 多渠道并发写不会互相覆盖。先轻量解析 account_id（缓存优先），再选锁。
	pollingLock := resolveChannelStateLock(channelId)
	pollingLock.Lock()
	defer pollingLock.Unlock()

	if common.MemoryCacheEnabled {
		channelCache, _ := CacheGetChannel(channelId)
		if channelCache == nil {
			return false
		}
		if channelCache.effectiveChannelInfo().IsMultiKey {
			beforeStatus := channelCache.Status
			// 如果是多Key模式，更新缓存中的状态
			handlerMultiKeyUpdate(channelCache, usingKey, status, reason)
			if beforeStatus != channelCache.Status {
				CacheUpdateChannelStatus(channelId, channelCache.Status)
			}
			//CacheUpdateChannel(channelCache)
			//return true
		} else {
			// 如果缓存渠道存在，且状态已是目标状态，直接返回
			if channelCache.Status == status {
				return false
			}
			CacheUpdateChannelStatus(channelId, status)
		}
	}

	shouldUpdateAbilities := false
	defer func() {
		if shouldUpdateAbilities {
			err := UpdateAbilityStatus(channelId, status == common.ChannelStatusEnabled)
			if err != nil {
				common.SysLog(fmt.Sprintf("failed to update ability status: channel_id=%d, error=%v", channelId, err))
			}
		}
	}()
	channel, err := GetChannelById(channelId, true)
	if err != nil {
		return false
	} else {
		// A manual channel operation must replace the exhaustion reason even
		// when the status value is already manually disabled.
		overridesKeyExhaustion := channel.ChannelInfo.IsMultiKey && usingKey == "" &&
			status == common.ChannelStatusManuallyDisabled && reason != ChannelStatusReasonAllKeysDisabled &&
			channel.GetOtherInfo()["status_reason"] == ChannelStatusReasonAllKeysDisabled
		if channel.Status == status && !overridesKeyExhaustion {
			return false
		}

		if channel.effectiveChannelInfo().IsMultiKey {
			beforeStatus := channel.Status
			handlerMultiKeyUpdate(channel, usingKey, status, reason)
			if beforeStatus != channel.Status {
				shouldUpdateAbilities = true
			}
		} else {
			info := channel.GetOtherInfo()
			info["status_reason"] = reason
			info["status_time"] = common.GetTimestamp()
			channel.SetOtherInfo(info)
			channel.Status = status
			shouldUpdateAbilities = true
		}
		err = channel.saveStatusState()
		if err != nil {
			common.SysLog(fmt.Sprintf("failed to update channel status: channel_id=%d, status=%d, error=%v", channel.Id, status, err))
			return false
		}
	}
	return true
}

func EnableChannelByTag(tag string) error {
	err := DB.Model(&Channel{}).Where("tag = ?", tag).Update("status", common.ChannelStatusEnabled).Error
	if err != nil {
		return err
	}
	err = UpdateAbilityStatusByTag(tag, true)
	return err
}

func DisableChannelByTag(tag string) error {
	// Explicit tag-level disable also cancels automatic restoration for
	// channels that were already disabled because all keys were unavailable.
	var channels []Channel
	if err := DB.Where("tag = ?", tag).Find(&channels).Error; err != nil {
		return err
	}
	for _, channel := range channels {
		if channel.ChannelInfo.IsMultiKey && channel.GetOtherInfo()["status_reason"] == ChannelStatusReasonAllKeysDisabled {
			if !UpdateChannelStatus(channel.Id, "", common.ChannelStatusManuallyDisabled, "manual tag operation") {
				return fmt.Errorf("failed to disable channel #%d by tag", channel.Id)
			}
		}
	}
	err := DB.Model(&Channel{}).Where("tag = ?", tag).Update("status", common.ChannelStatusManuallyDisabled).Error
	if err != nil {
		return err
	}
	err = UpdateAbilityStatusByTag(tag, false)
	return err
}

func EditChannelByTag(tag string, newTag *string, modelMapping *string, models *string, group *string, priority *int64, weight *uint, paramOverride *string, headerOverride *string) error {
	updateData := Channel{}
	shouldReCreateAbilities := false
	updatedTag := tag
	// 如果 newTag 不为空且不等于 tag，则更新 tag
	if newTag != nil && *newTag != tag {
		updateData.Tag = newTag
		updatedTag = *newTag
	}
	if modelMapping != nil {
		updateData.ModelMapping = modelMapping
	}
	if models != nil && *models != "" {
		shouldReCreateAbilities = true
		updateData.Models = *models
	}
	if group != nil && *group != "" {
		shouldReCreateAbilities = true
		updateData.Group = *group
	}
	if priority != nil {
		updateData.Priority = priority
	}
	if weight != nil {
		updateData.Weight = weight
	}
	if paramOverride != nil {
		updateData.ParamOverride = paramOverride
	}
	if headerOverride != nil {
		updateData.HeaderOverride = headerOverride
	}

	err := DB.Model(&Channel{}).Where("tag = ?", tag).Updates(updateData).Error
	if err != nil {
		return err
	}
	if shouldReCreateAbilities {
		channels, err := GetChannelsByTag(updatedTag, false, false)
		if err == nil {
			for _, channel := range channels {
				err = channel.UpdateAbilities(nil)
				if err != nil {
					common.SysLog(fmt.Sprintf("failed to update abilities: channel_id=%d, tag=%s, error=%v", channel.Id, channel.GetTag(), err))
				}
			}
		}
	} else {
		err := UpdateAbilityByTag(tag, newTag, priority, weight)
		if err != nil {
			return err
		}
	}
	return nil
}

func UpdateChannelUsedQuota(id int, quota int) {
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeChannelUsedQuota, id, quota)
		return
	}
	updateChannelUsedQuota(id, quota)
}

func updateChannelUsedQuota(id int, quota int) {
	err := DB.Model(&Channel{}).Where("id = ?", id).Update("used_quota", gorm.Expr("used_quota + ?", quota)).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to update channel used quota: channel_id=%d, delta_quota=%d, error=%v", id, quota, err))
	}
}

func DeleteChannelByStatus(status int64) (int64, error) {
	result := DB.Where("status = ?", status).Delete(&Channel{})
	return result.RowsAffected, result.Error
}

func DeleteDisabledChannel() (int64, error) {
	result := DB.Where("status = ? or status = ?", common.ChannelStatusAutoDisabled, common.ChannelStatusManuallyDisabled).Delete(&Channel{})
	return result.RowsAffected, result.Error
}

func GetPaginatedTags(offset int, limit int) ([]*string, error) {
	return GetPaginatedChannelTags(DB.Model(&Channel{}), offset, limit)
}

func GetPaginatedChannelTags(query *gorm.DB, offset int, limit int) ([]*string, error) {
	var tags []*string
	err := query.
		Select("DISTINCT tag").
		Where("tag is not null AND tag != ''").
		Order(clause.OrderByColumn{Column: clause.Column{Name: "tag"}}).
		Offset(offset).
		Limit(limit).
		Find(&tags).Error
	return tags, err
}

func SearchTags(keyword string, group string, model string, idSort bool) ([]*string, error) {
	var tags []*string
	modelsCol := "`models`"

	// 如果是 PostgreSQL，使用双引号
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		modelsCol = `"models"`
	}

	baseURLCol := "`base_url`"
	// 如果是 PostgreSQL，使用双引号
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		baseURLCol = `"base_url"`
	}

	order := "priority desc"
	if idSort {
		order = "id desc"
	}

	// 构造基础查询
	baseQuery := DB.Model(&Channel{}).Omit("key")

	// 构造WHERE子句
	whereClause := "(id = ? OR name LIKE ? OR " + commonKeyCol + " = ? OR " + baseURLCol + " LIKE ?) AND " + modelsCol + " LIKE ?"
	args := []any{common.String2Int(keyword), "%" + keyword + "%", keyword, "%" + keyword + "%", "%" + model + "%"}
	baseQuery = ApplyChannelGroupFilter(baseQuery.Where(whereClause, args...), group)

	subQuery := baseQuery.
		Select("tag").
		Where("tag != ''").
		Order(order)

	err := DB.Table("(?) as sub", subQuery).
		Select("DISTINCT tag").
		Find(&tags).Error

	if err != nil {
		return nil, err
	}

	return tags, nil
}

func (channel *Channel) ValidateSettings() error {
	channelParams := &dto.ChannelSettings{}
	if channel.Setting != nil && *channel.Setting != "" {
		err := common.Unmarshal([]byte(*channel.Setting), channelParams)
		if err != nil {
			return err
		}
	}
	if _, err := common.ParseProxyURLStrict(channelParams.Proxy); err != nil {
		return fmt.Errorf("invalid channel proxy: %w", err)
	}
	if err := channelParams.ValidateHTTPTransport(); err != nil {
		return err
	}
	channelOtherSettings := &dto.ChannelOtherSettings{}
	if channel.OtherSettings != "" {
		err := common.UnmarshalJsonStr(channel.OtherSettings, channelOtherSettings)
		if err != nil {
			return err
		}
	}
	if err := channelOtherSettings.ValidateToolLossPolicy(); err != nil {
		return err
	}
	if preset := common.GetAdvancedCustomPreset(channel.Type); preset != nil {
		channelOtherSettings.AdvancedCustom = preset
	}
	if constant.IsAdvancedCustomChannel(channel.Type) {
		if channelOtherSettings.AdvancedCustom == nil {
			return fmt.Errorf("advanced_custom is required")
		}
	}
	if channelOtherSettings.AdvancedCustom != nil {
		if err := channelOtherSettings.AdvancedCustom.Validate(); err != nil {
			return err
		}
	}
	if constant.IsAdvancedCustomChannel(channel.Type) && channelOtherSettings.UpstreamModelUpdateCheckEnabled {
		if _, ok := channelOtherSettings.AdvancedCustom.ModelListRoute(); !ok {
			return fmt.Errorf("advanced custom channels require a %s route when upstream model update checks are enabled", dto.AdvancedCustomModelListPath)
		}
	}
	return nil
}

func (channel *Channel) GetSetting() dto.ChannelSettings {
	// 挂账户时代理等设置以账户为准（backfill 已搬运，账户列语义等价）。
	if channel.Account != nil {
		return channel.Account.GetSetting()
	}
	setting := dto.ChannelSettings{}
	if channel.Setting != nil && *channel.Setting != "" {
		err := common.Unmarshal([]byte(*channel.Setting), &setting)
		if err != nil {
			common.SysLog(fmt.Sprintf("failed to unmarshal setting: channel_id=%d, error=%v", channel.Id, err))
			channel.Setting = nil // 清空设置以避免后续错误
			_ = channel.Save()    // 保存修改
		}
	}
	return setting
}

func (channel *Channel) SetSetting(setting dto.ChannelSettings) {
	settingBytes, err := common.Marshal(setting)
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to marshal setting: channel_id=%d, error=%v", channel.Id, err))
		return
	}
	channel.Setting = common.GetPointer[string](string(settingBytes))
}

func (channel *Channel) GetOtherSettings() dto.ChannelOtherSettings {
	// 挂账户时做 JSON 键级浅合并：账户基底 + 渠道非空键覆盖。AdvancedCustom /
	// UpstreamModelUpdate*（模型检测状态）等渠道级配置留在渠道列整体覆盖；
	// Azure 版本、Vertex key type 等凭证侧配置随账户共享。
	if channel.Account != nil && channel.Account.OtherSettings != "" {
		merged := dto.ChannelOtherSettings{}
		base := map[string]any{}
		if err := common.UnmarshalJsonStr(channel.Account.OtherSettings, &base); err != nil {
			common.SysLog(fmt.Sprintf("failed to unmarshal account settings: account_id=%d, error=%v", channel.Account.Id, err))
			return channel.getOwnOtherSettings()
		}
		if channel.OtherSettings != "" {
			overlay := map[string]any{}
			if err := common.UnmarshalJsonStr(channel.OtherSettings, &overlay); err != nil {
				common.SysLog(fmt.Sprintf("failed to unmarshal channel settings: channel_id=%d, error=%v", channel.Id, err))
			} else {
				for k, v := range overlay {
					base[k] = v
				}
			}
		}
		mergedBytes, err := common.Marshal(base)
		if err == nil {
			err = common.UnmarshalJsonStr(string(mergedBytes), &merged)
		}
		if err == nil {
			return merged
		}
		common.SysLog(fmt.Sprintf("failed to merge channel settings: channel_id=%d, error=%v", channel.Id, err))
		return channel.getOwnOtherSettings()
	}
	return channel.getOwnOtherSettings()
}

// getOwnOtherSettings 解析渠道自身 OtherSettings 列（legacy 路径 / 合并失败回退）。
func (channel *Channel) getOwnOtherSettings() dto.ChannelOtherSettings {
	setting := dto.ChannelOtherSettings{}
	if channel.OtherSettings != "" {
		err := common.UnmarshalJsonStr(channel.OtherSettings, &setting)
		if err != nil {
			common.SysLog(fmt.Sprintf("failed to unmarshal setting: channel_id=%d, error=%v", channel.Id, err))
			channel.OtherSettings = "{}" // 清空设置以避免后续错误
			_ = channel.Save()           // 保存修改
		}
	}
	if preset := common.GetAdvancedCustomPreset(channel.Type); preset != nil {
		setting.AdvancedCustom = preset
	}
	return setting
}

func (channel *Channel) SetOtherSettings(setting dto.ChannelOtherSettings) {
	settingBytes, err := common.Marshal(setting)
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to marshal setting: channel_id=%d, error=%v", channel.Id, err))
		return
	}
	channel.OtherSettings = string(settingBytes)
}

func (channel *Channel) GetParamOverride() map[string]any {
	paramOverride := make(map[string]any)
	if channel.ParamOverride != nil && *channel.ParamOverride != "" {
		err := common.Unmarshal([]byte(*channel.ParamOverride), &paramOverride)
		if err != nil {
			common.SysLog(fmt.Sprintf("failed to unmarshal param override: channel_id=%d, error=%v", channel.Id, err))
		}
	}
	return paramOverride
}

func (channel *Channel) GetHeaderOverride() map[string]any {
	headerOverride := make(map[string]any)
	if channel.HeaderOverride != nil && *channel.HeaderOverride != "" {
		err := common.Unmarshal([]byte(*channel.HeaderOverride), &headerOverride)
		if err != nil {
			common.SysLog(fmt.Sprintf("failed to unmarshal header override: channel_id=%d, error=%v", channel.Id, err))
		}
	}
	return headerOverride
}

func GetChannelsByIds(ids []int) ([]*Channel, error) {
	var channels []*Channel
	err := DB.Where("id in (?)", ids).Find(&channels).Error
	if err != nil {
		return nil, err
	}
	_ = loadChannelsAccounts(channels)
	return channels, nil
}

func BatchSetChannelTag(ids []int, tag *string) error {
	// 开启事务
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}

	// 更新标签
	err := tx.Model(&Channel{}).Where("id in (?)", ids).Update("tag", tag).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	// update ability status
	channels, err := GetChannelsByIds(ids)
	if err != nil {
		tx.Rollback()
		return err
	}

	for _, channel := range channels {
		err = channel.UpdateAbilities(tx)
		if err != nil {
			tx.Rollback()
			return err
		}
	}

	// 提交事务
	return tx.Commit().Error
}

// CountAllChannels returns total channels in DB
func CountAllChannels() (int64, error) {
	var total int64
	err := DB.Model(&Channel{}).Count(&total).Error
	return total, err
}

// CountAllTags returns number of non-empty distinct tags
func CountAllTags() (int64, error) {
	return CountChannelTags(DB.Model(&Channel{}))
}

func CountChannelTags(query *gorm.DB) (int64, error) {
	var total int64
	err := query.Where("tag is not null AND tag != ''").Distinct("tag").Count(&total).Error
	return total, err
}

// Get channels of specified type with pagination
func GetChannelsByType(startIdx int, num int, idSort bool, channelType int) ([]*Channel, error) {
	var channels []*Channel
	order := "priority desc"
	if idSort {
		order = "id desc"
	}
	err := DB.Where("type = ?", channelType).Order(order).Limit(num).Offset(startIdx).Omit("key").Find(&channels).Error
	return channels, err
}

// Count channels of specific type
func CountChannelsByType(channelType int) (int64, error) {
	var count int64
	err := DB.Model(&Channel{}).Where("type = ?", channelType).Count(&count).Error
	return count, err
}

// Return map[type]count for all channels
func CountChannelsGroupByType() (map[int64]int64, error) {
	type result struct {
		Type  int64 `gorm:"column:type"`
		Count int64 `gorm:"column:count"`
	}
	var results []result
	err := DB.Model(&Channel{}).Select("type, count(*) as count").Group("type").Find(&results).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[int64]int64)
	for _, r := range results {
		counts[r.Type] = r.Count
	}
	return counts, nil
}
