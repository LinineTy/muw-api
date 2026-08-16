package operation_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// CreditScoreSetting 信誉分体系配置。Enabled 总开关（默认关，部署后在设置页开启）；
// AutoFreezeEnabled 低于 FreezeThreshold 时 TokenAuth 冻结 /v1 调用（账号本身不禁用）。
// ViolationMarkers 为换行分隔的上游违规标记词（大小写不敏感子串匹配）。

// RepeatMultiplierTier 重复违规倍率阶梯中的一档：From 为第几次（>=2，第 1 次恒为 ×1），
// Multiplier 为该次起应用的倍率（>=1，可为小数）。
type RepeatMultiplierTier struct {
	From       int     `json:"from"`
	Multiplier float64 `json:"multiplier"`
}

type CreditScoreSetting struct {
	Enabled                    bool   `json:"enabled"`
	AutoFreezeEnabled          bool   `json:"auto_freeze_enabled"`
	FullScore                  int    `json:"full_score"`
	FreezeThreshold            int    `json:"freeze_threshold"`
	DeductionUpstreamViolation int    `json:"deduction_upstream_violation"`
	DeductionLocalKeyword      int    `json:"deduction_local_keyword"`
	ViolationMarkers           string `json:"violation_markers"`
	RepeatMultiplierEnabled    bool   `json:"repeat_multiplier_enabled"`
	// RepeatMultiplierTiers 24h 同类违规重复扣分倍率阶梯：occurrence 次命中时，取
	// from <= occurrence 中 from 最大的一档的倍率；低于最小 from 为 ×1，达到最后一档后
	// 一直沿用该档倍率。默认 [{2,2},{3,3}] 即原"第2次×2、第3次起×3封顶"。倍率可为小数，
	// 扣分点 = 基础分 × 倍率，乘积经 common.QuotaRound 四舍五入取整。
	RepeatMultiplierTiers []RepeatMultiplierTier `json:"repeat_multiplier_tiers"`
	MaxDailyDeduction     int                    `json:"max_daily_deduction"`
	RecoverEnabled        bool                   `json:"recover_enabled"`
	RecoverPerDay         int                    `json:"recover_per_day"`
	// 保证书主动恢复：用户完成保证书 +PledgePoints，冷却 PledgeCooldownDays 天。
	PledgePoints       int `json:"pledge_points"`
	PledgeCooldownDays int `json:"pledge_cooldown_days"`
	// 标记词 AI 自动学习：直连 OpenAI 兼容端点（base_url 可填站点自身地址实现套娃）。
	MarkerAnalysisEnabled bool   `json:"marker_analysis_enabled"`
	MarkerAnalysisBaseUrl string `json:"marker_analysis_base_url"`
	MarkerAnalysisApiKey  string `json:"marker_analysis_api_key"`
	MarkerAnalysisModel   string `json:"marker_analysis_model"`
	// 套娃内部 token：base_url 指向站点自身时，分析请求用此 token 调本站（token 挂 root、
	// allow_ips=127.0.0.1/::1、永不过期、额度不限），自己的 relay 按 token_key 识别为内部
	// 子请求，跳过敏感词检测/对话留存/扣分（分析内容本身含违规特征，不能被自己拦截）。
	MarkerAnalysisInternalToken string `json:"marker_analysis_internal_token"`
	MarkerAnalysisInternalGroup string `json:"marker_analysis_internal_group"`
	// 自动触发方式（只保留定量）：错误日志积压到 MarkerAnalysisThresholdCount 条才分析。
	// 未分析数 = 累计（距上次分析以来新增的错误日志，无 24h 窗口），几天没分析就累计几天。
	MarkerAnalysisThresholdEnabled bool `json:"marker_analysis_threshold_enabled"`
	MarkerAnalysisThresholdCount   int  `json:"marker_analysis_threshold_count"`
	// MarkerAnalysisRequestIntervalMS 每次分析请求之间的最小间隔（毫秒）。全量分析会连续
	// 逐批调用分析模型，自定义端点/上游可能限流（429），可配间隔降低请求频率；0=不限制。
	// 429/5xx 仍会按该间隔的指数退避自动重试。
	MarkerAnalysisRequestIntervalMS int `json:"marker_analysis_request_interval_ms"`
	// MarkerAnalysisWatermark 已处理到的错误日志最大 id（水位线）。触发检查/分析管道都按
	// `id > watermark` 取未分析日志，批处理每推进一批就写回一次。存 option（此结构体字段
	// 由 config 管理器序列化），不放在会按 30 天 TTL 清理的表里，重启后水位线仍准确。
	MarkerAnalysisWatermark int64 `json:"marker_analysis_watermark"`
	// MarkerAnalysisPrompt 发给分析模型的 system 提示词。可用 {messages} 占位符内嵌待分析
	// 错误消息（一批，--- 分隔）；不含该占位符时，消息会作为 user 消息追加。留空则用默认提示词。
	MarkerAnalysisPrompt string `json:"marker_analysis_prompt"`
}

// DefaultViolationMarkers 系统初始自带的违规标记词（设置页"重置"按钮恢复用）。
const DefaultViolationMarkers = "Failed check: SAFETY_CHECK_TYPE\n" +
	"Content violates usage guidelines\n" +
	"is sensitive\n" +
	"please check your input"

// DefaultMarkerAnalysisPrompt 标记词 AI 分析的默认 system 提示词（管理员可在设置页覆盖）。
// 让模型"宁可多报，不要漏报"（建议是给人工审核的候选），并从原文截取可子串匹配的标记词。
// {messages} 占位符在管道里替换为一批待分析错误消息（--- 分隔）。
const DefaultMarkerAnalysisPrompt = `# 角色
你是 AI 网关的风控标记词提取器。上游 LLM 的错误消息可能包含内容安全违规拒绝，
你的任务是尽可能找出所有疑似安全拒绝的消息，为人工审核提供候选。

人工审核员会逐条复核你的输出，所以：宁可多报，不要漏报。

# 判定标准

## 属于内容安全违规拒绝（要提取）
上游安全策略主动拦截了用户输入或生成内容，消息中通常包含：
- "安全/安全策略/安全准则"类表述
- "违规/有害/敏感/不当"类表述
- "违反政策/服务条款"类表述
- 明确拒绝回答且原因指向内容本身（非限流、非超时）

## 属于普通技术错误（不要提取）
- 限流：rate limit / 429 / too many requests / 配额
- 超时：timeout / 超时
- 鉴权：401 / 403 / unauthorized / API key
- 模型不存在：model not found
- 服务端错误：500 / 502 / 503 / internal server error
- 参数错误：bad request / invalid request

## 模糊情况——一律上报
- 消息同时包含技术错误码和安全拒绝表述 → 上报，审核员判断
- 消息被截断、不完整但疑似安全拒绝 → 上报
- 不确定是技术错误还是安全拒绝 → 上报

# 标记词提取规则

1. 从错误消息原文中截取一个连续片段，不翻译、不改写、不补全
2. 语言与原文一致（中文消息取中文片段，英文消息取英文片段）
3. 去掉首尾空白和标点
4. 长度 3–20 个字符
5. 选该消息中最能代表"安全拒绝"含义的短语，不要选过于通用的词

# 输出格式

只输出 JSON：

{
  "suggestions": [
    {
      "marker": "从原文截取的标记词",
      "example": "产出该 marker 的那条完整原始消息",
      "reason": "为什么疑似安全拒绝 + 为什么选这个词（1-2 句，给审核员看）"
    }
  ]
}

没有疑似违规时输出：{"suggestions":[]}

# 待分析的错误消息

以下是上游 LLM 返回的错误消息，每条用 --- 分隔：

{messages}`

// 默认配置。标记词按真实日志格式配：现有 violation_fee 的两个硬编码标记 +
// 用户实测的 "image is sensitive / please check your input" 格式。
var creditScoreSetting = CreditScoreSetting{
	Enabled:                    false,
	AutoFreezeEnabled:          true,
	FullScore:                  650,
	FreezeThreshold:            500,
	DeductionUpstreamViolation: 5,
	DeductionLocalKeyword:      1,
	ViolationMarkers:           DefaultViolationMarkers,
	RepeatMultiplierEnabled:    true,
	RepeatMultiplierTiers: []RepeatMultiplierTier{
		{From: 2, Multiplier: 2},
		{From: 3, Multiplier: 3},
	},
	MaxDailyDeduction:     50,
	RecoverEnabled:        true,
	RecoverPerDay:         5,
	PledgePoints:          10,
	PledgeCooldownDays:    7,
	MarkerAnalysisEnabled: false,
	// 定量默认关：管理员在设置页开启后，错误日志积压到阈值才自动分析。默认阈值 150。
	MarkerAnalysisThresholdEnabled: false,
	MarkerAnalysisThresholdCount:   150,
	// 默认每次分析请求间隔 1s（60 次/分），避免全量分析连续请求被上游限流；可按需调大。
	MarkerAnalysisRequestIntervalMS: 1000,
	MarkerAnalysisWatermark:         0,
	MarkerAnalysisPrompt:            DefaultMarkerAnalysisPrompt,
}

func init() {
	// 注册到全局配置管理器，key 前缀 = credit_score_setting
	config.GlobalConfig.Register("credit_score_setting", &creditScoreSetting)
}

func GetCreditScoreSetting() *CreditScoreSetting {
	return &creditScoreSetting
}

// IsFrozen 判断分数是否触发冻结（开关 + 阈值均生效）。
func (s *CreditScoreSetting) IsFrozen(score int) bool {
	if s == nil || !s.Enabled || !s.AutoFreezeEnabled {
		return false
	}
	if s.FreezeThreshold <= 0 {
		return false
	}
	return score < s.FreezeThreshold
}

// HasUpstreamViolationMarker 对上游错误文案做大小写不敏感子串匹配。
func (s *CreditScoreSetting) HasUpstreamViolationMarker(msg string) bool {
	return s.MatchedViolationMarker(msg) != ""
}

// MatchedViolationMarker 返回命中的第一个标记词（写入扣分日志 Reason）。
func (s *CreditScoreSetting) MatchedViolationMarker(msg string) string {
	if s == nil || msg == "" {
		return ""
	}
	lower := strings.ToLower(msg)
	for _, m := range splitViolationMarkerLines(s.ViolationMarkers) {
		if m != "" && strings.Contains(lower, m) {
			return m
		}
	}
	return ""
}

func splitViolationMarkerLines(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == '\n' || r == '\r'
	})
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, strings.ToLower(p))
		}
	}
	return out
}
