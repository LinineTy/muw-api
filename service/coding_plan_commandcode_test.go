package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 真实响应样本（2026-09-21 实测 GOAT 个人版），只保留本功能用到的字段。
const commandCodeCreditsSample = `{
  "credits": {
    "belowThreshold": false,
    "creditThreshold": 0,
    "monthlyCredits": 69.929046866,
    "purchasedCredits": 0,
    "freeCredits": 0
  },
  "windowLimits": {
    "limited": true,
    "exceeded": null,
    "fiveHour": { "used": 0.070953134, "cap": 14, "exceeded": false, "resetAt": 1790003105447 },
    "weekly": { "used": 0.070953134, "cap": 35, "exceeded": false, "resetAt": 1790589905447 }
  }
}`

const commandCodeWhoamiSample = `{
  "success": true,
  "user": { "id": "d4301f75-aedf-4cc7-8431-225b9dd90693", "userName": "aiyaodada" },
  "org": null
}`

const commandCodeSubscriptionSample = `{
  "success": true,
  "data": {
    "id": "sub_1UI1xQDSZgxV3MJKGDUU2Jpc",
    "status": "active",
    "orgId": null,
    "currentPeriodStart": "2026-09-21T07:47:30.000Z",
    "currentPeriodEnd": "2026-10-21T07:47:30.000Z",
    "planId": "individual-goat"
  }
}`

// commandCodeBody 从 JSON 构造 commandCodeCreditsResponse。
func commandCodeBody(t *testing.T, jsonStr string) *commandCodeCreditsResponse {
	t.Helper()
	var body commandCodeCreditsResponse
	require.NoError(t, common.Unmarshal([]byte(jsonStr), &body))
	return &body
}

// provider 已注册进已知集合（否则 QueryCodingPlanQuota 直接返回 Unknown）。
func TestCommandCodeProviderRegistered(t *testing.T) {
	assert.True(t, IsKnownCodingPlanProvider("commandcode"))
	assert.True(t, IsKnownCodingPlanProvider(" commandcode "), "两端空白应被 trim")
}

// base_url 探测：推理端点在 api.commandcode.ai 下（OpenAI 与 Anthropic 两套同 host）。
func TestDetectCodingPlanProviderCommandCode(t *testing.T) {
	for _, baseURL := range []string{
		"https://api.commandcode.ai/provider",
		"https://api.commandcode.ai/provider/v1",
		"https://api.commandcode.ai/provider/v1/messages",
		"https://API.CommandCode.ai/provider",
	} {
		provider, ok := DetectCodingPlanProvider(baseURL)
		require.True(t, ok, baseURL)
		assert.Equal(t, CodingPlanProviderCommandCode, provider, baseURL)
	}
	_, ok := DetectCodingPlanProvider("https://api.example.com/v1")
	assert.False(t, ok, "普通 OpenAI 兼容中转不该被认成 Command Code")
}

// 实测样本：三档窗口齐全（5 小时 / 每周 / 每月），月度由套餐表 + remaining 反推。
func TestParseCommandCodeTiersRealGoatShape(t *testing.T) {
	body := commandCodeBody(t, commandCodeCreditsSample)
	tiers := parseCommandCodeTiers(body, "individual-goat", "2026-10-21T07:47:30.000Z")

	require.Len(t, tiers, 3)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
	assert.Equal(t, CodingPlanTierMonthlyLimit, tiers[2].Name)

	// 5 小时：$14 窗口，已用 0.070953134 credits
	assert.Equal(t, int64(14), tiers[0].Limit)
	assert.Equal(t, int64(14), tiers[0].Remaining)
	assert.Equal(t, int64(0), tiers[0].Used)
	assert.InDelta(t, 0.5068081, tiers[0].Utilization, 1e-6)
	require.NotNil(t, tiers[0].ResetsAt)
	assert.Contains(t, *tiers[0].ResetsAt, "2026-09-21")

	// 每周：$35 窗口
	assert.Equal(t, int64(35), tiers[1].Limit)
	assert.InDelta(t, 0.20272324, tiers[1].Utilization, 1e-6)
	require.NotNil(t, tiers[1].ResetsAt)
	assert.Contains(t, *tiers[1].ResetsAt, "2026-09-28")

	// 每月：GOAT 月额度 $70，剩余 69.929（重置时间取订阅 currentPeriodEnd）
	assert.Equal(t, int64(70), tiers[2].Limit)
	assert.InDelta(t, 0.10136162, tiers[2].Utilization, 1e-6)
	require.NotNil(t, tiers[2].ResetsAt)
	assert.Equal(t, "2026-10-21T07:47:30.000Z", *tiers[2].ResetsAt)
}

// 套餐不在内置表里：不出月度窗口，但 5 小时 / 周窗口照出。
func TestParseCommandCodeTiersUnknownPlanSkipsMonthly(t *testing.T) {
	body := commandCodeBody(t, commandCodeCreditsSample)
	tiers := parseCommandCodeTiers(body, "individual-mystery", "2026-10-21T07:47:30.000Z")

	require.Len(t, tiers, 2)
	assert.Equal(t, CodingPlanTierFiveHour, tiers[0].Name)
	assert.Equal(t, CodingPlanTierWeeklyLimit, tiers[1].Name)
}

// 上游只给 credits（没有 windowLimits）：只剩月度窗口。
func TestParseCommandCodeTiersMissingWindowLimits(t *testing.T) {
	body := commandCodeBody(t, `{
	  "credits": { "monthlyCredits": 35, "purchasedCredits": 0, "freeCredits": 0 }
	}`)
	tiers := parseCommandCodeTiers(body, "individual-goat", "")

	require.Len(t, tiers, 1)
	assert.Equal(t, CodingPlanTierMonthlyLimit, tiers[0].Name)
	assert.Equal(t, int64(70), tiers[0].Limit)
	assert.Equal(t, int64(35), tiers[0].Remaining)
	assert.InDelta(t, 50, tiers[0].Utilization, 1e-6)
	assert.Nil(t, tiers[0].ResetsAt, "没有 currentPeriodEnd 时不给重置时间")
}

// 缺 credits 字段（响应形状变了）：不出任何窗口，由调用方按失败处理。
func TestParseCommandCodeTiersMissingCredits(t *testing.T) {
	assert.Empty(t, parseCommandCodeTiers(commandCodeBody(t, `{}`), "individual-goat", ""))
	assert.Empty(t, parseCommandCodeTiers(nil, "individual-goat", ""))
}

// 窗口用超了（used > cap）：剩余夹到 0，已用量顶到窗口上限（前端 clamp 显示 100%）。
func TestParseCommandCodeTiersExceededWindowClampsRemaining(t *testing.T) {
	body := commandCodeBody(t, `{
	  "credits": { "monthlyCredits": 0 },
	  "windowLimits": {
	    "fiveHour": { "used": 20, "cap": 14, "exceeded": true, "resetAt": 1790003105447 }
	  }
	}`)
	tiers := parseCommandCodeTiers(body, "individual-goat", "")

	require.Len(t, tiers, 2)
	assert.Equal(t, int64(0), tiers[0].Remaining)
	assert.Equal(t, int64(14), tiers[0].Used)
	assert.InDelta(t, 100, tiers[0].Utilization, 1e-4)
	// 月度 0/70 已用满
	assert.Equal(t, int64(0), tiers[1].Remaining)
	assert.InDelta(t, 100, tiers[1].Utilization, 1e-6)
}

// 促销加成的 credits 超过套餐额度时按满额处理，不出现负的已用。
func TestParseCommandCodeTiersBoostedCreditsClampedToCap(t *testing.T) {
	body := commandCodeBody(t, `{
	  "credits": { "monthlyCredits": 120, "purchasedCredits": 50, "freeCredits": 10 }
	}`)
	tiers := parseCommandCodeTiers(body, "individual-goat", "")

	require.Len(t, tiers, 1)
	assert.Equal(t, int64(70), tiers[0].Remaining)
	assert.Equal(t, int64(0), tiers[0].Used)
	assert.InDelta(t, 0, tiers[0].Utilization, 1e-6)
}

// cap 缺失/为 0 的窗口直接跳过，不产出空窗口。
func TestParseCommandCodeTiersSkipsWindowWithoutCap(t *testing.T) {
	body := commandCodeBody(t, `{
	  "credits": { "monthlyCredits": 70 },
	  "windowLimits": { "fiveHour": { "used": 1, "resetAt": 1790003105447 } }
	}`)
	tiers := parseCommandCodeTiers(body, "individual-goat", "")

	require.Len(t, tiers, 1)
	assert.Equal(t, CodingPlanTierMonthlyLimit, tiers[0].Name)
}

// 个人号（org 为 null）：三个接口都不带 orgId，Authorization 用 Bearer。
func TestQueryCodingPlanCommandCodeAtRequestsPersonalScope(t *testing.T) {
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer cmd-api-key", r.Header.Get("Authorization"))
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case commandCodeWhoamiPath:
			assert.Equal(t, "1", r.URL.Query().Get("limits"))
			_, _ = w.Write([]byte(commandCodeWhoamiSample))
		case commandCodeCreditsPath:
			assert.Empty(t, r.URL.Query().Get("orgId"))
			_, _ = w.Write([]byte(commandCodeCreditsSample))
		case commandCodeSubscriptionsPath:
			_, _ = w.Write([]byte(commandCodeSubscriptionSample))
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	quota, err := queryCodingPlanCommandCodeAt(context.Background(), server.URL, "cmd-api-key")
	require.NoError(t, err)
	require.True(t, quota.Success, quota.Error)
	assert.Equal(t, "GOAT", quota.Level)
	require.Len(t, quota.Tiers, 3)
	assert.Greater(t, quota.QueriedAt, int64(0))
	assert.Equal(t, []string{
		"/alpha/whoami?limits=1",
		"/alpha/billing/credits?",
		"/alpha/billing/subscriptions?",
	}, paths)
}

// 团队号（whoami 带 org）：额度查询带上 orgId。
func TestQueryCodingPlanCommandCodeAtRequestsOrgScope(t *testing.T) {
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	var creditsQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case commandCodeWhoamiPath:
			_, _ = w.Write([]byte(`{"success":true,"org":{"id":"org_abc 123"}}`))
		case commandCodeCreditsPath:
			creditsQuery = r.URL.RawQuery
			_, _ = w.Write([]byte(commandCodeCreditsSample))
		case commandCodeSubscriptionsPath:
			assert.Equal(t, "orgId=org_abc+123", r.URL.RawQuery)
			_, _ = w.Write([]byte(commandCodeSubscriptionSample))
		}
	}))
	defer server.Close()

	quota, err := queryCodingPlanCommandCodeAt(context.Background(), server.URL, "cmd-api-key")
	require.NoError(t, err)
	require.True(t, quota.Success, quota.Error)
	assert.Equal(t, "orgId=org_abc+123", creditsQuery)
}

// 鉴权失败：确定性失败（success=false），不是瞬时错误。
func TestQueryCodingPlanCommandCodeAtAuthFailure(t *testing.T) {
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"UNAUTHORIZED","status":401,` +
			`"message":"Invalid 'Authorization' header or token."}}`))
	}))
	defer server.Close()

	quota, err := queryCodingPlanCommandCodeAt(context.Background(), server.URL, "bad-key")
	require.NoError(t, err)
	require.NotNil(t, quota)
	assert.False(t, quota.Success)
	assert.Contains(t, quota.Error, "Authentication failed (HTTP 401)")
}

// 订阅接口挂了：5 小时 / 周窗口照常返回，只是没有月度窗口与等级。
func TestQueryCodingPlanCommandCodeAtSubscriptionFailureKeepsWindows(t *testing.T) {
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case commandCodeWhoamiPath:
			_, _ = w.Write([]byte(commandCodeWhoamiSample))
		case commandCodeCreditsPath:
			_, _ = w.Write([]byte(commandCodeCreditsSample))
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"success":false,"message":"boom"}`))
		}
	}))
	defer server.Close()

	quota, err := queryCodingPlanCommandCodeAt(context.Background(), server.URL, "cmd-api-key")
	require.NoError(t, err)
	require.True(t, quota.Success, quota.Error)
	assert.Empty(t, quota.Level)
	require.Len(t, quota.Tiers, 2)
}

// 订阅不是 active（过期/取消）：不认套餐额度，也不出等级徽标。
func TestQueryCodingPlanCommandCodeAtInactiveSubscription(t *testing.T) {
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case commandCodeWhoamiPath:
			_, _ = w.Write([]byte(commandCodeWhoamiSample))
		case commandCodeCreditsPath:
			_, _ = w.Write([]byte(commandCodeCreditsSample))
		default:
			_, _ = w.Write([]byte(`{"success":true,"data":{"status":"canceled",` +
				`"planId":"individual-goat","currentPeriodEnd":"2026-10-21T07:47:30.000Z"}}`))
		}
	}))
	defer server.Close()

	quota, err := queryCodingPlanCommandCodeAt(context.Background(), server.URL, "cmd-api-key")
	require.NoError(t, err)
	require.True(t, quota.Success, quota.Error)
	assert.Empty(t, quota.Level)
	assert.Len(t, quota.Tiers, 2)
}

// 额度响应缺 credits 字段：确定性失败。
func TestQueryCodingPlanCommandCodeAtMissingCreditsField(t *testing.T) {
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case commandCodeWhoamiPath:
			_, _ = w.Write([]byte(commandCodeWhoamiSample))
		default:
			_, _ = w.Write([]byte(`{"windowLimits":{}}`))
		}
	}))
	defer server.Close()

	quota, err := queryCodingPlanCommandCodeAt(context.Background(), server.URL, "cmd-api-key")
	require.NoError(t, err)
	require.NotNil(t, quota)
	assert.False(t, quota.Success)
	assert.Contains(t, quota.Error, "Missing 'credits' field")
}

// 网络不通：瞬时错误（返回 err，由调用方按瞬时处理）。
func TestQueryCodingPlanCommandCodeAtNetworkError(t *testing.T) {
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	quota, err := queryCodingPlanCommandCodeAt(context.Background(), "http://127.0.0.1:1", "cmd-api-key")
	require.Error(t, err)
	assert.Nil(t, quota)
}
