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

	// The text part stays untouched; the image part becomes a text description.
	msg1 := req.Messages[1].ParseContent()
	require.Len(t, msg1, 2)
	assert.Equal(t, "look at this", msg1[0].Text)
	assert.Equal(t, "[图片描述] a red circle", msg1[1].Text)
	assert.Equal(t, dto.ContentTypeText, msg1[1].Type)

	msg2 := req.Messages[2].ParseContent()
	require.Len(t, msg2, 1)
	assert.Equal(t, "[图片描述] a blue square", msg2[0].Text)

	// A message without images is untouched.
	assert.Equal(t, "plain text", req.Messages[0].StringContent())
}
