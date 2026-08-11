package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
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
	CodingPlanProviderVolcengine CodingPlanProvider = "volcengine" // 火山方舟(需 AK/SK 签名,暂未实现)
	// CodingPlanProviderDisabled 显式关闭余量监控的自定义渠道(手动/自定义模式默认值):
	// 即使 base_url 是套餐端点也不再自动绑定/探测,彻底不做监控。
	CodingPlanProviderDisabled CodingPlanProvider = "none"
)

// tier 名称:窗口标识,前端据此展示。
const (
	CodingPlanTierFiveHour    = "five_hour"
	CodingPlanTierWeeklyLimit = "weekly_limit"
)

var knownCodingPlanProviders = map[CodingPlanProvider]struct{}{
	CodingPlanProviderZhipu:      {},
	CodingPlanProviderZhipuEn:    {},
	CodingPlanProviderKimi:       {},
	CodingPlanProviderMiniMax:    {},
	CodingPlanProviderMiniMaxEn:  {},
	CodingPlanProviderZenMux:     {},
	CodingPlanProviderVolcengine: {},
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
	case CodingPlanProviderMiniMax, CodingPlanProviderMiniMaxEn:
		return queryCodingPlanMiniMax(ctx, provider, apiKey)
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
	tiers := make([]dto.CodingPlanTier, 0, 4)
	for i := range body.Limits {
		detail := &body.Limits[i].Detail
		limit := jsonNumF64(detail.Limit, 1.0)
		remaining := jsonNumF64(detail.Remaining, 0.0)
		tiers = append(tiers, dto.CodingPlanTier{
			Name:        CodingPlanTierFiveHour,
			Utilization: utilizationPercent(limit, remaining),
			ResetsAt:    jsonNumToRFC3339Ptr(detail.ResetTime),
		})
	}
	if usage := body.Usage; usage != nil {
		limit := jsonNumF64(usage.Limit, 1.0)
		remaining := jsonNumF64(usage.Remaining, 0.0)
		tiers = append(tiers, dto.CodingPlanTier{
			Name:        CodingPlanTierWeeklyLimit,
			Utilization: utilizationPercent(limit, remaining),
			ResetsAt:    jsonNumToRFC3339Ptr(usage.ResetTime),
		})
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
