package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
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

func TestNewSubContextStripsRequestId(t *testing.T) {
	// Build a parent context carrying the request id plus identity keys.
	parent, _ := gin.CreateTestContext(nil)
	parent.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"vision"}`))
	parent.Keys = map[string]any{
		common.RequestIdKey:   "parent-request-id",
		common.KeyBodyStorage: "cached-body",
		"X-Identity":          "user-42",
		"X-Oneapi-User-Id":    42,
		"some-other-key":      "kept",
	}

	subCtx, _ := newSubContext(parent, []byte(`{"model":"vision"}`))

	// The sub-request must not inherit the parent request id: the parent id is
	// already consumed as the subscription pre-consume idempotency key, so reusing
	// it would make later sub-requests skip pre-consume while still refunding on
	// settle, rolling the subscription balance back repeatedly.
	_, hasReqID := subCtx.Get(common.RequestIdKey)
	assert.False(t, hasReqID, "sub-request must not inherit the parent request id")

	// Identity keys survive, cached body is dropped.
	assert.Equal(t, "user-42", subCtx.GetString("X-Identity"))
	assert.Equal(t, 42, subCtx.GetInt("X-Oneapi-User-Id"))
	_, hasBody := subCtx.Get(common.KeyBodyStorage)
	assert.False(t, hasBody, "cached body must be replaced by the new sub-request body")
	assert.Equal(t, "kept", subCtx.GetString("some-other-key"))

	// The sub-request body is replaced.
	bodyBytes := make([]byte, 128)
	n, _ := subCtx.Request.Body.Read(bodyBytes)
	assert.True(t, strings.Contains(string(bodyBytes[:n]), `"vision"`))
}

