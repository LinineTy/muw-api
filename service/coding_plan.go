package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
)

// ── 编码套餐厂商 ──────────────────────────────────────────────

// CodingPlanProvider 编码套餐余量查询的厂商标识。
type CodingPlanProvider string

const (
	CodingPlanProviderZhipu      CodingPlanProvider = "zhipu"      // 国内站 open.bigmodel.cn
	CodingPlanProviderZhipuEn    CodingPlanProvider = "zhipu_en"   // 国际站 api.z.ai
	CodingPlanProviderKimi       CodingPlanProvider = "kimi"       // Kimi For Coding
	CodingPlanProviderMiniMax    CodingPlanProvider = "minimax"    // MiniMax 国内 api.minimaxi.com
	CodingPlanProviderMiniMaxEn  CodingPlanProvider = "minimax_en" // MiniMax 国际 api.minimax.io
	CodingPlanProviderZenMux     CodingPlanProvider = "zenmux"
	CodingPlanProviderVolcengine CodingPlanProvider = "volcengine"
	CodingPlanProviderOpenRouter CodingPlanProvider = "openrouter" // 火山方舟(需 AK/SK 签名,暂未实现)
	// CodingPlanProviderCommandCode Command Code(commandcode.ai)。GOAT/Pro/Max 等订阅套餐
	// 按 credits 计费,三档窗口 = 任意 5 小时 / 任意 7 天 / 每月。
	CodingPlanProviderCommandCode CodingPlanProvider = "commandcode"
	// CodingPlanProviderDisabled 显式关闭余量监控的自定义渠道(手动/自定义模式默认值):
	// 即使 base_url 是套餐端点也不再自动绑定/探测,彻底不做监控。
	CodingPlanProviderDisabled CodingPlanProvider = "none"
)

// tier 名称:窗口标识,前端据此展示。
const (
	CodingPlanTierFiveHour     = "five_hour"
	CodingPlanTierWeeklyLimit  = "weekly_limit"
	CodingPlanTierMonthlyLimit = "monthly_limit"
	CodingPlanTierDailyLimit   = "daily_limit"
)

var knownCodingPlanProviders = map[CodingPlanProvider]struct{}{
	CodingPlanProviderZhipu:       {},
	CodingPlanProviderZhipuEn:     {},
	CodingPlanProviderKimi:        {},
	CodingPlanProviderMiniMax:     {},
	CodingPlanProviderMiniMaxEn:   {},
	CodingPlanProviderZenMux:      {},
	CodingPlanProviderOpenRouter:  {},
	CodingPlanProviderVolcengine:  {},
	CodingPlanProviderCommandCode: {},
}

// IsKnownCodingPlanProvider 判断 provider 是否在已知厂商集合内。
func IsKnownCodingPlanProvider(provider string) bool {
	_, ok := knownCodingPlanProviders[CodingPlanProvider(strings.TrimSpace(provider))]
	return ok
}

// DetectCodingPlanProvider 按 base_url 探测厂商(对齐 cc-switch detect_provider)。
// 除真实 host 外,也识别上游 ChannelSpecialBases 的符号键(glm-coding-plan 等),
// 这些是编码套餐渠道在 base_url 里填的专用端点标识。
func DetectCodingPlanProvider(baseUrl string) (CodingPlanProvider, bool) {
	url := strings.ToLower(strings.TrimSpace(baseUrl))
	switch url {
	case "glm-coding-plan":
		return CodingPlanProviderZhipu, true
	case "glm-coding-plan-international":
		return CodingPlanProviderZhipuEn, true
	case "kimi-coding-plan":
		return CodingPlanProviderKimi, true
	case "minimax-coding-plan":
		return CodingPlanProviderMiniMax, true
	case "minimax-coding-plan-international":
		return CodingPlanProviderMiniMaxEn, true
	case "doubao-coding-plan":
		return CodingPlanProviderVolcengine, true
	}
	switch {
	case strings.Contains(url, "api.kimi.com/coding"):
		return CodingPlanProviderKimi, true
	case strings.Contains(url, "bigmodel.cn"):
		return CodingPlanProviderZhipu, true
	case strings.Contains(url, "api.z.ai"):
		return CodingPlanProviderZhipuEn, true
	case strings.Contains(url, "api.minimaxi.com"):
		return CodingPlanProviderMiniMax, true
	case strings.Contains(url, "api.minimax.io"):
		return CodingPlanProviderMiniMaxEn, true
	case strings.Contains(url, "zenmux"):
		return CodingPlanProviderZenMux, true
	case strings.Contains(url, "volces.com/api/coding"):
		return CodingPlanProviderVolcengine, true
	// commandcode.ai 的推理端点是 api.commandcode.ai/provider[/v1](OpenAI 与 Anthropic
	// 两套都在同一 host 下),base_url 里认域名即可。
	case strings.Contains(url, "commandcode.ai"):
		return CodingPlanProviderCommandCode, true
	default:
		return "", false
	}
}

// CodingPlanProviderFromChannelType 按渠道类型给出对应的套餐厂商(渠道未显式配置
// 厂商时的默认建议)。只映射当前有效的类型:智谱v4→zhipu、Moonshot→kimi、
// MiniMax→minimax、火山→volcengine。
func CodingPlanProviderFromChannelType(channelType int) (CodingPlanProvider, bool) {
	switch channelType {
	case constant.ChannelTypeZhipu_v4:
		return CodingPlanProviderZhipu, true
	case constant.ChannelTypeMoonshot:
		return CodingPlanProviderKimi, true
	case constant.ChannelTypeMiniMax:
		return CodingPlanProviderMiniMax, true
	case constant.ChannelTypeVolcEngine:
		return CodingPlanProviderVolcengine, true
	default:
		return "", false
	}
}

// ResolveChannelCodingPlanProvider 解析渠道的编码套餐厂商,优先级:
//  1. 渠道显式配置的 CodingPlanProvider(权威,覆盖聚合前置场景);"none" 表示显式
//     关闭余量监控(手动/自定义渠道),即使 base_url 是套餐端点也不再自动绑定。
//  2. 按 base_url 探测(含上游 ChannelSpecialBases 符号键,如 glm-coding-plan)
//  3. 按渠道类型给出默认(智谱v4→zhipu、Moonshot→kimi、MiniMax→minimax、火山→volcengine)
func ResolveChannelCodingPlanProvider(channel *model.Channel) (CodingPlanProvider, error) {
	if channel.CodingPlanProvider != nil {
		p := strings.TrimSpace(*channel.CodingPlanProvider)
		if p == string(CodingPlanProviderDisabled) {
			return "", errors.New("coding plan monitoring is disabled for this channel")
		}
		if p != "" {
			if IsKnownCodingPlanProvider(p) {
				return CodingPlanProvider(p), nil
			}
			return "", fmt.Errorf("unsupported coding plan provider: %s", p)
		}
	}
	// 2026-09-10 定：监控开关只认显式配置（渠道/账户上的「开监控 + 厂商」），
	// base_url 探测与渠道类型映射不再替用户做决定——探测结果只用于表单预填
	// （前端 detectCodingPlanProvider 与 DetectCodingPlanProvider 同源）。
	return "", errors.New("coding plan quota is not enabled for this channel (set coding_plan_provider)")
}

// ResolveAccountCodingPlanProvider 账户版套餐厂商解析（凭证与渠道解耦后配置在
// 账户上），优先级与渠道版一致：显式 provider > base_url 探测 > 类型映射。
func ResolveAccountCodingPlanProvider(account *model.Account) (CodingPlanProvider, error) {
	// 只认显式配置（账户上的「开监控 + 厂商」），不做 base_url/渠道类型猜测——余量查询
	// 地址永远是所选厂商的官方地址，绝不从 base_url 反推（中转地址打官方接口必失败）。
	if account.CodingPlanProvider == nil {
		return "", errors.New("coding plan quota is not enabled for this account (set coding_plan_provider)")
	}
	p := strings.TrimSpace(*account.CodingPlanProvider)
	if p == string(CodingPlanProviderDisabled) {
		return "", errors.New("coding plan monitoring is disabled for this account")
	}
	if p == "" {
		return "", errors.New("coding plan quota is not enabled for this account (set coding_plan_provider)")
	}
	if !IsKnownCodingPlanProvider(p) {
		return "", fmt.Errorf("unsupported coding plan provider: %s", p)
	}
	return CodingPlanProvider(p), nil
}

// ── 编码套餐自动启停(按余量)────────────────────────────────────

// 自动禁用/恢复写进渠道 other_info.status_reason 的原因标记,恢复只认本任务禁用过
// 的渠道(status_reason == CodingPlanExhaustedReason),不碰手动禁用与 relay 错误禁用。
const (
	CodingPlanExhaustedReason = "coding plan quota exhausted"
	CodingPlanRecoveredReason = "coding plan quota recovered"

	codingPlanAutoControlDefaultDisableThreshold = 98 // 用量 ≥ 该值(%)禁用
	codingPlanAutoControlDefaultEnableThreshold  = 90 // 用量 < 该值(%)恢复
)

// CodingPlanAutoControlAction 单渠道本轮自动启停处置。
type CodingPlanAutoControlAction int

const (
	CodingPlanAutoControlNone CodingPlanAutoControlAction = iota
	CodingPlanAutoControlDisable
	CodingPlanAutoControlEnable
)

// CodingPlanEffectiveUtilization 计算编码套餐的有效已用百分比 = 各窗口 tier 的最大值
// (任一窗口近耗尽即计划不可用),clamp 到 [0,100]。查询确定性失败(Success=false)或
// quota 为空时返回负值,调用方应视为不可信、本轮不做任何处置。
func CodingPlanEffectiveUtilization(quota *dto.CodingPlanQuota) float64 {
	if quota == nil || !quota.Success {
		return -1
	}
	var max float64
	for _, tier := range quota.Tiers {
		if tier.Utilization > max {
			max = tier.Utilization
		}
	}
	if max < 0 {
		return 0
	}
	if max > 100 {
		return 100
	}
	return max
}

// CodingPlanAccountAutoControlThresholds 账户版阈值读取（凭证与渠道解耦后配置在
// 账户上），默认值与钳制规则与渠道版一致。
func CodingPlanAccountAutoControlThresholds(account *model.Account) (disable, enable int) {
	disable = codingPlanAutoControlDefaultDisableThreshold
	if account != nil && account.CodingPlanDisableThreshold != nil {
		if v := *account.CodingPlanDisableThreshold; v >= 1 && v <= 100 {
			disable = v
		}
	}
	enable = codingPlanAutoControlDefaultEnableThreshold
	if account != nil && account.CodingPlanEnableThreshold != nil {
		if v := *account.CodingPlanEnableThreshold; v >= 0 && v < disable {
			enable = v
		}
	}
	if enable >= disable {
		enable = disable - 1
		if enable < 0 {
			enable = 0
		}
	}
	return disable, enable
}

// decideCodingPlanAutoControl 判定单个渠道本轮应执行的自动启停动作。
//   - Enabled 且有效用量 ≥ 禁用阈值 → 禁用;
//   - AutoDisabled 且确由本任务禁用(status_reason == CodingPlanExhaustedReason)
//     且有效用量 < 恢复阈值 → 恢复;
//   - 其余(手动禁用、其它原因自动禁用、用量未达阈值)一律不动。
//
// utilization < 0(查询不可信)直接返回 None。
func decideCodingPlanAutoControl(status int, statusReason string, utilization float64, disableThreshold, enableThreshold int) CodingPlanAutoControlAction {
	if utilization < 0 {
		return CodingPlanAutoControlNone
	}
	switch status {
	case common.ChannelStatusEnabled:
		if utilization >= float64(disableThreshold) {
			return CodingPlanAutoControlDisable
		}
	case common.ChannelStatusAutoDisabled:
		if statusReason == CodingPlanExhaustedReason && utilization < float64(enableThreshold) {
			return CodingPlanAutoControlEnable
		}
	}
	return CodingPlanAutoControlNone
}

// ── 查询入口 ─────────────────────────────────────────────────

const codingPlanHTTPTimeout = 15 * time.Second

// QueryCodingPlanQuota 查询编码套餐余量。
// 确定性失败(未知厂商/鉴权失败/非 2xx/业务错误/解析失败)返回 success=false 的 quota;
// 瞬时传输失败(网络/超时/读体中断)返回 error,调用方按瞬时处理。
func QueryCodingPlanQuota(ctx context.Context, provider CodingPlanProvider, apiKey string) (*dto.CodingPlanQuota, error) {
	if !IsKnownCodingPlanProvider(string(provider)) {
		return failedCodingPlanQuota("Unknown coding plan provider"), nil
	}
	switch provider {
	case CodingPlanProviderZhipu, CodingPlanProviderZhipuEn:
		return queryCodingPlanZhipu(ctx, provider, apiKey)
	case CodingPlanProviderKimi:
		return queryCodingPlanKimi(ctx, apiKey)
	case CodingPlanProviderOpenRouter:
		return queryCodingPlanOpenRouter(ctx, apiKey)
	case CodingPlanProviderMiniMax, CodingPlanProviderMiniMaxEn:
		return queryCodingPlanMiniMax(ctx, provider, apiKey)
	case CodingPlanProviderCommandCode:
		return queryCodingPlanCommandCode(ctx, apiKey)
	case CodingPlanProviderVolcengine:
		return failedCodingPlanQuota("Volcengine coding plan quota is not implemented yet"), nil
	case CodingPlanProviderZenMux:
		return failedCodingPlanQuota("ZenMux coding plan quota is not implemented yet"), nil
	}
	return failedCodingPlanQuota("Unsupported coding plan provider"), nil
}

// codingPlanGet 发起 GET 并读取完整响应体。
// 读体失败(超时/连接中断)是瞬时 → 返回 error;拿到完整响应体后解析失败才是确定性。
func codingPlanGet(ctx context.Context, url string, setHeaders func(*http.Request)) (int, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, codingPlanHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", "application/json")
	if setHeaders != nil {
		setHeaders(req)
	}
	resp, err := GetHttpClient().Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, body, nil
}

// ── 通用 helper ──────────────────────────────────────────────

func failedCodingPlanQuota(msg string) *dto.CodingPlanQuota {
	return &dto.CodingPlanQuota{Success: false, Error: msg, QueriedAt: time.Now().UnixMilli()}
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func millisToRFC3339(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func orDefault(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// ── 智谱 GLM Coding Plan ─────────────────────────────────────
//
// 端点: GET {host}/api/monitor/usage/quota/limit,国内站 open.bigmodel.cn 与国际站
// api.z.ai 共用同一 path。认证: Authorization: <api_key>,智谱不加 Bearer 前缀。
// 响应: {success, data:{level, limits:[{type, percentage, nextResetTime, unit, number}]}},
// 业务错误走 HTTP 200 + success:false。
// 参考实现: cc-switch services_coding_plan.rs + z.ai 官方 @z_ai/coding-helper。

type zhipuQuotaResponse struct {
	Success bool            `json:"success"`
	Msg     string          `json:"msg"`
	Data    *zhipuQuotaData `json:"data"`
}

type zhipuQuotaData struct {
	Level  string           `json:"level"`
	Limits []zhipuLimitItem `json:"limits"`
}

type zhipuLimitItem struct {
	Type          string          `json:"type"`
	Percentage    json.RawMessage `json:"percentage"`
	NextResetTime json.RawMessage `json:"nextResetTime"`
	Unit          json.RawMessage `json:"unit"`
	Number        json.RawMessage `json:"number"`
}

// zhipuWindow 智谱 TOKENS_LIMIT 条目按 unit 字段的显式窗口分类。
type zhipuWindow int

const (
	zhipuWindowUnknown zhipuWindow = iota
	zhipuWindowFiveHour
	zhipuWindowWeekly
)

// classifyZhipuWindow 按 unit 字段判定 TOKENS_LIMIT 条目所属窗口。实测形态:
// - unit:3 → 5 小时滚动窗口(老/新套餐均有)
// - unit:6 → 每周窗口(unit:6 与 number 取值不绑定)
// unit 缺失或值不认识返回 Unknown,由调用方走重置时间启发式兜底。
func classifyZhipuWindow(unit int64) zhipuWindow {
	switch unit {
	case 3:
		return zhipuWindowFiveHour
	case 6:
		return zhipuWindowWeekly
	default:
		return zhipuWindowUnknown
	}
}

type zhipuTierEntry struct {
	resetTime  int64 // -1 表示缺失/非法
	percentage float64
	resetISO   *string
}

// parseZhipuTokenTiers 把智谱 data 里的 limits[] 解析成 tier 列表。
// 分类优先级:
//  1. 显式字段 unit 标识窗口类型(见 classifyZhipuWindow)。不能按 nextResetTime 排序
//     代替——周期末尾每周窗口会比 5 小时窗口更早重置(cc-switch issue #3036),时间
//     排序在该场景必然把两桶标反。
//  2. 兜底启发式:无 nextResetTime 的条目优先归 five_hour(5 小时桶在 0% 等状态下
//     可能没有 reset),其余按 reset 升序依次填入仍空缺的槽位。
func parseZhipuTokenTiers(data *zhipuQuotaData) []dto.CodingPlanTier {
	var fiveHour *zhipuTierEntry
	var weekly *zhipuTierEntry
	var unclassified []zhipuTierEntry

	for i := range data.Limits {
		item := &data.Limits[i]
		if !strings.EqualFold(item.Type, "TOKENS_LIMIT") {
			continue
		}
		entry := zhipuTierEntry{resetTime: -1, percentage: rawJSONFloat(item.Percentage, 0.0)}
		if resetMs := rawJSONInt(item.NextResetTime, -1); resetMs > 0 {
			entry.resetTime = resetMs
			iso := millisToRFC3339(resetMs)
			entry.resetISO = &iso
		}
		switch classifyZhipuWindow(rawJSONInt(item.Unit, 0)) {
		case zhipuWindowFiveHour:
			if fiveHour == nil {
				fiveHour = &entry
			} else {
				unclassified = append(unclassified, entry)
			}
		case zhipuWindowWeekly:
			if weekly == nil {
				weekly = &entry
			} else {
				unclassified = append(unclassified, entry)
			}
		default:
			unclassified = append(unclassified, entry)
		}
	}

	// 兜底:无 reset 的优先 five_hour,其余按 reset 升序填槽。
	sort.SliceStable(unclassified, func(i, j int) bool {
		ei, ej := unclassified[i], unclassified[j]
		if ei.resetTime == -1 && ej.resetTime != -1 {
			return true
		}
		if ei.resetTime != -1 && ej.resetTime == -1 {
			return false
		}
		return ei.resetTime < ej.resetTime
	})
	for _, e := range unclassified {
		if fiveHour == nil {
			fiveHour = &e
		} else if weekly == nil {
			weekly = &e
		}
		// 智谱当前最多两条 TOKENS_LIMIT,多余的忽略
	}

	tiers := make([]dto.CodingPlanTier, 0, 2)
	for _, slot := range []struct {
		name string
		e    *zhipuTierEntry
	}{{CodingPlanTierFiveHour, fiveHour}, {CodingPlanTierWeeklyLimit, weekly}} {
		if slot.e != nil {
			tiers = append(tiers, dto.CodingPlanTier{
				Name:        slot.name,
				Utilization: slot.e.percentage,
				ResetsAt:    slot.e.resetISO,
			})
		}
	}
	return tiers
}

func zhipuQuotaFromBody(body *zhipuQuotaResponse) *dto.CodingPlanQuota {
	if !body.Success {
		return failedCodingPlanQuota("API error: " + orDefault(body.Msg, "Unknown error"))
	}
	if body.Data == nil {
		return failedCodingPlanQuota("Missing 'data' field in response")
	}
	return &dto.CodingPlanQuota{
		Success:   true,
		Level:     body.Data.Level,
		Tiers:     parseZhipuTokenTiers(body.Data),
		QueriedAt: nowMillis(),
	}
}

func queryCodingPlanZhipu(ctx context.Context, provider CodingPlanProvider, apiKey string) (*dto.CodingPlanQuota, error) {
	host := "https://open.bigmodel.cn"
	if provider == CodingPlanProviderZhipuEn {
		host = "https://api.z.ai"
	}
	return queryCodingPlanZhipuAt(ctx, host, apiKey)
}

// queryCodingPlanZhipuAt 向指定 host 的 quota 端点查询(拆出 host 便于用本地 server 测试请求形状)。
func queryCodingPlanZhipuAt(ctx context.Context, host string, apiKey string) (*dto.CodingPlanQuota, error) {
	url := host + "/api/monitor/usage/quota/limit"

	statusCode, raw, err := codingPlanGet(ctx, url, func(req *http.Request) {
		req.Header.Set("Authorization", apiKey) // 智谱不加 Bearer 前缀
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept-Language", "en-US,en")
	})
	if err != nil {
		return nil, err
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return failedCodingPlanQuota(fmt.Sprintf("Authentication failed (HTTP %d)", statusCode)), nil
	}
	if statusCode < 200 || statusCode >= 300 {
		return failedCodingPlanQuota(fmt.Sprintf("API error (HTTP %d): %s", statusCode, truncateStr(string(raw), 300))), nil
	}
	var body zhipuQuotaResponse
	if err := common.Unmarshal(raw, &body); err != nil {
		return failedCodingPlanQuota(fmt.Sprintf("Failed to parse response: %s", err.Error())), nil
	}
	return zhipuQuotaFromBody(&body), nil
}

// ── Kimi For Coding ──────────────────────────────────────────

// 端点: GET https://api.kimi.com/coding/v1/usages,Bearer 认证。
// 响应 limits[].detail 为 5 小时窗口,usage 为每周限额。

type kimiLimitDetail struct {
	Limit     json.Number `json:"limit"`
	Remaining json.Number `json:"remaining"`
	ResetTime json.Number `json:"resetTime"`
}

type kimiUsageResponse struct {
	Limits []struct {
		Detail kimiLimitDetail `json:"detail"`
	} `json:"limits"`
	Usage *kimiLimitDetail `json:"usage"`
}

// parseKimiTiers 把 Kimi usages 响应解析成 tier 列表。
func parseKimiTiers(body *kimiUsageResponse) []dto.CodingPlanTier {
	mk := func(name string, detail *kimiLimitDetail) dto.CodingPlanTier {
		limitF := jsonNumF64(detail.Limit, 1.0)
		remainingF := jsonNumF64(detail.Remaining, 0.0)
		tier := dto.CodingPlanTier{
			Name:        name,
			Utilization: utilizationPercent(limitF, remainingF),
			ResetsAt:    jsonNumToRFC3339Ptr(detail.ResetTime),
			Limit:       jsonNumF64(detail.Limit, 0),
			Remaining:   jsonNumF64(detail.Remaining, 0),
		}
		// 原始数值仅在 limit 有效时给出;used 下限 0,避免上游异常导致负值。
		if tier.Limit > 0 {
			tier.Used = tier.Limit - tier.Remaining
			if tier.Used < 0 {
				tier.Used = 0
			}
		}
		return tier
	}

	tiers := make([]dto.CodingPlanTier, 0, 4)
	for i := range body.Limits {
		tiers = append(tiers, mk(CodingPlanTierFiveHour, &body.Limits[i].Detail))
	}
	if usage := body.Usage; usage != nil {
		tiers = append(tiers, mk(CodingPlanTierWeeklyLimit, usage))
	}
	return tiers
}

func queryCodingPlanKimi(ctx context.Context, apiKey string) (*dto.CodingPlanQuota, error) {
	const url = "https://api.kimi.com/coding/v1/usages"
	statusCode, raw, err := codingPlanGet(ctx, url, func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	})
	if err != nil {
		return nil, err
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return failedCodingPlanQuota(fmt.Sprintf("Authentication failed (HTTP %d)", statusCode)), nil
	}
	if statusCode < 200 || statusCode >= 300 {
		return failedCodingPlanQuota(fmt.Sprintf("API error (HTTP %d): %s", statusCode, truncateStr(string(raw), 300))), nil
	}
	var body kimiUsageResponse
	if err := common.Unmarshal(raw, &body); err != nil {
		return failedCodingPlanQuota(fmt.Sprintf("Failed to parse response: %s", err.Error())), nil
	}
	return &dto.CodingPlanQuota{
		Success:   true,
		Tiers:     parseKimiTiers(&body),
		QueriedAt: nowMillis(),
	}, nil
}

// ── MiniMax Coding Plan ──────────────────────────────────────

// 端点: GET https://api.minimaxi.com|io/v1/api/openplatform/coding_plan/remains,
// Bearer 认证。响应 model_remains 里 model_name == "general" 的条目是编程套餐。
// 新接口语义: current_*_remaining_percent 是"剩余百分比",反转为已用百分比;
// 周桶仅当 current_weekly_status == 1 时激活(无周限额套餐该字段为 3,不展示)。

type minimaxModelRemain struct {
	ModelName                       string      `json:"model_name"`
	CurrentIntervalRemainingPercent json.Number `json:"current_interval_remaining_percent"`
	CurrentWeeklyRemainingPercent   json.Number `json:"current_weekly_remaining_percent"`
	CurrentIntervalStatus           int64       `json:"current_interval_status"`
	CurrentWeeklyStatus             int64       `json:"current_weekly_status"`
	EndTime                         int64       `json:"end_time"`
	WeeklyEndTime                   int64       `json:"weekly_end_time"`
}

type minimaxUsageResponse struct {
	BaseResp struct {
		StatusCode int    `json:"status_code"`
		StatusMsg  string `json:"status_msg"`
	} `json:"base_resp"`
	ModelRemains []minimaxModelRemain `json:"model_remains"`
}

// parseMiniMaxTiers 从 /coding_plan/remains 响应中解析 MiniMax 编程套餐的 tier。
func parseMiniMaxTiers(body *minimaxUsageResponse) []dto.CodingPlanTier {
	var item *minimaxModelRemain
	for i := range body.ModelRemains {
		if body.ModelRemains[i].ModelName == "general" {
			item = &body.ModelRemains[i]
			break
		}
	}
	if item == nil {
		return nil
	}

	tiers := make([]dto.CodingPlanTier, 0, 2)
	tiers = append(tiers, dto.CodingPlanTier{
		Name:        CodingPlanTierFiveHour,
		Utilization: remainingToUsedPercent(jsonNumF64(item.CurrentIntervalRemainingPercent, 0)),
		ResetsAt:    millisToRFC3339Ptr(item.EndTime),
	})
	if item.CurrentWeeklyStatus == 1 {
		tiers = append(tiers, dto.CodingPlanTier{
			Name:        CodingPlanTierWeeklyLimit,
			Utilization: remainingToUsedPercent(jsonNumF64(item.CurrentWeeklyRemainingPercent, 0)),
			ResetsAt:    millisToRFC3339Ptr(item.WeeklyEndTime),
		})
	}
	return tiers
}

func queryCodingPlanMiniMax(ctx context.Context, provider CodingPlanProvider, apiKey string) (*dto.CodingPlanQuota, error) {
	domain := "api.minimaxi.com"
	if provider == CodingPlanProviderMiniMaxEn {
		domain = "api.minimax.io"
	}
	url := "https://" + domain + "/v1/api/openplatform/coding_plan/remains"

	statusCode, raw, err := codingPlanGet(ctx, url, func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", "application/json")
	})
	if err != nil {
		return nil, err
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return failedCodingPlanQuota(fmt.Sprintf("Authentication failed (HTTP %d)", statusCode)), nil
	}
	if statusCode < 200 || statusCode >= 300 {
		return failedCodingPlanQuota(fmt.Sprintf("API error (HTTP %d): %s", statusCode, truncateStr(string(raw), 300))), nil
	}
	var body minimaxUsageResponse
	if err := common.Unmarshal(raw, &body); err != nil {
		return failedCodingPlanQuota(fmt.Sprintf("Failed to parse response: %s", err.Error())), nil
	}
	if body.BaseResp.StatusCode != 0 {
		return failedCodingPlanQuota(fmt.Sprintf("API error (code %d): %s", body.BaseResp.StatusCode, orDefault(body.BaseResp.StatusMsg, "Unknown error"))), nil
	}
	return &dto.CodingPlanQuota{
		Success:   true,
		Tiers:     parseMiniMaxTiers(&body),
		QueriedAt: nowMillis(),
	}, nil
}

// ── Command Code (commandcode.ai) ────────────────────────────

// 端点(官方 CLI 里用到的路由;/alpha/whoami 正是它校验 API key 的那条接口):
//
//	GET https://api.commandcode.ai/alpha/whoami?limits=1
//	GET https://api.commandcode.ai/alpha/billing/credits
//	GET https://api.commandcode.ai/alpha/billing/subscriptions
//
// 鉴权:Authorization: Bearer <API key —— 与推理共用同一把>。
//
// 口径(2026-09-21 实测 GOAT 套餐):
//   - 额度单位是 credits,绝大多数模型 1 credit = $1
//   - 三档窗口:任意 5 小时 / 任意 7 天 / 每月(官方 Usage Limits 页)
//   - credits 响应只给 5 小时与周窗口的 used/cap/resetAt(另有 limited/exceeded 标记);
//     月度窗口要自己算:上限 = 套餐月额度(planId 查表),已用 = 上限 - credits.monthlyCredits,
//     重置时间取订阅的 currentPeriodEnd
//   - 额外充值额度(purchasedCredits/freeCredits)不受窗口限制,本卡不展示
//
// 与其它厂商不同:套餐等级与月度重置时间只在 subscriptions 里,所以这里要打两个接口;
// 订阅查不到只影响月度窗口,不影响本次查询成败。
const (
	commandCodeAPIHost           = "https://api.commandcode.ai"
	commandCodeWhoamiPath        = "/alpha/whoami"
	commandCodeCreditsPath       = "/alpha/billing/credits"
	commandCodeSubscriptionsPath = "/alpha/billing/subscriptions"
)

// commandCodePlanMonthlyCredits 套餐 → 每月额度(credits)。取自官方 CLI 内置表
// (command-code dist/cli.mjs 的 PLAN_TOTAL_CREDITS);未知套餐不出月度窗口。
var commandCodePlanMonthlyCredits = map[string]float64{
	"individual-go":       10,
	"individual-goat":     70,
	"individual-pro":      30,
	"individual-pro-v1":   80,
	"individual-provider": 15,
	"individual-max":      150,
	"individual-ultra":    300,
	"teams-pro":           40,
}

// commandCodePlanLabels 套餐 → 展示名(余量卡上的等级徽标),同样取自官方 CLI。
var commandCodePlanLabels = map[string]string{
	"individual-go":       "Go",
	"individual-goat":     "GOAT",
	"individual-pro":      "Pro",
	"individual-pro-v1":   "Pro",
	"individual-provider": "Provider",
	"individual-max":      "Max",
	"individual-ultra":    "Ultra",
	"teams-pro":           "Teams Pro",
}

type commandCodeCredits struct {
	MonthlyCredits   json.Number `json:"monthlyCredits"`
	PurchasedCredits json.Number `json:"purchasedCredits"`
	FreeCredits      json.Number `json:"freeCredits"`
}

type commandCodeWindow struct {
	Used    json.Number `json:"used"`
	Cap     json.Number `json:"cap"`
	ResetAt json.Number `json:"resetAt"`
}

type commandCodeWindowLimits struct {
	FiveHour *commandCodeWindow `json:"fiveHour"`
	Weekly   *commandCodeWindow `json:"weekly"`
}

type commandCodeCreditsResponse struct {
	Credits      *commandCodeCredits      `json:"credits"`
	WindowLimits *commandCodeWindowLimits `json:"windowLimits"`
}

type commandCodeWhoamiResponse struct {
	Org *struct {
		ID string `json:"id"`
	} `json:"org"`
}

type commandCodeSubscriptionResponse struct {
	Data *struct {
		PlanID           string `json:"planId"`
		Status           string `json:"status"`
		CurrentPeriodEnd string `json:"currentPeriodEnd"`
	} `json:"data"`
}

// parseCommandCodeTiers 组装三档窗口;缺哪一档就不出哪一档。
// 额度是小数 credits,照原样下发(DTO 自 2026-09-21 起是小数,前端按 2 位小数展示)。
func parseCommandCodeTiers(body *commandCodeCreditsResponse, planID string, periodEnd string) []dto.CodingPlanTier {
	if body == nil || body.Credits == nil {
		return nil
	}
	tiers := make([]dto.CodingPlanTier, 0, 3)

	appendWindow := func(name string, w *commandCodeWindow) {
		if w == nil {
			return
		}
		capacity := jsonNumF64(w.Cap, 0)
		used := jsonNumF64(w.Used, 0)
		if capacity <= 0 || used < 0 {
			return
		}
		remaining := capacity - used
		if remaining < 0 {
			remaining = 0
		}
		tiers = append(tiers, dto.CodingPlanTier{
			Name:        name,
			Utilization: utilizationPercent(capacity, remaining),
			ResetsAt:    millisToRFC3339Ptr(jsonNumInt64(w.ResetAt, 0)),
			Limit:       capacity,
			Remaining:   remaining,
			Used:        capacity - remaining,
		})
	}
	if body.WindowLimits != nil {
		appendWindow(CodingPlanTierFiveHour, body.WindowLimits.FiveHour)
		appendWindow(CodingPlanTierWeeklyLimit, body.WindowLimits.Weekly)
	}

	// 月度窗口:上游不给,用套餐月额度 + 剩余 monthlyCredits 反推。
	if capacity, ok := commandCodePlanMonthlyCredits[strings.TrimSpace(planID)]; ok && capacity > 0 {
		remaining := jsonNumF64(body.Credits.MonthlyCredits, 0)
		if remaining < 0 {
			remaining = 0
		}
		if remaining > capacity {
			// 促销加成 / 额外额度不计入本窗口,按满额处理
			remaining = capacity
		}
		tier := dto.CodingPlanTier{
			Name:        CodingPlanTierMonthlyLimit,
			Utilization: utilizationPercent(capacity, remaining),
			Limit:       capacity,
			Remaining:   remaining,
			Used:        capacity - remaining,
		}
		if iso := strings.TrimSpace(periodEnd); iso != "" {
			tier.ResetsAt = &iso
		}
		tiers = append(tiers, tier)
	}
	return tiers
}

// commandCodeExtraCredits 窗口外额度(额外购买 + 赠送的 credits)。两者都为 0 时返回 nil
// ——「有额外额度」才有展示价值,平时别在卡上多挂一行 0。
func commandCodeExtraCredits(body *commandCodeCreditsResponse) *dto.CodingPlanExtraCredits {
	if body == nil || body.Credits == nil {
		return nil
	}
	purchased := jsonNumF64(body.Credits.PurchasedCredits, 0)
	free := jsonNumF64(body.Credits.FreeCredits, 0)
	if purchased <= 0 && free <= 0 {
		return nil
	}
	if purchased < 0 {
		purchased = 0
	}
	if free < 0 {
		free = 0
	}
	return &dto.CodingPlanExtraCredits{Purchased: purchased, Free: free}
}

// commandCodeFetch 打一个 /alpha 接口并做统一错误映射:
// 瞬时错误(网络/超时/读体中断)返回 err;确定性失败返回 failed(此时 raw 为 nil)。
func commandCodeFetch(ctx context.Context, host, path, apiKey string) ([]byte, *dto.CodingPlanQuota, error) {
	statusCode, raw, err := codingPlanGet(ctx, host+path, func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", "application/json")
	})
	if err != nil {
		return nil, nil, err
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return nil, failedCodingPlanQuota(fmt.Sprintf("Authentication failed (HTTP %d)", statusCode)), nil
	}
	if statusCode < 200 || statusCode >= 300 {
		return nil, failedCodingPlanQuota(fmt.Sprintf("API error (HTTP %d): %s", statusCode, truncateStr(string(raw), 300))), nil
	}
	return raw, nil, nil
}

func queryCodingPlanCommandCode(ctx context.Context, apiKey string) (*dto.CodingPlanQuota, error) {
	return queryCodingPlanCommandCodeAt(ctx, commandCodeAPIHost, apiKey)
}

// queryCodingPlanCommandCodeAt 拆出 host 便于用本地 server 测试请求形状。
func queryCodingPlanCommandCodeAt(ctx context.Context, host string, apiKey string) (*dto.CodingPlanQuota, error) {
	// 1) whoami:有组织时额度按 orgId 查(官方 CLI 同款行为,个人号 org 为 null)
	rawWhoami, failed, err := commandCodeFetch(ctx, host, commandCodeWhoamiPath+"?limits=1", apiKey)
	if err != nil || failed != nil {
		return failed, err
	}
	var whoami commandCodeWhoamiResponse
	if err := common.Unmarshal(rawWhoami, &whoami); err != nil {
		return failedCodingPlanQuota(fmt.Sprintf("Failed to parse response: %s", err.Error())), nil
	}
	orgID := ""
	if whoami.Org != nil {
		orgID = strings.TrimSpace(whoami.Org.ID)
	}
	scoped := func(path string) string {
		if orgID == "" {
			return path
		}
		return path + "?orgId=" + url.QueryEscape(orgID)
	}

	// 2) 额度与三档窗口
	rawCredits, failed, err := commandCodeFetch(ctx, host, scoped(commandCodeCreditsPath), apiKey)
	if err != nil || failed != nil {
		return failed, err
	}
	var body commandCodeCreditsResponse
	if err := common.Unmarshal(rawCredits, &body); err != nil {
		return failedCodingPlanQuota(fmt.Sprintf("Failed to parse response: %s", err.Error())), nil
	}
	if body.Credits == nil {
		return failedCodingPlanQuota("Missing 'credits' field in response"), nil
	}

	// 3) 订阅:只补套餐等级与月度重置时间,查不到就不出月度窗口(不影响本次成败)
	planID, periodEnd := "", ""
	if rawSubs, failedSubs, errSubs := commandCodeFetch(ctx, host, scoped(commandCodeSubscriptionsPath), apiKey); errSubs == nil && failedSubs == nil {
		var subs commandCodeSubscriptionResponse
		if common.Unmarshal(rawSubs, &subs) == nil && subs.Data != nil &&
			strings.EqualFold(strings.TrimSpace(subs.Data.Status), "active") {
			planID = strings.TrimSpace(subs.Data.PlanID)
			periodEnd = strings.TrimSpace(subs.Data.CurrentPeriodEnd)
		}
	}

	level := strings.TrimSpace(planID)
	if label, ok := commandCodePlanLabels[level]; ok {
		level = label
	}
	return &dto.CodingPlanQuota{
		Success:   true,
		Level:     level,
		Tiers:     parseCommandCodeTiers(&body, planID, periodEnd),
		Extra:     commandCodeExtraCredits(&body),
		QueriedAt: nowMillis(),
	}, nil
}

// ── 数值解析 helper ──────────────────────────────────────────

// rawJSONFloat 解析 json.RawMessage 为 f64,兼容数字、字符串(如 "100")与 null;
// 缺失/非法回落 fallback。
func rawJSONFloat(raw json.RawMessage, fallback float64) float64 {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return fallback
	}
	if trimmed[0] == '"' {
		var s string
		if common.Unmarshal(trimmed, &s) == nil {
			if f, err := strconv.ParseFloat(s, 64); err == nil {
				return f
			}
		}
		return fallback
	}
	var f float64
	if common.Unmarshal(trimmed, &f) == nil {
		return f
	}
	return fallback
}

// rawJSONInt 解析 json.RawMessage 为 int64,兼容数字、字符串与 null;
// 缺失/非法回落 fallback。
func rawJSONInt(raw json.RawMessage, fallback int64) int64 {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return fallback
	}
	if trimmed[0] == '"' {
		var s string
		if common.Unmarshal(trimmed, &s) == nil {
			if n, err := strconv.ParseInt(s, 10, 64); err == nil {
				return n
			}
		}
		return fallback
	}
	var n int64
	if common.Unmarshal(trimmed, &n) == nil {
		return n
	}
	return fallback
}

// jsonNumF64 解析 json.Number,缺失/非法时回落 fallback。
func jsonNumF64(n json.Number, fallback float64) float64 {
	if f, err := n.Float64(); err == nil {
		return f
	}
	return fallback
}

// jsonNumInt64 解析 json.Number 为 int64,缺失/非法时回落 fallback。
func jsonNumInt64(n json.Number, fallback int64) int64 {
	if v, err := n.Int64(); err == nil {
		return v
	}
	return fallback
}

// utilizationPercent 已用百分比 = (limit - remaining) / limit * 100,下限 0。
func utilizationPercent(limit, remaining float64) float64 {
	used := limit - remaining
	if used < 0 {
		used = 0
	}
	if limit <= 0 {
		return 0
	}
	return used / limit * 100
}

// remainingToUsedPercent 剩余百分比 → 已用百分比。
func remainingToUsedPercent(remainingPercent float64) float64 {
	return 100 - remainingPercent
}

// jsonNumToRFC3339Ptr 把秒/毫秒时间戳数值转 RFC3339;非法/缺失返回 nil。
func jsonNumToRFC3339Ptr(n json.Number) *string {
	v, err := n.Int64()
	if err != nil || v <= 0 {
		return nil
	}
	iso := millisToRFC3339(v)
	return &iso
}

// millisToRFC3339Ptr 毫秒时间戳转 RFC3339;<=0 返回 nil。
func millisToRFC3339Ptr(ms int64) *string {
	if ms <= 0 {
		return nil
	}
	iso := millisToRFC3339(ms)
	return &iso
}

// ── OpenRouter 免费档 (:free) ────────────────────────────────

// 端点: GET https://openrouter.ai/api/v1/key,Bearer 认证。
// 只取 free_model_daily_requests —— 免费模型($0/token)的日额度。
// 口径要点(2026-09-19 实测):
//   - 全免费模型**共用一个桶**,不是每个模型各一份;UTC 日界重置
//   - 档位由账号「历史累计充值」决定:<$10 → 50/天,≥$10 → 1000/天;RPM 固定 20
//   - 免费模型不消耗 credit ⇒ 账户余额与本窗口无关,本窗口只看「次数」
//   - 官方有 ~60s 缓存,刚发出的请求不会立刻反映到 used
//
// 另:key 级花费上限(即便设成 $0.001)不会拦免费模型,可放心用它锁死「只跑免费」。
type openRouterKeyResponse struct {
	Data struct {
		IsFreeTier     bool    `json:"is_free_tier"`
		Limit          float64 `json:"limit"`
		LimitRemaining float64 `json:"limit_remaining"`
		Usage          float64 `json:"usage"`
		FreeModelDaily struct {
			Used      int64 `json:"used"`
			Limit     int64 `json:"limit"`
			Remaining int64 `json:"remaining"`
		} `json:"free_model_daily_requests"`
	} `json:"data"`
}

func queryCodingPlanOpenRouter(ctx context.Context, apiKey string) (*dto.CodingPlanQuota, error) {
	const url = "https://openrouter.ai/api/v1/key"
	statusCode, raw, err := codingPlanGet(ctx, url, func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	})
	if err != nil {
		return nil, err
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return failedCodingPlanQuota(fmt.Sprintf("Authentication failed (HTTP %d)", statusCode)), nil
	}
	if statusCode < 200 || statusCode >= 300 {
		return failedCodingPlanQuota(fmt.Sprintf("API error (HTTP %d): %s", statusCode, truncateStr(string(raw), 300))), nil
	}
	var body openRouterKeyResponse
	if err := common.Unmarshal(raw, &body); err != nil {
		return failedCodingPlanQuota(fmt.Sprintf("Failed to parse response: %s", err.Error())), nil
	}

	return openRouterQuotaFromBody(&body), nil
}

// openRouterQuotaFromBody 把 /api/v1/key 响应映射成通用余量结构。
func openRouterQuotaFromBody(body *openRouterKeyResponse) *dto.CodingPlanQuota {
	free := body.Data.FreeModelDaily
	tier := dto.CodingPlanTier{
		Name:        CodingPlanTierDailyLimit,
		Utilization: utilizationPercent(float64(free.Limit), float64(free.Remaining)),
		ResetsAt:    openRouterDailyResetAt(),
	}
	// 仅在额度有效时下发原始值(前端有原始值就优先按 已用/总量 展示,否则回退百分比)。
	if free.Limit > 0 {
		tier.Limit = float64(free.Limit)
		tier.Remaining = float64(free.Remaining)
		tier.Used = float64(free.Used)
		if tier.Used < 0 {
			tier.Used = 0
		}
	}

	// is_free_tier=false ⇒ 账号买过 credits ⇒ 已进 1000/天 档。
	level := "free tier (50/day)"
	if !body.Data.IsFreeTier {
		level = "$10+ lifetime credits (1000/day)"
	}
	return &dto.CodingPlanQuota{
		Success:   true,
		Level:     level,
		Tiers:     []dto.CodingPlanTier{tier},
		QueriedAt: nowMillis(),
	}
}

// openRouterDailyResetAt 下一个 UTC 零点(RFC3339) —— 免费额度的重置时刻。
func openRouterDailyResetAt() *string {
	next := time.Now().UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	s := next.Format(time.RFC3339)
	return &s
}
