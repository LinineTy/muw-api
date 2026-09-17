package opencodezen

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/gemini"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	kitreasoning "github.com/QuantumNous/new-api/relaykit/relayconvert/reasoning"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

// Adaptor 适配 OpenCode Zen (https://opencode.ai/zen)。
//
// 密钥规则：
//   - 渠道未填密钥（免费套餐）：请求头统一使用 Bearer public 匿名访问；
//   - 渠道填写了密钥（付费套餐）：请求头使用填写的密钥。
type Adaptor struct {
	openaiAdaptor openai.Adaptor
	claudeAdaptor claude.Adaptor
	geminiAdaptor gemini.Adaptor
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
	a.openaiAdaptor.Init(info)
	a.claudeAdaptor.Init(info)
	a.geminiAdaptor.Init(info)
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return relaycommon.GetFullRequestURL(info.ChannelBaseUrl, info.RequestURLPath, info.ChannelType), nil
}

// resolveApiKey 返回实际发送给上游的密钥：填了用填的，没填用 public。
func resolveApiKey(info *relaycommon.RelayInfo) string {
	if info == nil {
		return PublicApiKey
	}
	if key := strings.TrimSpace(info.ApiKey); key != "" {
		return key
	}
	return PublicApiKey
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	apiKey := resolveApiKey(info)
	req.Set("Authorization", "Bearer "+apiKey)
	// 免费套餐的客户端校验：补齐 opencode CLI 的 UA 与 x-opencode-* 头（每次现算 id）。
	// 付费钥匙也一起带上：这些头不含密钥，带上只会让请求更"像走 CLI"，不影响正常鉴权。
	applyClientHeaders(req)
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		req.Set("x-api-key", apiKey)
		if req.Get("anthropic-version") == "" {
			anthropicVersion := c.Request.Header.Get("anthropic-version")
			if anthropicVersion == "" {
				anthropicVersion = "2023-06-01"
			}
			req.Set("anthropic-version", anthropicVersion)
		}
	case types.RelayFormatGemini:
		req.Set("x-goog-api-key", apiKey)
	}
	return nil
}

// freeTierStreamOnlyMessage 免费套餐只收流式请求（上游硬校验），提前拦下并给出可操作提示，
// 免得把上游那句英文 403 直接丢给客户端。
const freeTierStreamOnlyMessage = "OpenCode Zen 免费套餐只接受流式请求：请开启 stream（渠道测试请勾选「流式测试」）"

// ensureFreeTierStreaming 免费套餐 + 非流式 → 直接拒绝（客户端错误，400）。
// 付费钥匙不拦：非流式在付费套餐上的行为我们没实测过，交给上游自己回话。
func ensureFreeTierStreaming(info *relaycommon.RelayInfo) error {
	if info == nil || info.IsStream || !isFreeTier(info) {
		return nil
	}
	return kitreasoning.AsClientError(errors.New(freeTierStreamOnlyMessage))
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if err := ensureFreeTierStreaming(info); err != nil {
		return nil, err
	}
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	if err := ensureFreeTierStreaming(info); err != nil {
		return nil, err
	}
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	if err := ensureFreeTierStreaming(info); err != nil {
		return nil, err
	}
	return request, nil
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if err := ensureFreeTierStreaming(info); err != nil {
		return nil, err
	}
	return request, nil
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if err := ensureFreeTierStreaming(info); err != nil {
		return nil, err
	}
	return request, nil
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, errors.New("endpoint not supported")
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("endpoint not supported")
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("endpoint not supported")
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		return a.claudeAdaptor.DoResponse(c, resp, info)
	case types.RelayFormatGemini:
		return a.geminiAdaptor.DoResponse(c, resp, info)
	default:
		return a.openaiAdaptor.DoResponse(c, resp, info)
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
