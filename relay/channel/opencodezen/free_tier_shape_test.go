// @muw-owned
package opencodezen

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
)

// 带 tools 的请求走 CLI 对话形态，不得注入标题提示词；无 tools 的请求必须注入。
func TestInjectFreeTierPromptSkipsToolBearingRequests(t *testing.T) {
	withTools := &dto.GeneralOpenAIRequest{
		Messages: []dto.Message{{Role: "user", Content: "hi"}},
		Tools: []dto.ToolCallRequest{{
			Type:     "function",
			Function: dto.FunctionRequest{Name: "user_tool"},
		}},
	}
	injectFreeTierPromptOpenAI(withTools)
	for _, m := range withTools.Messages {
		if m.Role == "system" {
			t.Fatalf("带 tools 的请求不应注入标题提示词，实际注入了: %v", m.Content)
		}
	}

	withoutTools := &dto.GeneralOpenAIRequest{Messages: []dto.Message{{Role: "user", Content: "hi"}}}
	injectFreeTierPromptOpenAI(withoutTools)
	if len(withoutTools.Messages) != 2 || withoutTools.Messages[0].Role != "system" {
		t.Fatalf("无 tools 的请求应当注入标题提示词，实际: %+v", withoutTools.Messages)
	}
	if s, ok := withoutTools.Messages[0].Content.(string); !ok || !promptPresent(s) {
		t.Fatalf("注入的 system 不是标题提示词: %v", withoutTools.Messages[0].Content)
	}
}
