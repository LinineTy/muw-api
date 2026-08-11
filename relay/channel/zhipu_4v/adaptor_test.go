package zhipu_4v

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
		{name: "glm symbol claude", baseURL: "glm-coding-plan", relayForm: types.RelayFormatClaude, want: "https://open.bigmodel.cn/api/anthropic/v1/messages"},
		{name: "glm international symbol claude", baseURL: "glm-coding-plan-international", relayForm: types.RelayFormatClaude, want: "https://api.z.ai/api/anthropic/v1/messages"},
		// 完整 Anthropic 端点(带 /v1/messages):原样透传,不自动拼路径(与 Custom 渠道同款)。
		{name: "glm anthropic full endpoint passthrough", baseURL: "https://open.bigmodel.cn/api/anthropic/v1/messages", relayForm: types.RelayFormatClaude, want: "https://open.bigmodel.cn/api/anthropic/v1/messages"},
		{name: "glm anthropic international full endpoint passthrough", baseURL: "https://api.z.ai/api/anthropic/v1/messages", relayForm: types.RelayFormatClaude, want: "https://api.z.ai/api/anthropic/v1/messages"},
		// 普通 host:仍走默认的 anthropic 路径拼接,不回归。
		{name: "plain host claude", baseURL: "https://open.bigmodel.cn", relayForm: types.RelayFormatClaude, want: "https://open.bigmodel.cn/api/anthropic/v1/messages"},
		{name: "plain host openai", baseURL: "https://open.bigmodel.cn", relayForm: types.RelayFormatOpenAI, want: "https://open.bigmodel.cn/api/paas/v4/chat/completions"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				RelayMode:  relayconstant.RelayModeChatCompletions,
				RelayFormat: tt.relayForm,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: tt.baseURL},
			}
			got, err := a.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
