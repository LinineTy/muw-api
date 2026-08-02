package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCollectImageParts(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model: "deepseek-chat",
		Messages: []dto.Message{
			{Role: "user", Content: "plain text, no image"},
			{Role: "user", Content: []any{
				map[string]any{"type": "text", "text": "look at this"},
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.png"}},
			}},
			{Role: "user", Content: []any{
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,AAAA"}},
			}},
		},
	}

	refs := collectImageParts(req)
	require.Len(t, refs, 2)
	assert.Equal(t, imageRef{messageIdx: 1, partIdx: 1, url: "https://example.com/a.png"}, refs[0])
	assert.Equal(t, imageRef{messageIdx: 2, partIdx: 0, url: "data:image/png;base64,AAAA"}, refs[1])
}

func TestCollectImagePartsNoImages(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model:    "deepseek-chat",
		Messages: []dto.Message{{Role: "user", Content: "plain text"}},
	}
	assert.Empty(t, collectImageParts(req))

	// A text-only array also yields no image refs.
	req.Messages = append(req.Messages, dto.Message{Role: "user", Content: []any{
		map[string]any{"type": "text", "text": "still no image"},
	}})
	assert.Empty(t, collectImageParts(req))
}

func TestApplyDescriptions(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model: "deepseek-chat",
		Messages: []dto.Message{
			{Role: "user", Content: "plain text"},
			{Role: "user", Content: []any{
				map[string]any{"type": "text", "text": "look at this"},
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.png"}},
			}},
			{Role: "user", Content: []any{
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,AAAA"}},
			}},
		},
	}

	applyDescriptions(req, map[imageRef]string{
		{messageIdx: 1, partIdx: 1}: "[图片描述] a red circle",
		{messageIdx: 2, partIdx: 0}: "[图片描述] a blue square",
	})

	// 图片全部被描述后，消息退化为纯文本：content 应该是普通字符串，
	// 保证 StringContent()/ParseContent() 与 OpenAI→Claude 等转换都能正确处理。
	assert.True(t, req.Messages[1].IsStringContent())
	assert.Equal(t, "look at this\n[图片描述] a red circle", req.Messages[1].StringContent())
	assert.True(t, req.Messages[2].IsStringContent())
	assert.Equal(t, "[图片描述] a blue square", req.Messages[2].StringContent())

	// 无图片的消息保持不变。
	assert.Equal(t, "plain text", req.Messages[0].StringContent())
}

func TestAllTextPartsAndJoin(t *testing.T) {
	assert.True(t, allTextParts([]dto.MediaContent{{Type: dto.ContentTypeText, Text: "a"}}))
	assert.False(t, allTextParts([]dto.MediaContent{{Type: dto.ContentTypeText, Text: "a"}, {Type: dto.ContentTypeImageURL, ImageUrl: &dto.MessageImageUrl{Url: "x"}}}))
	assert.Equal(t, "a\nb", joinTextParts([]dto.MediaContent{{Type: dto.ContentTypeText, Text: "a"}, {Type: dto.ContentTypeText, Text: "b"}}))
}
