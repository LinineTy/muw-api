package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// openRouterBody 从 JSON 构造 openRouterKeyResponse。
func openRouterBody(t *testing.T, jsonStr string) *openRouterKeyResponse {
	t.Helper()
	var body openRouterKeyResponse
	require.NoError(t, common.Unmarshal([]byte(jsonStr), &body))
	return &body
}

// 真实响应样本(2026-09-19 实测)，只保留本功能用到的字段。
const openRouterPaidSample = `{
  "data": {
    "label": "sk-or-v1-35f...554",
    "limit": 0.001,
    "limit_remaining": 0.001,
    "usage": 0,
    "is_free_tier": false,
    "free_model_daily_requests": { "used": 3, "limit": 1000, "remaining": 997 }
  }
}`

// provider 已注册进已知集合(否则 QueryCodingPlanQuota 直接返回 Unknown)。
func TestOpenRouterProviderRegistered(t *testing.T) {
	assert.True(t, IsKnownCodingPlanProvider("openrouter"))
	assert.True(t, IsKnownCodingPlanProvider(" openrouter "), "两端空白应被 trim")
}

// 已充值档：额度 1000/天，原始值全部下发。
func TestOpenRouterQuotaFromBodyPaidTier(t *testing.T) {
	quota := openRouterQuotaFromBody(openRouterBody(t, openRouterPaidSample))

	require.True(t, quota.Success)
	assert.Equal(t, "$10+ lifetime credits (1000/day)", quota.Level)
	require.Len(t, quota.Tiers, 1)

	tier := quota.Tiers[0]
	assert.Equal(t, CodingPlanTierDailyLimit, tier.Name)
	assert.Equal(t, float64(1000), tier.Limit)
	assert.Equal(t, float64(997), tier.Remaining)
	assert.Equal(t, float64(3), tier.Used)
	assert.InDelta(t, 0.3, tier.Utilization, 1e-9) // 3/1000
	require.NotNil(t, tier.ResetsAt)
	assert.NotEmpty(t, *tier.ResetsAt)
	assert.Greater(t, quota.QueriedAt, int64(0))
}

// 未充值(<$10)是 50/天，档位文案要跟着变。
func TestOpenRouterQuotaFromBodyFreeTier(t *testing.T) {
	quota := openRouterQuotaFromBody(openRouterBody(t, `{
	  "data": { "is_free_tier": true,
	    "free_model_daily_requests": { "used": 0, "limit": 50, "remaining": 50 } }
	}`))

	assert.Equal(t, "free tier (50/day)", quota.Level)
	assert.Equal(t, float64(50), quota.Tiers[0].Limit)
	assert.Equal(t, float64(50), quota.Tiers[0].Remaining)
	assert.Equal(t, float64(0), quota.Tiers[0].Used)
	assert.InDelta(t, 0, quota.Tiers[0].Utilization, 1e-9)
}

// limit 缺失/为 0 时不下发原始值(前端据此回退百分比展示)，且不出现负 used。
func TestOpenRouterQuotaFromBodyNoLimitOmitsRawValues(t *testing.T) {
	tier := openRouterQuotaFromBody(openRouterBody(t, `{"data":{"is_free_tier":false}}`)).Tiers[0]

	assert.Equal(t, float64(0), tier.Limit)
	assert.Equal(t, float64(0), tier.Remaining)
	assert.Equal(t, float64(0), tier.Used)
	assert.InDelta(t, 0, tier.Utilization, 1e-9)
}

// 上游异常数据沿用共用 helper(utilizationPercent) 的口径，不做额外钳制：
//   - remaining > limit(used 为负) ⇒ utilization 下限 0
//   - used > limit(remaining 为负) ⇒ 按真实比例 >100%，反映"超额"
//
// 后者与 zhipu/kimi 行为一致(zhipu/kimi 同样不下钳)，此处固化行为防回归。
func TestOpenRouterQuotaFromBodyUtilizationEdgeCases(t *testing.T) {
	over := openRouterQuotaFromBody(openRouterBody(t, `{
	  "data": { "is_free_tier": false,
	    "free_model_daily_requests": { "used": 1005, "limit": 1000, "remaining": -5 } }
	}`)).Tiers[0]
	assert.InDelta(t, 100.5, over.Utilization, 1e-9)
	assert.Equal(t, float64(1005), over.Used)

	under := openRouterQuotaFromBody(openRouterBody(t, `{
	  "data": { "is_free_tier": false,
	    "free_model_daily_requests": { "used": -200, "limit": 1000, "remaining": 1200 } }
	}`)).Tiers[0]
	assert.InDelta(t, 0, under.Utilization, 1e-9)
	assert.Equal(t, float64(0), under.Used, "负 used 应被钳到 0")
}

// 重置时间是未来的 UTC 零点(免费额度按 UTC 日界重置)。
func TestOpenRouterDailyResetAtIsNextUTCMidnight(t *testing.T) {
	s := openRouterDailyResetAt()
	require.NotNil(t, s)

	reset, err := time.Parse(time.RFC3339, *s)
	require.NoError(t, err)
	assert.True(t, reset.After(time.Now().UTC()), "重置时间应在未来")
	assert.Equal(t, 0, reset.Hour())
	assert.Equal(t, 0, reset.Minute())
	assert.Equal(t, 0, reset.Second())
}
