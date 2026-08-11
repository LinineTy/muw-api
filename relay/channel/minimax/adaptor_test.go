package minimax

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

func TestGetRequestURLForImageGeneration(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesGenerations,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl: "https://api.minimax.chat",
		},
	}

	got, err := GetRequestURL(info)
	if err != nil {
		t.Fatalf("GetRequestURL returned error: %v", err)
	}

	want := "https://api.minimax.chat/v1/image_generation"
	if got != want {
		t.Fatalf("GetRequestURL() = %q, want %q", got, want)
	}
}

func TestGetRequestURLForCodingPlanSymbol(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		baseUrl    string
		relayMode  int
		relayForm  types.RelayFormat
		want       string
	}{
		{
			name:      "minimax coding plan CN chat",
			baseUrl:   "minimax-coding-plan",
			relayMode: relayconstant.RelayModeChatCompletions,
			relayForm: types.RelayFormatOpenAI,
			want:      "https://api.minimaxi.com/v1/chat/completions",
		},
		{
			name:      "minimax coding plan international chat",
			baseUrl:   "minimax-coding-plan-international",
			relayMode: relayconstant.RelayModeChatCompletions,
			relayForm: types.RelayFormatOpenAI,
			want:      "https://api.minimax.io/v1/chat/completions",
		},
		{
			name:      "minimax coding plan claude",
			baseUrl:   "minimax-coding-plan",
			relayMode: relayconstant.RelayModeChatCompletions,
			relayForm: types.RelayFormatClaude,
			want:      "https://api.minimaxi.com/anthropic/v1/messages",
		},
		{
			// 完整 Anthropic 端点(带 /v1/messages):原样透传,不自动拼路径(与 Custom 渠道同款)。
			name:      "minimax anthropic full endpoint passthrough",
			baseUrl:   "https://api.minimaxi.com/anthropic/v1/messages",
			relayMode: relayconstant.RelayModeChatCompletions,
			relayForm: types.RelayFormatClaude,
			want:      "https://api.minimaxi.com/anthropic/v1/messages",
		},
		{
			name:      "minimax anthropic international full endpoint passthrough",
			baseUrl:   "https://api.minimax.io/anthropic/v1/messages",
			relayMode: relayconstant.RelayModeChatCompletions,
			relayForm: types.RelayFormatClaude,
			want:      "https://api.minimax.io/anthropic/v1/messages",
		},
		{
			// OpenAI 格式请求打到完整 Anthropic 端点:URL 仍走 /v1/messages(格式转换
			// 由 ConvertOpenAIRequest 负责),不能把 OpenAI 路径拼上去 404。
			name:      "minimax anthropic full endpoint openai format",
			baseUrl:   "https://api.minimaxi.com/anthropic/v1/messages",
			relayMode: relayconstant.RelayModeChatCompletions,
			relayForm: types.RelayFormatOpenAI,
			want:      "https://api.minimaxi.com/anthropic/v1/messages",
		},
		{
			// anthropic 路径基址(未带 /v1/messages):补齐 /v1/messages,不双重拼接。
			name:      "minimax anthropic base claude",
			baseUrl:   "https://api.minimaxi.com/anthropic",
			relayMode: relayconstant.RelayModeChatCompletions,
			relayForm: types.RelayFormatClaude,
			want:      "https://api.minimaxi.com/anthropic/v1/messages",
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			info := &relaycommon.RelayInfo{
				RelayMode:  tc.relayMode,
				RelayFormat: tc.relayForm,
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelBaseUrl: tc.baseUrl,
				},
			}
			got, err := GetRequestURL(info)
			if err != nil {
				t.Fatalf("GetRequestURL returned error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("GetRequestURL() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestConvertImageRequest(t *testing.T) {
	t.Parallel()

	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeImagesGenerations,
		OriginModelName: "image-01",
	}
	request := dto.ImageRequest{
		Model:          "image-01",
		Prompt:         "a red fox in snowfall",
		Size:           "1536x1024",
		ResponseFormat: "url",
		N:              uintPtr(2),
	}

	got, err := adaptor.ConvertImageRequest(gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()), info, request)
	if err != nil {
		t.Fatalf("ConvertImageRequest returned error: %v", err)
	}

	body, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}

	if payload["model"] != "image-01" {
		t.Fatalf("model = %#v, want %q", payload["model"], "image-01")
	}
	if payload["prompt"] != request.Prompt {
		t.Fatalf("prompt = %#v, want %q", payload["prompt"], request.Prompt)
	}
	if payload["n"] != float64(2) {
		t.Fatalf("n = %#v, want 2", payload["n"])
	}
	if payload["aspect_ratio"] != "3:2" {
		t.Fatalf("aspect_ratio = %#v, want %q", payload["aspect_ratio"], "3:2")
	}
	if payload["response_format"] != "url" {
		t.Fatalf("response_format = %#v, want %q", payload["response_format"], "url")
	}
}

func TestDoResponseForImageGeneration(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeImagesGenerations,
		StartTime: time.Unix(1700000000, 0),
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       httptest.NewRecorder().Result().Body,
	}
	resp.Body = ioNopCloser(`{"data":{"image_urls":["https://example.com/minimax.png"]}}`)

	adaptor := &Adaptor{}
	usage, err := adaptor.DoResponse(c, resp, info)
	if err != nil {
		t.Fatalf("DoResponse returned error: %v", err)
	}
	if usage == nil {
		t.Fatalf("DoResponse returned nil usage")
	}

	body := recorder.Body.String()
	if !strings.Contains(body, `"url":"https://example.com/minimax.png"`) {
		t.Fatalf("response body = %s, want OpenAI image response with image URL", body)
	}
	if strings.Contains(body, `"image_urls"`) {
		t.Fatalf("response body = %s, should not expose raw MiniMax image_urls payload", body)
	}
}

type nopReadCloser struct {
	*strings.Reader
}

func (n nopReadCloser) Close() error {
	return nil
}

func ioNopCloser(body string) nopReadCloser {
	return nopReadCloser{Reader: strings.NewReader(body)}
}

func uintPtr(v uint) *uint {
	return &v
}
