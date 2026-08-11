package minimax

import (
	"fmt"

	"github.com/QuantumNous/new-api/relay/channel"
	channelconstant "github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
)

func GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	baseUrl := info.ChannelBaseUrl
	if baseUrl == "" {
		baseUrl = channelconstant.ChannelBaseURLs[channelconstant.ChannelTypeMiniMax]
	}
	// 编码套餐符号键:走 ChannelSpecialBases 解析出的专属端点(MiniMax Token Plan 用
	// OpenAI 兼容的 /v1 与 Anthropic 兼容的 /anthropic,与按量计费的通用端点不同)。
	if specialPlan, ok := channelconstant.ChannelSpecialBases[baseUrl]; ok {
		switch info.RelayFormat {
		case types.RelayFormatClaude:
			if specialPlan.ClaudeBaseURL != "" {
				return fmt.Sprintf("%s/v1/messages", specialPlan.ClaudeBaseURL), nil
			}
		case types.RelayFormatOpenAI:
			if specialPlan.OpenAIBaseURL != "" {
				return fmt.Sprintf("%s/chat/completions", specialPlan.OpenAIBaseURL), nil
			}
		}
	}
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		// Anthropic 兼容端点(完整 /v1/messages 或 anthropic 路径基址):原样透传/补齐
		// /v1/messages,不自动拼渠道路径(与 Custom 渠道同款,用户手动填完整地址或选了
		// Anthropic 套餐预设)。
		if channel.IsAnthropicNativeBaseURL(info.ChannelBaseUrl) {
			return channel.BuildClaudeMessagesURL(info.ChannelBaseUrl), nil
		}
		return fmt.Sprintf("%s/anthropic/v1/messages", info.ChannelBaseUrl), nil
	default:
		switch info.RelayMode {
		case constant.RelayModeChatCompletions:
			// Anthropic 兼容端点没有 OpenAI 路径:OpenAI 格式请求由 ConvertOpenAIRequest
			// 转成 Claude 格式后走 /v1/messages,不能把 OpenAI 路径拼到完整地址上(会 404)。
			if channel.IsAnthropicNativeBaseURL(info.ChannelBaseUrl) {
				return channel.BuildClaudeMessagesURL(info.ChannelBaseUrl), nil
			}
			return fmt.Sprintf("%s/v1/text/chatcompletion_v2", baseUrl), nil
		case constant.RelayModeImagesGenerations:
			return fmt.Sprintf("%s/v1/image_generation", baseUrl), nil
		case constant.RelayModeAudioSpeech:
			return fmt.Sprintf("%s/v1/t2a_v2", baseUrl), nil
		default:
			return "", fmt.Errorf("unsupported relay mode: %d", info.RelayMode)
		}
	}
}
