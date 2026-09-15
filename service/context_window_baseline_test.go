// @muw-owned
package service

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func resetContextWindowBaselines() {
	ctxWindowBaselineLock.Lock()
	defer ctxWindowBaselineLock.Unlock()
	ctxWindowBaselines = make(map[string]*ctxWindowBaseline)
	ctxWindowLastPurgeUnix = 0
}

func TestUpstreamContextTokens(t *testing.T) {
	// anthropic 语义：PromptTokens 只含非缓存输入，缓存命中/写入需相加
	claudeUsage := &dto.Usage{
		UsageSemantic:       dto.BillingUsageSemanticAnthropic,
		PromptTokens:        347,
		CompletionTokens:    166,
		PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 533824, CachedCreationTokens: 1234},
	}
	require.Equal(t, 347+533824+1234, UpstreamContextTokens(claudeUsage, dto.BillingUsageSemanticAnthropic))

	// openai 语义：prompt_tokens 已含缓存，不能重复相加
	openaiUsage := &dto.Usage{
		UsageSemantic:       "openai",
		PromptTokens:        100000,
		PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 80000},
	}
	require.Equal(t, 100000, UpstreamContextTokens(openaiUsage, "openai"))

	require.Equal(t, 0, UpstreamContextTokens(nil, "openai"))
}

func TestContextWindowPromptEstimateWithoutBaseline(t *testing.T) {
	resetContextWindowBaselines()
	estimate, fromBaseline := ContextWindowPromptEstimate(1, "GLM-5.3-Flash", 372387)
	require.False(t, fromBaseline)
	require.Equal(t, 372387, estimate)
}

// 核心场景：本地估算器低估（372,387 vs 上游 534,171），下一轮靠基线补齐。
func TestContextWindowPromptEstimateUsesUpstreamBaseline(t *testing.T) {
	resetContextWindowBaselines()
	info := &relaycommon.RelayInfo{TokenId: 7, OriginModelName: "GLM-5.3-Flash"}
	info.SetEstimatePromptTokens(372387)
	RecordContextWindowBaseline(info, &dto.Usage{
		UsageSemantic:       dto.BillingUsageSemanticAnthropic,
		PromptTokens:        347,
		PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 533824},
	})

	// 本轮几乎没长（增量 1000）：估算 = 534,171 + 1000 × 换算率
	estimate, fromBaseline := ContextWindowPromptEstimate(7, "GLM-5.3-Flash", 373387)
	require.True(t, fromBaseline)
	expected := 534171 + int(math.Round(1000*(534171.0/372387.0)))
	require.Equal(t, expected, estimate)
	require.Greater(t, estimate, 512000, "上一轮上游真实值已超限，本轮必须判定为超限")

	// 增量按观测换算率放大，不是 1:1
	estimate2, _ := ContextWindowPromptEstimate(7, "GLM-5.3-Flash", 382387)
	require.Greater(t, estimate2, 534171+9000, "增量应按观测换算率（>1）折算")
}

// 压缩/换会话：本轮明显缩水 ⇒ 忽略基线，否则压缩后的小请求会被旧基线拦死。
func TestContextWindowPromptEstimateResetsOnCompaction(t *testing.T) {
	resetContextWindowBaselines()
	info := &relaycommon.RelayInfo{TokenId: 8, OriginModelName: "GLM-5.3-Flash"}
	info.SetEstimatePromptTokens(372387)
	RecordContextWindowBaseline(info, &dto.Usage{
		UsageSemantic:       dto.BillingUsageSemanticAnthropic,
		PromptTokens:        347,
		PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 533824},
	})

	estimate, fromBaseline := ContextWindowPromptEstimate(8, "GLM-5.3-Flash", 90000)
	require.False(t, fromBaseline, "明显缩水应判定为压缩，不套用旧基线")
	require.Equal(t, 90000, estimate)

	// 缩水后新基线由下一次成功响应重建（此处模拟：压缩后的响应回报 12 万）
	info.SetEstimatePromptTokens(90000)
	RecordContextWindowBaseline(info, &dto.Usage{
		UsageSemantic:       dto.BillingUsageSemanticAnthropic,
		PromptTokens:        120000,
		PromptTokensDetails: dto.InputTokenDetails{},
	})
	estimate2, fromBaseline2 := ContextWindowPromptEstimate(8, "GLM-5.3-Flash", 95000)
	require.True(t, fromBaseline2)
	require.Equal(t, 120000+int(math.Round(5000*(120000.0/90000.0))), estimate2)
}

func TestContextWindowPromptEstimateExpiresAndIsolates(t *testing.T) {
	resetContextWindowBaselines()
	info := &relaycommon.RelayInfo{TokenId: 9, OriginModelName: "GLM-5.3-Flash"}
	info.SetEstimatePromptTokens(1000)
	RecordContextWindowBaseline(info, &dto.Usage{
		UsageSemantic:       dto.BillingUsageSemanticAnthropic,
		PromptTokens:        400000,
		PromptTokensDetails: dto.InputTokenDetails{},
	})

	// 其它 token / 其它模型互不影响
	estimate, fromBaseline := ContextWindowPromptEstimate(10, "GLM-5.3-Flash", 1000)
	require.False(t, fromBaseline)
	require.Equal(t, 1000, estimate)
	estimate, fromBaseline = ContextWindowPromptEstimate(9, "GLM-5.2", 1000)
	require.False(t, fromBaseline)
	require.Equal(t, 1000, estimate)
	// 同 key 生效
	estimate, fromBaseline = ContextWindowPromptEstimate(9, "GLM-5.3-Flash", 1000)
	require.True(t, fromBaseline)
	require.Equal(t, 400000, estimate)

	// TTL 过期后失效
	ctxWindowBaselineLock.Lock()
	ctxWindowBaselines[ctxWindowBaselineKey(9, "GLM-5.3-Flash")].updatedAt = time.Now().Add(-3 * time.Hour).Unix()
	ctxWindowBaselineLock.Unlock()
	estimate, fromBaseline = ContextWindowPromptEstimate(9, "GLM-5.3-Flash", 1000)
	require.False(t, fromBaseline)
	require.Equal(t, 1000, estimate)
}

// 换算率上限：异常样本（上游是本地估算 5 倍）不能把增量放大过头。
func TestContextWindowPromptEstimateCapsRatio(t *testing.T) {
	resetContextWindowBaselines()
	info := &relaycommon.RelayInfo{TokenId: 11, OriginModelName: "MiniMax-M3"}
	info.SetEstimatePromptTokens(100000)
	RecordContextWindowBaseline(info, &dto.Usage{
		UsageSemantic:       "openai",
		PromptTokens:        500000,
		PromptTokensDetails: dto.InputTokenDetails{},
	})

	estimate, fromBaseline := ContextWindowPromptEstimate(11, "MiniMax-M3", 110000)
	require.True(t, fromBaseline)
	require.Equal(t, 500000+int(math.Round(10000*ctxWindowBaselineRatioMax)), estimate)
}

// 本地估算偏高（换算率 < 1）时不放松：取「本地估算」与「基线 + 增量」的较大者。
func TestContextWindowPromptEstimateNeverLoosens(t *testing.T) {
	resetContextWindowBaselines()
	info := &relaycommon.RelayInfo{TokenId: 12, OriginModelName: "MiniMax-M3"}
	info.SetEstimatePromptTokens(48982)
	RecordContextWindowBaseline(info, &dto.Usage{
		UsageSemantic:       "openai",
		PromptTokens:        35150,
		PromptTokensDetails: dto.InputTokenDetails{},
	})

	estimate, fromBaseline := ContextWindowPromptEstimate(12, "MiniMax-M3", 50982)
	require.True(t, fromBaseline)
	// 基线增量算出 35,150+2,000=37,150 < 本地估算 50,982 ⇒ 取本地估算（不放松既有拦截）
	require.Equal(t, 50982, estimate)
}

// 接线验证：渠道级校验（CheckChannelContextWindow）必须真的吃上基线。
// 用事故现场的数据：上一轮上游回报 585（非缓存）+ 536,448（缓存命中）= 537,033 > 512,000，
// 本轮本地估算只涨到 373,000 —— 没有基线时放行，有基线时必须拦。
func TestCheckChannelContextWindowBlocksOnBaseline(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetContextWindowBaselines()

	const modelName = "GLM-5.3-Flash"
	channel := &model.Channel{ModelContextWindows: map[string]int{modelName: 512000}}

	recordInfo := &relaycommon.RelayInfo{TokenId: 21, OriginModelName: modelName}
	recordInfo.SetEstimatePromptTokens(372387)
	RecordContextWindowBaseline(recordInfo, &dto.Usage{
		UsageSemantic:       dto.BillingUsageSemanticAnthropic,
		PromptTokens:        585,
		PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 536448},
	})

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{TokenId: 21, OriginModelName: modelName}
	info.SetEstimatePromptTokens(373000)
	meta := &types.TokenCountMeta{MaxTokens: 32000}

	apiErr := CheckChannelContextWindow(ctx, meta, info, channel)
	require.NotNil(t, apiErr, "上一轮上游真实上下文 537,033 已超限，必须拦截")
	require.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
	require.Equal(t, types.ErrorCodeContextWindowExceeded, apiErr.GetErrorCode())
	require.Contains(t, apiErr.Error(), "上游真实上下文基线")

	// 客户端压缩后（本轮明显缩水）必须放行，否则小请求会被旧基线一路拦死
	info.SetEstimatePromptTokens(120000)
	require.Nil(t, CheckChannelContextWindow(ctx, meta, info, channel))

	// 没有基线时行为与改动前一致：373,000 + 32,000 = 405,000 ≤ 512,000 放行
	resetContextWindowBaselines()
	info.SetEstimatePromptTokens(373000)
	require.Nil(t, CheckChannelContextWindow(ctx, meta, info, channel))
}
