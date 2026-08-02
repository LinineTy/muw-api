package dto

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParseContentAfterShallowCopy 复现 OpenAI→Claude 转换里的浅拷贝场景：
// fmtMessage := dto.Message{Role, Content} 会丢失 parsedContent 缓存，
// 此时 ParseContent 必须仍能解析 SetMediaContent 写入的 []MediaContent。
func TestParseContentAfterShallowCopy(t *testing.T) {
	msg := Message{Role: "user", Content: []any{
		map[string]any{"type": "text", "text": "look at this"},
		map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.png"}},
	}}
	// 模拟 applyDescriptions 的 SetMediaContent
	msg.SetMediaContent([]MediaContent{
		{Type: ContentTypeText, Text: "look at this"},
		{Type: ContentTypeText, Text: "[图片描述] a red circle"},
	})

	// 模拟 to_claude_messages_req.go 的浅拷贝 fmtMessage
	shallow := Message{Role: msg.Role, Content: msg.Content}
	parts := shallow.ParseContent()
	require.Len(t, parts, 2)
	assert.Equal(t, "look at this", parts[0].Text)
	assert.Equal(t, "[图片描述] a red circle", parts[1].Text)
	assert.Equal(t, ContentTypeText, parts[0].Type)
}
