package moonshot

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdaptorGetRequestURLAnthropicEndpoints(t *testing.T) {
	a := &Adaptor{}
	tests := []struct {
		name      string
		baseURL   string
		relayForm types.RelayFormat
		want      string
	}{
		// 符号键:解析成套餐 Anthropic 兼容端点再拼 /v1/messages。
		{name: "kimi symbol claude", baseURL: "kimi-coding-plan", relayForm: types.RelayFormatClaude, want: "https://api.kimi.com/coding/v1/messages"},
		// 完整 Anthropic 端点(带 /v1/messages):原样透传,不自动拼路径(与 Custom 渠道同款)。
		{name: "kimi anthropic full endpoint passthrough", baseURL: "https://api.kimi.com/coding/v1/messages", relayForm: types.RelayFormatClaude, want: "https://api.kimi.com/coding/v1/messages"},
		// OpenAI 格式请求打到完整 Anthropic 端点:URL 仍走 /v1/messages(格式转换由
		// ConvertOpenAIRequest 负责),不能把 OpenAI 路径拼上去 404。
		{name: "kimi anthropic full endpoint openai format", baseURL: "https://api.kimi.com/coding/v1/messages", relayForm: types.RelayFormatOpenAI, want: "https://api.kimi.com/coding/v1/messages"},
		// anthropic 路径基址(未带 /v1/messages):补齐 /v1/messages,不双重拼接。
		{name: "kimi anthropic base claude", baseURL: "https://api.kimi.com/coding/anthropic", relayForm: types.RelayFormatClaude, want: "https://api.kimi.com/coding/anthropic/v1/messages"},
		// 普通 host:仍走默认的 anthropic 路径拼接,不回归。
		{name: "plain host claude", baseURL: "https://api.moonshot.cn", relayForm: types.RelayFormatClaude, want: "https://api.moonshot.cn/anthropic/v1/messages"},
		{name: "plain host openai", baseURL: "https://api.moonshot.cn", relayForm: types.RelayFormatOpenAI, want: "https://api.moonshot.cn/v1/chat/completions"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				RelayMode:   relayconstant.RelayModeChatCompletions,
				RelayFormat: tt.relayForm,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: tt.baseURL},
			}
			got, err := a.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
