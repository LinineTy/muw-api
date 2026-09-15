// @muw-owned
package service

import (
	"math"
	"strconv"
	"sync"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// 上下文窗口校验的「上游基线」。
//
// 背景：校验用的输入 token 来自本地估算器（service/token_estimator.go，按字符类别加权），
// 它不是 tokenizer，与各上游自身口径存在系统性偏差（实测同一份正文：本地估算 vs 智谱
// 口径可差 1.4 倍以上）。于是出现了「本地算 37 万放行、上游实际吃进 53 万」的漏放。
//
// 思路：缓存型客户端（Claude Code / ZCode 等）每轮把整段上下文重发，所以**上一次成功响应
// 里上游回报的上下文**就是本次请求上下文的下界；本地估算只用来算「本轮相对上轮的增量」，
// 并按观测到的换算率（上游口径 ÷ 本地估算）折算增量。这样尺子自动对齐到「该 token × 该模型」
// 真实使用的那个上游口径，不需要改估算器、也不需要额外调 tokenizer。
//
// 失效与兜底：
//   - 明显缩水（本轮本地估算 < 上轮 × dropRatio）⇒ 客户端压缩或换了会话 ⇒ 忽略基线，
//     否则压缩后的正常请求会被旧基线一路拦死；
//   - 超过 TTL 没更新 ⇒ 忽略基线（长时间空闲后不拿旧值卡新会话）；
//   - 没有基线（首次请求/上游未回报 usage）⇒ 退回纯本地估算，行为与改动前一致。
//
// 已知局限：键是 (tokenId, modelName)，不含渠道；同一模型名由多个计数口径不同的渠道轮流承载时，
// 基线会按最近一次成功响应切换口径，可能出现一轮的偏差。
const (
	// ctxWindowBaselineTTL 基线有效期。
	ctxWindowBaselineTTL = 2 * time.Hour
	// ctxWindowBaselineDropRatio 本轮本地估算低于上轮该比例 ⇒ 判定为压缩/换会话。
	ctxWindowBaselineDropRatio = 0.7
	// ctxWindowBaselineRatioMax 观测换算率上限，防异常样本把增量放大过头。
	ctxWindowBaselineRatioMax = 4.0
	// ctxWindowBaselinePurgeInterval 惰性清理的最小间隔。
	ctxWindowBaselinePurgeInterval = 5 * time.Minute
)

type ctxWindowBaseline struct {
	upstreamCtx   int   // 上一次成功响应里上游回报的真实上下文（含缓存）
	localEstimate int   // 上一次请求的本地估算值（用于算增量与换算率）
	updatedAt     int64 // 秒级时间戳
}

var (
	ctxWindowBaselineLock  sync.RWMutex
	ctxWindowBaselines     = make(map[string]*ctxWindowBaseline)
	ctxWindowLastPurgeUnix int64
)

func ctxWindowBaselineKey(tokenID int, modelName string) string {
	return strconv.Itoa(tokenID) + "|" + modelName
}

// UpstreamContextTokens 上游这一次请求真实吃进去的上下文规模：
// 非缓存输入 + 缓存命中 + 缓存写入。
//
// anthropic 语义下 PromptTokens 只含非缓存输入（见 relay/channel/claude/relay-claude.go
// 的 usage 归一），缓存部分由 detail 单独上报，需要相加；
// openai / gemini 语义下 prompt_tokens 已经包含缓存，相加会重复计算。
func UpstreamContextTokens(usage *dto.Usage, semantic string) int {
	if usage == nil {
		return 0
	}
	prompt := usage.PromptTokens
	if prompt == 0 && usage.InputTokens > 0 {
		prompt = usage.InputTokens
	}
	if semantic == dto.BillingUsageSemanticAnthropic {
		cacheCreation := usage.PromptTokensDetails.CachedCreationTokens
		if cacheCreation == 0 {
			// 部分上游只上报 5m/1h 拆分口径
			cacheCreation = usage.ClaudeCacheCreation5mTokens + usage.ClaudeCacheCreation1hTokens
		}
		total := prompt + usage.PromptTokensDetails.CachedTokens + cacheCreation
		if total > prompt {
			return total
		}
	}
	return prompt
}

// RecordContextWindowBaseline 记录一次「上游真实上下文」，供后续请求的上下文校验使用。
// 只在拿到上游真实回报的 usage 时调用；本地估算出来的 usage 不能作为基线。
func RecordContextWindowBaseline(relayInfo *relaycommon.RelayInfo, usage *dto.Usage) {
	if relayInfo == nil || usage == nil {
		return
	}
	local := relayInfo.GetEstimatePromptTokens()
	if local <= 0 {
		return
	}
	upstreamCtx := UpstreamContextTokens(usage, usageSemanticFromUsage(relayInfo, usage))
	if upstreamCtx <= 0 {
		return
	}
	key := ctxWindowBaselineKey(relayInfo.TokenId, relayInfo.OriginModelName)
	now := time.Now().Unix()

	ctxWindowBaselineLock.Lock()
	defer ctxWindowBaselineLock.Unlock()
	purgeContextWindowBaselinesLocked(now)
	ctxWindowBaselines[key] = &ctxWindowBaseline{
		upstreamCtx:   upstreamCtx,
		localEstimate: local,
		updatedAt:     now,
	}
}

// ContextWindowPromptEstimate 估算本次请求真实会占用的上下文：
// 有可用基线时返回「上轮上游真实值 + 本轮增量 × 观测换算率」，否则原样返回本地估算。
// 第二个返回值表示是否用上了基线（用于日志/文案区分）。
func ContextWindowPromptEstimate(tokenID int, modelName string, localEstimate int) (int, bool) {
	if localEstimate <= 0 {
		return localEstimate, false
	}
	key := ctxWindowBaselineKey(tokenID, modelName)
	now := time.Now().Unix()

	ctxWindowBaselineLock.RLock()
	baseline := ctxWindowBaselines[key]
	ctxWindowBaselineLock.RUnlock()

	if baseline == nil || baseline.upstreamCtx <= 0 || baseline.localEstimate <= 0 {
		return localEstimate, false
	}
	if now-baseline.updatedAt > int64(ctxWindowBaselineTTL.Seconds()) {
		return localEstimate, false
	}
	// 压缩/换会话：本轮明显比上轮小，基线不再代表当前会话。
	if float64(localEstimate) < float64(baseline.localEstimate)*ctxWindowBaselineDropRatio {
		return localEstimate, false
	}
	ratio := float64(baseline.upstreamCtx) / float64(baseline.localEstimate)
	if ratio < 1 {
		// 本地估算偏高时不缩小（相对上游更保守，避免放松既有拦截）。
		ratio = 1
	}
	if ratio > ctxWindowBaselineRatioMax {
		ratio = ctxWindowBaselineRatioMax
	}
	delta := localEstimate - baseline.localEstimate
	if delta < 0 {
		delta = 0
	}
	estimate := baseline.upstreamCtx + int(math.Round(float64(delta)*ratio))
	if estimate < localEstimate {
		estimate = localEstimate
	}
	return estimate, true
}

// DropContextWindowBaseline 主动清除某 token+模型的基线（测试与运维用）。
func DropContextWindowBaseline(tokenID int, modelName string) {
	ctxWindowBaselineLock.Lock()
	defer ctxWindowBaselineLock.Unlock()
	delete(ctxWindowBaselines, ctxWindowBaselineKey(tokenID, modelName))
}

// purgeContextWindowBaselinesLocked 惰性清理：调用方需持有写锁。
func purgeContextWindowBaselinesLocked(now int64) {
	if now-ctxWindowLastPurgeUnix < int64(ctxWindowBaselinePurgeInterval.Seconds()) {
		return
	}
	ctxWindowLastPurgeUnix = now
	expireBefore := now - int64(ctxWindowBaselineTTL.Seconds())
	for key, baseline := range ctxWindowBaselines {
		if baseline == nil || baseline.updatedAt < expireBefore {
			delete(ctxWindowBaselines, key)
		}
	}
}
