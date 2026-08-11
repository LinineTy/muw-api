package channel

import "strings"

// IsAnthropicNativeBaseURL 判断 base_url 是否为 Anthropic 兼容端点:完整的
// /v1/messages 地址,或 anthropic 路径基址(如 https://open.bigmodel.cn/api/anthropic、
// https://api.moonshot.cn/anthropic)。这类端点没有 OpenAI 兼容路径,转发必须走
// Claude 格式,绝不能把 OpenAI 路径拼到完整地址上(会 404)。符号键(ChannelSpecialBases)
// 由各适配器在更上层解析,到这里已是真实地址或裸 host。
func IsAnthropicNativeBaseURL(baseURL string) bool {
	u := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	return strings.HasSuffix(u, "/v1/messages") ||
		strings.HasSuffix(u, "/api/anthropic") ||
		strings.HasSuffix(u, "/anthropic")
}

// BuildClaudeMessagesURL 生成 Anthropic 端点的 /v1/messages 地址:已带 /v1/messages 的
// 完整地址原样透传(与 Custom 渠道同款),anthropic 路径基址补 /v1/messages。
func BuildClaudeMessagesURL(baseURL string) string {
	u := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(u, "/v1/messages") {
		return u
	}
	return u + "/v1/messages"
}
