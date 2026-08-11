package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
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
		{messageIdx: 1, partIdx: 1}: "[图片描述（由视觉辅助模型自动生成）] a red circle",
		{messageIdx: 2, partIdx: 0}: "[图片描述（由视觉辅助模型自动生成）] a blue square",
	})

	// 图片全部被描述后，消息退化为纯文本：content 应该是普通字符串，
	// 保证 StringContent()/ParseContent() 与 OpenAI→Claude 等转换都能正确处理。
	assert.True(t, req.Messages[1].IsStringContent())
	assert.Equal(t, "look at this\n[图片描述（由视觉辅助模型自动生成）] a red circle", req.Messages[1].StringContent())
	assert.True(t, req.Messages[2].IsStringContent())
	assert.Equal(t, "[图片描述（由视觉辅助模型自动生成）] a blue square", req.Messages[2].StringContent())

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
		// 父请求出图后遗留的 auto 分组遍历位置：子请求必须从 auto 列表开头
		// 独立遍历，否则会跳过视觉模型渠道所在分组。
		string(constant.ContextKeyAutoGroupIndex):      2,
		string(constant.ContextKeyAutoGroupRetryIndex): 0,
	}

	subCtx, _ := newSubContext(parent.Request.Context(), parent, []byte(`{"model":"vision"}`))

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

	// The sub-request must not inherit the parent's auto-group traversal position:
	// channel selection must start from the beginning of the auto list so vision
	// model channels in earlier groups are not skipped.
	_, hasAutoIndex := subCtx.Get(string(constant.ContextKeyAutoGroupIndex))
	assert.False(t, hasAutoIndex, "sub-request must not inherit the parent auto group index")
	_, hasAutoRetryIndex := subCtx.Get(string(constant.ContextKeyAutoGroupRetryIndex))
	assert.False(t, hasAutoRetryIndex, "sub-request must not inherit the parent auto group retry index")

	// The sub-request body is replaced.
	bodyBytes := make([]byte, 128)
	n, _ := subCtx.Request.Body.Read(bodyBytes)
	assert.True(t, strings.Contains(string(bodyBytes[:n]), `"vision"`))

	// The sub-request runs under the fallback's bounded context, not the parent
	// request context, so a stuck vision model cannot hold the parent request.
	assert.Equal(t, parent.Request.Context(), subCtx.Request.Context())
}

func TestStartVisionFallbackKeepAlive(t *testing.T) {
	oldInterval := fallbackKeepAliveInterval
	fallbackKeepAliveInterval = 50 * time.Millisecond
	defer func() { fallbackKeepAliveInterval = oldInterval }()

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	stop := startVisionFallbackKeepAlive(c)
	require.NotNil(t, stop)
	defer stop()

	// SSE response is committed and the flag is set so the relay error handler
	// knows to report a later failure as an SSE event instead of a JSON body.
	assert.Equal(t, "text/event-stream", c.Writer.Header().Get("Content-Type"))
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, common.GetContextKeyBool(c, constant.ContextKeyVisionFallbackSSEStarted))

	// Keep-alive pings actually reach the client during the fallback.
	require.Eventually(t, func() bool {
		return strings.Contains(rec.Body.String(), ": PING")
	}, time.Second, 20*time.Millisecond)

	// The stop func terminates the ping loop cleanly.
	stop()
	bodyAfterStop := rec.Body.String()
	time.Sleep(100 * time.Millisecond)
	assert.Equal(t, bodyAfterStop, rec.Body.String(), "no pings should be written after stop")
}

func TestWriteVisionFallbackSSEError(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	apiErr := types.NewError(fmt.Errorf("vision model blew up"), types.ErrorCodeBadResponse)
	writeVisionFallbackSSEError(c, apiErr)

	// The failure is reported as an SSE data event carrying the OpenAI error, the
	// shape OpenAI-compatible clients treat as a stream error.
	body := rec.Body.String()
	assert.True(t, strings.HasPrefix(body, "data: {"), "expected an SSE data event, got: %s", body)
	assert.Contains(t, body, `"error"`)
	assert.Contains(t, body, "vision model blew up")
}

func TestVisionDescriptionCacheKeyDeterminism(t *testing.T) {
	// 同一张图(同一 URL)同一视觉模型必须映射到同一个 key,去重才成立;
	// 换视觉模型或换图都不能共用 key,否则会串用错误的描述。
	url := "data:image/png;base64,AAAA"
	key := visionDescriptionCacheKey("glm-4v", url)
	assert.Equal(t, key, visionDescriptionCacheKey("glm-4v", url), "same image + model must map to the same key")
	assert.NotEqual(t, key, visionDescriptionCacheKey("other-vision", url), "different vision model must not share a key")
	assert.NotEqual(t, key, visionDescriptionCacheKey("glm-4v", "data:image/png;base64,BBBB"), "different image must not share a key")
}

func TestVisionDescriptionCacheReuse(t *testing.T) {
	cache := getVisionDescriptionCache()
	imageURL := "data:image/png;base64,AAAA"
	key := visionDescriptionCacheKey("glm-4v", imageURL)

	// 首次出现:缓存未命中。
	_, found, err := cache.Get(key)
	require.NoError(t, err)
	assert.False(t, found)

	// 识别成功后写入缓存;后续轮次再次出现同一张图时命中,直接复用。
	require.NoError(t, cache.SetWithTTL(key, "a red circle", time.Minute))
	got, found, err := cache.Get(key)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "a red circle", got)

	// 另一张图仍是未命中。
	_, found, err = cache.Get(visionDescriptionCacheKey("glm-4v", "data:image/png;base64,BBBB"))
	require.NoError(t, err)
	assert.False(t, found)
}

