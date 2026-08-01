package controller

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// maxVisionFallbackImages bounds how many images per request are described by
// the vision model, so a single request cannot fan out into unbounded sub-calls.
const maxVisionFallbackImages = 4

// imageRef locates one image part inside a request message.
type imageRef struct {
	messageIdx int
	partIdx    int
	url        string
}

// applyVisionFallback rewrites an image-bearing chat request into a text-only
// request when the target model does not support vision: each image is sent to
// the configured vision model and replaced by its text description. It returns
// nil when the fallback is not applicable (no image, model already vision
// capable, feature disabled, or non-chat request). Any failure to describe an
// image aborts the request with a clear error instead of silently dropping the
// image.
func applyVisionFallback(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	req, ok := info.Request.(*dto.GeneralOpenAIRequest)
	if !ok || req == nil {
		return nil
	}
	setting := operation_setting.GetVisualFallbackSetting()
	if !setting.Enabled || setting.Model == "" {
		return nil
	}
	// The vision sub-request itself carries an image and its model IS the
	// fallback model; never re-trigger the fallback for it, otherwise a custom
	// vision model not listed in SupportedModels would recurse forever.
	if setting.Model == info.OriginModelName {
		return nil
	}
	if setting.IsVisionCapable(info.OriginModelName) {
		return nil
	}

	refs := collectImageParts(req)
	if len(refs) == 0 {
		return nil
	}

	// Describe every image through the vision model (bounded), then rewrite the
	// messages in a second pass so a failure never leaves a partially rewritten
	// request.
	descriptions := make(map[imageRef]string, len(refs))
	for i, ref := range refs {
		if i >= maxVisionFallbackImages {
			descriptions[ref] = "[附加图片已省略]"
			continue
		}
		desc, apiErr := describeImage(c, info, setting, ref.url)
		if apiErr != nil {
			return apiErr
		}
		descriptions[ref] = "[图片描述] " + desc
	}

	applyDescriptions(req, descriptions)
	return nil
}

// applyDescriptions replaces the image parts referenced by descriptions with
// text parts in the request messages.
func applyDescriptions(req *dto.GeneralOpenAIRequest, descriptions map[imageRef]string) {
	contentsByMessage := make(map[int][]dto.MediaContent)
	for ref, text := range descriptions {
		contents, ok := contentsByMessage[ref.messageIdx]
		if !ok {
			contents = req.Messages[ref.messageIdx].ParseContent()
		}
		contents[ref.partIdx] = dto.MediaContent{
			Type: dto.ContentTypeText,
			Text: text,
		}
		contentsByMessage[ref.messageIdx] = contents
	}
	for messageIdx, contents := range contentsByMessage {
		req.Messages[messageIdx].SetMediaContent(contents)
	}
}

// collectImageParts returns the (message, part) positions and URLs of every
// image part in the request.
func collectImageParts(req *dto.GeneralOpenAIRequest) []imageRef {
	var refs []imageRef
	for mi := range req.Messages {
		contents := req.Messages[mi].ParseContent()
		for pi, part := range contents {
			if part.Type != dto.ContentTypeImageURL {
				continue
			}
			if img := part.GetImageMedia(); img != nil && img.Url != "" {
				refs = append(refs, imageRef{messageIdx: mi, partIdx: pi, url: img.Url})
			}
		}
	}
	return refs
}

// describeImage sends one image to the vision model and returns its text
// description. The sub-request runs through the full relay pipeline (channel
// selection, billing, response parsing) on an isolated gin context so the main
// request's context and response are never touched.
func describeImage(c *gin.Context, info *relaycommon.RelayInfo, setting *operation_setting.VisualFallbackSetting, imageURL string) (string, *types.NewAPIError) {
	visionReq := &dto.GeneralOpenAIRequest{
		Model: setting.Model,
		Messages: []dto.Message{
			{Role: "system", Content: setting.Prompt},
			{Role: "user", Content: []any{
				map[string]any{
					"type":     dto.ContentTypeImageURL,
					"image_url": map[string]any{"url": imageURL},
				},
			}},
		},
		Stream: common.GetPointer(false),
	}

	body, err := common.Marshal(visionReq)
	if err != nil {
		return "", types.NewError(fmt.Errorf("failed to build vision request: %w", err), types.ErrorCodeInvalidRequest)
	}

	subCtx, rec := newSubContext(c, body)

	retryParam := &service.RetryParam{
		Ctx:         subCtx,
		TokenGroup:  info.TokenGroup,
		ModelName:   setting.Model,
		RequestPath: subCtx.Request.URL.Path,
		Retry:       common.GetPointer(0),
	}
	channel, _, channelErr := service.CacheGetRandomSatisfiedChannel(retryParam)
	if channelErr != nil {
		return "", types.NewErrorWithStatusCode(
			fmt.Errorf("获取视觉模型 %s 的可用渠道失败: %s", setting.Model, channelErr.Error()),
			types.ErrorCodeGetChannelFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if channel == nil {
		return "", types.NewErrorWithStatusCode(
			fmt.Errorf("分组下不存在支持视觉模型 %s 的渠道", setting.Model),
			types.ErrorCodeGetChannelFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	if apiErr := middleware.SetupContextForSelectedChannel(subCtx, channel, setting.Model); apiErr != nil {
		return "", apiErr
	}

	// Run the full relay (validation → pricing → pre-consume → relay → settle)
	// against the isolated context; the response is captured by the recorder.
	Relay(subCtx, types.RelayFormatOpenAI)

	raw := bytes.TrimSpace(rec.Body.Bytes())
	if len(raw) == 0 {
		return "", types.NewError(fmt.Errorf("视觉模型返回了空响应"), types.ErrorCodeBadResponseBody)
	}

	var resp dto.OpenAITextResponse
	if err := common.Unmarshal(raw, &resp); err != nil {
		return "", types.NewError(fmt.Errorf("解析视觉模型响应失败: %s", err.Error()), types.ErrorCodeBadResponseBody)
	}
	if oaiErr := resp.GetOpenAIError(); oaiErr != nil && oaiErr.Type != "" {
		return "", types.NewError(fmt.Errorf("视觉模型调用失败: %s", strings.TrimSpace(oaiErr.Message)), types.ErrorCodeBadResponseBody)
	}
	if len(resp.Choices) == 0 {
		return "", types.NewError(fmt.Errorf("视觉模型未返回有效内容"), types.ErrorCodeBadResponseBody)
	}
	desc := strings.TrimSpace(resp.Choices[0].Message.StringContent())
	if desc == "" {
		return "", types.NewError(fmt.Errorf("视觉模型返回了空描述"), types.ErrorCodeBadResponseBody)
	}
	return desc, nil
}

// newSubContext builds an isolated gin context for a sub-request: it copies the
// caller's identity keys (minus the cached request body, which is replaced by
// body) and captures the response into rec.
func newSubContext(c *gin.Context, body []byte) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	subCtx, _ := gin.CreateTestContext(rec)

	keys := make(map[string]any, len(c.Keys))
	for k, v := range c.Keys {
		if k == common.KeyBodyStorage {
			continue
		}
		keys[k] = v
	}
	subCtx.Keys = keys

	newReq := c.Request.Clone(c.Request.Context())
	newReq.Body = io.NopCloser(bytes.NewReader(body))
	newReq.ContentLength = int64(len(body))
	subCtx.Request = newReq
	return subCtx, rec
}
