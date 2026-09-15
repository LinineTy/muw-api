/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"fmt"
	"net/http"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	constant2 "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

// estimateTokensForContext 估算请求的输入 token（文本 + 工具/消息结构加成），
// 独立于 constant.CountToken 开关：上下文窗口校验是策略性拦截，必须始终计算，
// 不能因「关闭 token 统计」而失效。
// 与主路径 EstimateRequestToken（CountToken=true 时）的文本部分公式一致；
// 媒体 token 不计入（偏宽松，安全方向——媒体文件可能额外占 token，此处保守放行）。
func estimateTokensForContext(c *gin.Context, meta *types.TokenCountMeta, info *relaycommon.RelayInfo) int {
	if meta == nil {
		return 0
	}
	// 语音转写/翻译：meta 不含音频内容文本，上下文校验不适用
	if info.RelayMode == constant2.RelayModeAudioTranscription || info.RelayMode == constant2.RelayModeAudioTranslation {
		return 0
	}
	model := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)
	tkm := 0
	if meta.TokenType == types.TokenTypeTextNumber {
		tkm += utf8.RuneCountInString(meta.CombineText)
	} else {
		tkm += CountTextToken(meta.CombineText, model)
	}
	if info.RelayFormat == types.RelayFormatOpenAI {
		tkm += meta.ToolsCount*8 + meta.MessagesCount*3 + meta.NameCount*3 + 3
	}
	return tkm
}

// resolvePromptTokens 取估算的输入 token；主路径估算为 0（CountToken 关闭或未
// 触发）时回退到上下文校验自己的估算。
func resolvePromptTokens(c *gin.Context, meta *types.TokenCountMeta, info *relaycommon.RelayInfo) int {
	prompt := info.GetEstimatePromptTokens()
	if prompt <= 0 {
		prompt = estimateTokensForContext(c, meta, info)
	}
	return prompt
}

// resolveContextPromptTokens 在本地估算之上叠加「上游真实上下文基线」：
// 缓存型客户端每轮重发整段上下文，上一次成功响应里上游回报的上下文是本次的下界，
// 用它 + 本地增量可以补上估算器与上游口径之间的系统性偏差（见 context_window_baseline.go）。
// 没有可用基线（首次请求、上游未回报 usage、客户端压缩后）时与原行为完全一致。
func resolveContextPromptTokens(c *gin.Context, meta *types.TokenCountMeta, info *relaycommon.RelayInfo) (int, bool) {
	local := resolvePromptTokens(c, meta, info)
	return ContextWindowPromptEstimate(info.TokenId, info.OriginModelName, local)
}

// contextWindowError 判定输入 + 输出预留是否超限。prompt 为估算输入，
// meta.MaxTokens 为请求的输出预算（openai/responses/claude/gemini 各 dto 已归一）。
// skipRetry 用于模型级检查：同一模型的 context_window 对所有渠道一致，超限无需重试。
// fromBaseline 表示 prompt 里含上游真实上下文（仅用于错误文案区分，便于排查口径问题）。
func contextWindowError(info *relaycommon.RelayInfo, meta *types.TokenCountMeta, prompt, limit int, skipRetry, fromBaseline bool) *types.NewAPIError {
	maxTokens := 0
	if meta != nil && meta.MaxTokens > 0 {
		maxTokens = meta.MaxTokens
	}
	total := prompt + maxTokens
	if total <= limit {
		return nil
	}
	opts := []types.NewAPIErrorOptions{types.ErrOptionWithStatusCode(http.StatusBadRequest)}
	if skipRetry {
		opts = append(opts, types.ErrOptionWithSkipRetry())
	}
	source := ""
	if fromBaseline {
		source = "（含上游真实上下文基线）"
	}
	return types.NewError(
		fmt.Errorf("模型 %s 上下文超限：输入约 %d%s + 输出 %d = %d > %d", info.OriginModelName, prompt, source, maxTokens, total, limit),
		types.ErrorCodeContextWindowExceeded,
		opts...,
	)
}

// CheckModelContextWindow 校验模型级 context_window（models 表配置，选渠道前执行）。
// 超限返回 400 且带 SkipRetry：该模型的上下文限制对所有渠道一致，换渠道无意义。
// 仅当该模型不存在任何渠道级覆盖时才生效——一旦存在覆盖，「渠道级覆盖 > 模型默认」，
// 模型默认不再构成全局硬上限，需在选渠道后由 CheckChannelContextWindow 逐渠道判定
// （覆盖 ?? 模型默认），否则更大覆盖的渠道会被模型默认值提前挡掉。
func CheckModelContextWindow(c *gin.Context, meta *types.TokenCountMeta, info *relaycommon.RelayInfo) *types.NewAPIError {
	if model.ModelHasChannelContextOverride(info.OriginModelName) {
		return nil
	}
	limit, ok := model.GetModelContextWindow(info.OriginModelName)
	if !ok || limit <= 0 {
		return nil
	}
	prompt, fromBaseline := resolveContextPromptTokens(c, meta, info)
	return contextWindowError(info, meta, prompt, limit, true, fromBaseline)
}

// CheckChannelContextWindow 校验渠道级 context_window 覆盖（选渠道后执行）。
// 生效上限 = 渠道覆盖 ?? 模型默认：无覆盖的渠道继承模型级配置，覆盖更大时按覆盖放行。
// 不带 SkipRetry：另一渠道可能有更大的覆盖值，超限交给重试循环尝试下一渠道。
func CheckChannelContextWindow(c *gin.Context, meta *types.TokenCountMeta, info *relaycommon.RelayInfo, channel *model.Channel) *types.NewAPIError {
	limit, ok := channel.GetModelContextWindow(info.OriginModelName)
	if !ok || limit <= 0 {
		limit, ok = model.GetModelContextWindow(info.OriginModelName)
	}
	if !ok || limit <= 0 {
		return nil
	}
	prompt, fromBaseline := resolveContextPromptTokens(c, meta, info)
	return contextWindowError(info, meta, prompt, limit, false, fromBaseline)
}
