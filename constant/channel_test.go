package constant

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetChannelBaseURLIsBoundsSafe(t *testing.T) {
	assert.Empty(t, GetChannelBaseURL(ChannelTypeTaskPlugin))
	assert.Empty(t, GetChannelBaseURL(9999))
}

func TestChannelTypeAllowsEmptyKey(t *testing.T) {
	assert.True(t, ChannelTypeAllowsEmptyKey(ChannelTypeOpenCodeZen), "OpenCode Zen 空密钥走免费套餐")
	assert.False(t, ChannelTypeAllowsEmptyKey(ChannelTypeOpenAI))
	assert.False(t, ChannelTypeAllowsEmptyKey(ChannelTypeSenseNova))
	assert.False(t, ChannelTypeAllowsEmptyKey(ChannelTypeUnknown))
}

// 套餐 / Claude 端点上的模型列表探测基址解析 —— 首轮巡检里 MiniMax×2、GLM×2
// 四个渠道固定 404 就是因为拿 `…/v1/messages` 直接拼 `/v1/models`。
func TestResolveUpstreamModelsBaseURL(t *testing.T) {
	cases := []struct {
		name     string
		baseURL  string
		expected string
		ok       bool
	}{
		{"符号键-智谱套餐", "glm-coding-plan", "https://open.bigmodel.cn/api/coding/paas/v4", true},
		{"符号键-MiniMax套餐", "minimax-coding-plan", "https://api.minimaxi.com/v1", true},
		{"MiniMax 官方 Claude 端点", "https://api.minimaxi.com/anthropic/v1/messages", "https://api.minimaxi.com/v1", true},
		{"智谱官方 Claude 端点", "https://open.bigmodel.cn/api/anthropic", "https://open.bigmodel.cn/api/coding/paas/v4", true},
		{"自定义中转（Claude 端点）", "http://112.194.204.102:33333/v1/messages", "http://112.194.204.102:33333/v1", true},
		{"自定义中转带尾斜杠", "http://relay.example.com/v1/messages/", "http://relay.example.com/v1", true},
		{"普通渠道不受影响", "https://api.deepseek.com/v1", "", false},
		{"空值", "  ", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ResolveUpstreamModelsBaseURL(tc.baseURL)
			assert.Equal(t, tc.ok, ok)
			if tc.ok {
				assert.Equal(t, tc.expected, got)
			}
		})
	}
}
