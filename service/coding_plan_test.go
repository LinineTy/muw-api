package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// zhipuData 从 JSON 构造 zhipuQuotaData,用于 tier 解析测试。
func zhipuData(t *testing.T, jsonStr string) *zhipuQuotaData {
	t.Helper()
	var data zhipuQuotaData
	require.NoError(t, common.Unmarshal([]byte(jsonStr), &data))
	return &data
}

func zhipuTierNames(t *testing.T, data *zhipuQuotaData) []string {
	tiers := parseZhipuTokenTiers(data)
	names := make([]string, 0, len(tiers))
	for _, tier := range tiers {
		names = append(names, tier.Name)
	}
	return names
}

// ── 智谱 tier 解析 ──────────────────────────────────────────

func TestParseZhipuTokenTiersNewPlanTwoTiersByUnit(t *testing.T) {
	// 新套餐:两条 TOKENS_LIMIT,unit 显式区分 5 小时/每周,不依赖输入顺序。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "percentage": 53.0, "nextResetTime": 2000000000000, "unit": 6, "number": 7 },
			{ "type": "TOKENS_LIMIT", "percentage": 44.0, "nextResetTime": 1000000000000, "unit": 3, "number": 5 },
			{ "type": "TIME_LIMIT",   "percentage": 7.0 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 44.0, tiers[0].Utilization)
	assert.Equal(t, millisToRFC3339(1000000000000), *tiers[0].ResetsAt)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 53.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersOldPlanSingleTierFallsBackToFiveHour(t *testing.T) {
	// 老套餐(2026-02-12 前订阅):仅一条 TOKENS_LIMIT,无周限。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "percentage": 2.0, "nextResetTime": 1774967594803 },
			{ "type": "TIME_LIMIT", "percentage": 0.0 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 1)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 2.0, tiers[0].Utilization)
}

func TestParseZhipuTokenTiersNoTokenLimitsReturnsEmpty(t *testing.T) {
	data := zhipuData(t, `{ "limits": [{ "type": "TIME_LIMIT", "percentage": 5.0 }] }`)
	assert.Empty(t, parseZhipuTokenTiers(data))
}

func TestParseZhipuTokenTiersMissingResetTimeIsFiveHourWhenWeeklyHasReset(t *testing.T) {
	// 真实反馈:5 小时桶为 0% 时可能没有 nextResetTime;每周桶带 reset。
	// 这种形态不能按 reset 升序把每周桶误判为 five_hour。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "percentage": 25.0, "nextResetTime": 2000000000000 },
			{ "type": "TOKENS_LIMIT", "percentage": 0.0 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 0.0, tiers[0].Utilization)
	assert.Nil(t, tiers[0].ResetsAt)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 25.0, tiers[1].Utilization)
	assert.NotNil(t, tiers[1].ResetsAt)
}

func TestParseZhipuTokenTiersTypeIsCaseInsensitive(t *testing.T) {
	data := zhipuData(t, `{
		"limits": [
			{ "type": "tokens_limit", "percentage": 12.0, "nextResetTime": 1000000000000 },
			{ "type": "Tokens_Limit", "percentage": 34.0, "nextResetTime": 2000000000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 12.0, tiers[0].Utilization)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 34.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersInvalidPercentageFallsBackToZero(t *testing.T) {
	// percentage 为字符串或 null 时按 0 处理(仍展示 tier,但用量为 0),不崩溃。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "percentage": "invalid", "nextResetTime": 1000000000000 },
			{ "type": "TOKENS_LIMIT", "percentage": null,      "nextResetTime": 2000000000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, 0.0, tiers[0].Utilization)
	assert.Equal(t, 0.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersExtremePercentagePassesThrough(t *testing.T) {
	// 负数/超 100 不做范围裁剪,下游渲染层负责显示策略。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "percentage": -5.0,  "nextResetTime": 1000000000000 },
			{ "type": "TOKENS_LIMIT", "percentage": 150.0, "nextResetTime": 2000000000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, -5.0, tiers[0].Utilization)
	assert.Equal(t, 150.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersUnitOverridesResetOrderWhenWeeklyResetsSooner(t *testing.T) {
	// 真实案例(cc-switch issue #3036):每周周期末尾,周桶比 5 小时桶更早重置。
	// 5h 用 1%(约 5h 后重置)、每周用 42%(约 1h 后重置)。unit 字段须优先,否则标反。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "unit": 6, "number": 7, "percentage": 42.0, "nextResetTime": 1000003600000 },
			{ "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 1.0,  "nextResetTime": 1000018000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 1.0, tiers[0].Utilization)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 42.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersWeeklyUnitSixNumberOneVariant(t *testing.T) {
	// z.ai 也观测过 (unit:6, number:1) 表示每周窗口,分类只看 unit,不看 number。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 30.0, "nextResetTime": 1000000000000 },
			{ "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 10.0, "nextResetTime": 2000000000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 10.0, tiers[0].Utilization)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 30.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersPartialUnitFillsRemainingSlot(t *testing.T) {
	// 只有周桶带 unit 时,缺 unit 的另一条应填入 five_hour 槽位。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "unit": 6, "number": 7, "percentage": 42.0, "nextResetTime": 1000000000000 },
			{ "type": "TOKENS_LIMIT", "percentage": 1.0, "nextResetTime": 2000000000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 1.0, tiers[0].Utilization)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 42.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersUnknownUnitFallsBackToResetOrder(t *testing.T) {
	// 未识别的 unit 枚举值不猜语义,整体回落重置时间启发式。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "unit": 9, "percentage": 44.0, "nextResetTime": 1000000000000 },
			{ "type": "TOKENS_LIMIT", "unit": 9, "percentage": 53.0, "nextResetTime": 2000000000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 44.0, tiers[0].Utilization)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 53.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersDuplicateUnitFillsOtherSlot(t *testing.T) {
	// 防御性:两条都标成 5 小时窗(上游异常)时,第一条占 five_hour,
	// 第二条降级走兜底填入 weekly,保证不丢数据也不 panic。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 10.0, "nextResetTime": 1000000000000 },
			{ "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 20.0, "nextResetTime": 2000000000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 10.0, tiers[0].Utilization)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 20.0, tiers[1].Utilization)
}

func TestParseZhipuTokenTiersMoreThanTwoKeepsFirstTwo(t *testing.T) {
	// 智谱当前最多两条 TOKENS_LIMIT,多余的丢弃。
	data := zhipuData(t, `{
		"limits": [
			{ "type": "TOKENS_LIMIT", "percentage": 1.0, "nextResetTime": 1000000000000 },
			{ "type": "TOKENS_LIMIT", "percentage": 2.0, "nextResetTime": 2000000000000 },
			{ "type": "TOKENS_LIMIT", "percentage": 3.0, "nextResetTime": 3000000000000 }
		]
	}`)
	tiers := parseZhipuTokenTiers(data)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
}

// ── 智谱整体响应 ─────────────────────────────────────────────

func TestZhipuQuotaFromBodyBusinessError(t *testing.T) {
	// HTTP 200 + success:false + msg → 业务错误,透出文案。
	body := `{ "code": 1001, "msg": "Authentication parameter not received in Header", "success": false }`
	var resp zhipuQuotaResponse
	require.NoError(t, common.Unmarshal([]byte(body), &resp))
	quota := zhipuQuotaFromBody(&resp)
	assert.False(t, quota.Success)
	assert.Contains(t, quota.Error, "Authentication parameter not received")
}

func TestZhipuQuotaFromBodyMissingData(t *testing.T) {
	body := `{ "success": true }`
	var resp zhipuQuotaResponse
	require.NoError(t, common.Unmarshal([]byte(body), &resp))
	quota := zhipuQuotaFromBody(&resp)
	assert.False(t, quota.Success)
	assert.Contains(t, quota.Error, "Missing 'data'")
}

func TestZhipuQuotaFromBodyLevelAndTiers(t *testing.T) {
	body := `{
		"success": true,
		"data": {
			"level": "max",
			"limits": [
				{ "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 26.0 },
				{ "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 5.0 }
			]
		}
	}`
	var resp zhipuQuotaResponse
	require.NoError(t, common.Unmarshal([]byte(body), &resp))
	quota := zhipuQuotaFromBody(&resp)
	assert.True(t, quota.Success)
	assert.Equal(t, "max", quota.Level)
	require.Len(t, quota.Tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, quota.Tiers[0].Name)
	assert.Equal(t, 26.0, quota.Tiers[0].Utilization)
	assert.Equal(t, CodingPlanTierWeeklyLimit, quota.Tiers[1].Name)
	assert.Equal(t, 5.0, quota.Tiers[1].Utilization)
}

// ── Kimi tier 解析 ──────────────────────────────────────────

func TestParseKimiTiersFiveHourAndWeekly(t *testing.T) {
	body := `{
		"limits": [
			{ "detail": { "limit": 100, "remaining": 10, "resetTime": 1000000000000 } },
			{ "detail": { "limit": 200, "remaining": 50, "resetTime": 2000000000000 } }
		],
		"usage": { "limit": 1000, "remaining": 300, "resetTime": 3000000000000 }
	}`
	var resp kimiUsageResponse
	require.NoError(t, common.Unmarshal([]byte(body), &resp))
	tiers := parseKimiTiers(&resp)
	require.Len(t, tiers, 3)
	// (100-10)/100*100 = 90%
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 90.0, tiers[0].Utilization)
	// 原始数值:limit=100, remaining=10, used=90
	assert.Equal(t, int64(100), tiers[0].Limit)
	assert.Equal(t, int64(10), tiers[0].Remaining)
	assert.Equal(t, int64(90), tiers[0].Used)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[1].Name)
	assert.Equal(t, 75.0, tiers[1].Utilization)
	assert.Equal(t, int64(200), tiers[1].Limit)
	assert.Equal(t, int64(150), tiers[1].Used)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[2].Name)
	assert.Equal(t, 70.0, tiers[2].Utilization)
	assert.Equal(t, int64(1000), tiers[2].Limit)
	assert.Equal(t, int64(300), tiers[2].Remaining)
	assert.Equal(t, int64(700), tiers[2].Used)
	assert.Equal(t, millisToRFC3339(3000000000000), *tiers[2].ResetsAt)
}

func TestParseKimiTiersEmptyBody(t *testing.T) {
	var resp kimiUsageResponse
	require.NoError(t, common.Unmarshal([]byte(`{}`), &resp))
	assert.Empty(t, parseKimiTiers(&resp))
}

// ── MiniMax tier 解析 ───────────────────────────────────────

func minimaxData(t *testing.T, jsonStr string) *minimaxUsageResponse {
	t.Helper()
	var resp minimaxUsageResponse
	require.NoError(t, common.Unmarshal([]byte(jsonStr), &resp))
	return &resp
}

func TestParseMiniMaxTiersGeneralTwoTiersFromRemainingPercent(t *testing.T) {
	// 主路径:general 桶 5h 剩 98% / weekly 剩 95% → 已用 2% / 5%。
	body := minimaxData(t, `{
		"model_remains": [
			{
				"model_name": "general",
				"current_interval_remaining_percent": 98.0,
				"current_weekly_remaining_percent": 95.0,
				"current_interval_status": 1,
				"current_weekly_status": 1,
				"end_time": 1780329600000,
				"weekly_end_time": 1780848000000
			},
			{
				"model_name": "video",
				"current_interval_remaining_percent": 100.0,
				"current_weekly_remaining_percent": 100.0
			}
		],
		"base_resp": { "status_code": 0, "status_msg": "success" }
	}`)
	tiers := parseMiniMaxTiers(body)
	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 2.0, tiers[0].Utilization)
	assert.NotNil(t, tiers[0].ResetsAt)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, 5.0, tiers[1].Utilization)
	assert.NotNil(t, tiers[1].ResetsAt)
}

func TestParseMiniMaxTiersSkipsVideoFindsGeneralAnyPosition(t *testing.T) {
	// video 排前面时仍应定位到 general。
	body := minimaxData(t, `{
		"model_remains": [
			{
				"model_name": "video",
				"current_interval_remaining_percent": 50.0,
				"current_weekly_remaining_percent": 50.0
			},
			{
				"model_name": "general",
				"current_interval_remaining_percent": 80.0,
				"current_weekly_remaining_percent": 70.0,
				"current_interval_status": 1,
				"current_weekly_status": 1
			}
		]
	}`)
	tiers := parseMiniMaxTiers(body)
	require.Len(t, tiers, 2)
	assert.Equal(t, 20.0, tiers[0].Utilization)
	assert.Equal(t, 30.0, tiers[1].Utilization)
}

func TestParseMiniMaxTiersMissingGeneralReturnsEmpty(t *testing.T) {
	body := minimaxData(t, `{
		"model_remains": [
			{
				"model_name": "video",
				"current_interval_remaining_percent": 100.0,
				"current_weekly_remaining_percent": 100.0
			}
		]
	}`)
	assert.Empty(t, parseMiniMaxTiers(body))
	assert.Empty(t, parseMiniMaxTiers(minimaxData(t, `{ "model_remains": [] }`)))
	assert.Empty(t, parseMiniMaxTiers(minimaxData(t, `{}`)))
}

func TestParseMiniMaxTiersWeeklyStatusNotOneSkipsWeeklyTier(t *testing.T) {
	// status != 1 表示周桶未激活(如无周限额套餐的 3),不展示假周桶。
	body := minimaxData(t, `{
		"model_remains": [{
			"model_name": "general",
			"current_interval_remaining_percent": 99,
			"current_weekly_remaining_percent": 100,
			"current_weekly_status": 3,
			"end_time": 1780347600000
		}]
	}`)
	tiers := parseMiniMaxTiers(body)
	require.Len(t, tiers, 1)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, 1.0, tiers[0].Utilization)
	assert.NotNil(t, tiers[0].ResetsAt)
}

func TestParseMiniMaxTiersNegativePercentPassesThrough(t *testing.T) {
	body := minimaxData(t, `{
		"model_remains": [{
			"model_name": "general",
			"current_interval_remaining_percent": -5.0,
			"current_weekly_remaining_percent": 150.0,
			"current_interval_status": 1,
			"current_weekly_status": 1
		}]
	}`)
	tiers := parseMiniMaxTiers(body)
	require.Len(t, tiers, 2)
	assert.Equal(t, 105.0, tiers[0].Utilization)
	assert.Equal(t, -50.0, tiers[1].Utilization)
}

// ── 厂商探测 ─────────────────────────────────────────────────

func TestDetectCodingPlanProvider(t *testing.T) {
	cases := []struct {
		baseURL  string
		expected CodingPlanProvider
		ok       bool
	}{
		{"https://open.bigmodel.cn/api/paas/v4", CodingPlanProviderZhipu, true},
		{"https://open.bigmodel.cn/api/anthropic", CodingPlanProviderZhipu, true},
		{"https://api.z.ai/api/paas/v4", CodingPlanProviderZhipuEn, true},
		{"https://api.kimi.com/coding/v1", CodingPlanProviderKimi, true},
		{"https://api.minimaxi.com/v1", CodingPlanProviderMiniMax, true},
		{"https://api.minimax.io/v1", CodingPlanProviderMiniMaxEn, true},
		{"https://zenmux.com/proxy", CodingPlanProviderZenMux, true},
		{"https://ark.cn-beijing.volces.com/api/coding", CodingPlanProviderVolcengine, true},
		// 上游 ChannelSpecialBases 的符号键(base_url 直接填这些)。
		{"glm-coding-plan", CodingPlanProviderZhipu, true},
		{"glm-coding-plan-international", CodingPlanProviderZhipuEn, true},
		{"kimi-coding-plan", CodingPlanProviderKimi, true},
		{"minimax-coding-plan", CodingPlanProviderMiniMax, true},
		{"minimax-coding-plan-international", CodingPlanProviderMiniMaxEn, true},
		{"doubao-coding-plan", CodingPlanProviderVolcengine, true},
		{"https://example.com/some-proxy", "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		got, ok := DetectCodingPlanProvider(tc.baseURL)
		assert.Equal(t, tc.ok, ok, "url=%s", tc.baseURL)
		if tc.ok {
			assert.Equal(t, tc.expected, got, "url=%s", tc.baseURL)
		}
	}
}

func TestCodingPlanProviderFromChannelType(t *testing.T) {
	cases := []struct {
		channelType int
		expected    CodingPlanProvider
		ok          bool
	}{
		{constant.ChannelTypeZhipu_v4, CodingPlanProviderZhipu, true},
		{constant.ChannelTypeMoonshot, CodingPlanProviderKimi, true},
		{constant.ChannelTypeMiniMax, CodingPlanProviderMiniMax, true},
		{constant.ChannelTypeVolcEngine, CodingPlanProviderVolcengine, true},
		{constant.ChannelTypeOpenAI, "", false},
		{0, "", false},
	}
	for _, tc := range cases {
		got, ok := CodingPlanProviderFromChannelType(tc.channelType)
		assert.Equal(t, tc.ok, ok, "type=%d", tc.channelType)
		if tc.ok {
			assert.Equal(t, tc.expected, got, "type=%d", tc.channelType)
		}
	}
}

func TestIsKnownCodingPlanProvider(t *testing.T) {
	assert.True(t, IsKnownCodingPlanProvider("zhipu"))
	assert.True(t, IsKnownCodingPlanProvider("zhipu_en"))
	assert.True(t, IsKnownCodingPlanProvider("kimi"))
	assert.False(t, IsKnownCodingPlanProvider("banana"))
	assert.False(t, IsKnownCodingPlanProvider(""))
}

// ── 智谱完整 HTTP 请求链路 ─────────────────────────────────

// TestQueryCodingPlanZhipuAt locks the critical contract:
//   - path is /api/monitor/usage/quota/limit
//   - Authorization header carries the raw api key, WITHOUT a Bearer prefix
//   - a valid body parses into level + tiers
func TestQueryCodingPlanZhipuAt(t *testing.T) {
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	var gotAuth, gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"success": true,
			"data": {
				"level": "max",
				"limits": [
					{ "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 26.0 },
					{ "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 5.0 }
				]
			}
		}`))
	}))
	defer server.Close()

	quota, err := queryCodingPlanZhipuAt(context.Background(), server.URL, "zhipu-secret-key")
	require.NoError(t, err, "2xx + 合法 body 应成功")
	require.NotNil(t, quota)
	assert.Equal(t, "/api/monitor/usage/quota/limit", gotPath, "quota 端点路径不对")
	assert.Equal(t, "zhipu-secret-key", gotAuth, "智谱 Authorization 必须是不带 Bearer 前缀的裸 key")
	assert.True(t, quota.Success)
	assert.Equal(t, "max", quota.Level)
	require.Len(t, quota.Tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, quota.Tiers[0].Name)
	assert.Equal(t, CodingPlanTierWeeklyLimit, quota.Tiers[1].Name)
}

func TestQueryCodingPlanZhipuAtAuthFailure(t *testing.T) {
	InitHttpClient()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	quota, err := queryCodingPlanZhipuAt(context.Background(), server.URL, "bad-key")
	require.NoError(t, err, "鉴权失败是确定性失败,必须保持 Ok(success:false)")
	require.NotNil(t, quota)
	assert.False(t, quota.Success)
	assert.Contains(t, quota.Error, "Authentication failed (HTTP 401)")
}
