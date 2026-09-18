// @muw-owned
package opencodezen

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
)

// 上游 free tier 要求 system 上下文包含 CLI 真实提示词（free_tier_prompt.go）。
// 注入后请求必须同时满足：提示词原样在场（子串匹配）+ 用户自己的 system 不丢。

func TestInjectOpenAIPrependsCLISystem(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "system", Content: "You are a helpful assistant."},
		{Role: "user", Content: "hi"},
	}}
	injectFreeTierPromptOpenAI(req)
	if len(req.Messages) != 3 {
		t.Fatalf("期望 3 条消息，实际 %d", len(req.Messages))
	}
	first, _ := req.Messages[0].Content.(string)
	if req.Messages[0].Role != "system" || !promptPresent(first) {
		t.Fatalf("第一条应为 CLI system，实际 %q", first)
	}
	if s, _ := req.Messages[1].Content.(string); s != "You are a helpful assistant." {
		t.Fatalf("用户 system 应原样保留，实际 %q", s)
	}
}

func TestInjectOpenAISkipsWhenAlreadyPresent(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "system", Content: freeTierSystemPrompt},
		{Role: "user", Content: "hi"},
	}}
	injectFreeTierPromptOpenAI(req)
	if len(req.Messages) != 2 {
		t.Fatalf("已含提示词时不应重复注入，实际 %d 条", len(req.Messages))
	}
}

func TestInjectClaudeStringSystemConcatenates(t *testing.T) {
	req := &dto.ClaudeRequest{System: "You are a helpful assistant."}
	injectFreeTierPromptClaude(req)
	s, ok := req.System.(string)
	if !ok || !strings.HasPrefix(s, freeTierSystemPrompt) || !strings.Contains(s, "helpful assistant") {
		t.Fatalf("拼接形态不符：%#v", req.System)
	}
	injectFreeTierPromptClaude(req)
	if s, _ := req.System.(string); strings.Count(s, freeTierSystemPrompt) != 1 {
		t.Fatal("重复注入：提示词出现多次")
	}
}

func TestInjectClaudeBlockSystemPrependsTextBlock(t *testing.T) {
	req := &dto.ClaudeRequest{System: []any{map[string]any{"type": "text", "text": "be nice"}}}
	injectFreeTierPromptClaude(req)
	arr, ok := req.System.([]any)
	if !ok || len(arr) != 2 {
		t.Fatalf("块形态应前置一个 text block，实际 %#v", req.System)
	}
	blk, _ := arr[0].(map[string]any)
	if blk["type"] != "text" || !promptPresent(blk["text"].(string)) {
		t.Fatalf("前置块形态不符：%#v", blk)
	}
}

func TestInjectClaudeNilSystem(t *testing.T) {
	req := &dto.ClaudeRequest{}
	injectFreeTierPromptClaude(req)
	if s, ok := req.System.(string); !ok || s != freeTierSystemPrompt {
		t.Fatalf("空 system 应直接置为提示词，实际 %#v", req.System)
	}
}

func TestInjectResponsesInstructions(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{}
	injectFreeTierPromptResponses(req)
	var s string
	if err := json.Unmarshal(req.Instructions, &s); err != nil || s != freeTierSystemPrompt {
		t.Fatalf("空 instructions 应置为提示词 JSON，实际 %s", string(req.Instructions))
	}
	req2 := &dto.OpenAIResponsesRequest{Instructions: json.RawMessage(`"be brief"`)}
	injectFreeTierPromptResponses(req2)
	if err := json.Unmarshal(req2.Instructions, &s); err != nil || !strings.HasPrefix(s, freeTierSystemPrompt) {
		t.Fatalf("字符串 instructions 应前置拼接，实际 %s", string(req2.Instructions))
	}
}

func TestInjectGeminiPrependsPart(t *testing.T) {
	req := &dto.GeminiChatRequest{}
	injectFreeTierPromptGemini(req)
	if req.SystemInstructions == nil || len(req.SystemInstructions.Parts) != 1 {
		t.Fatalf("空 systemInstruction 应建单 part，实际 %#v", req.SystemInstructions)
	}
	req2 := &dto.GeminiChatRequest{SystemInstructions: &dto.GeminiChatContent{
		Parts: []dto.GeminiPart{{Text: "be nice"}},
	}}
	injectFreeTierPromptGemini(req2)
	if len(req2.SystemInstructions.Parts) != 2 || req2.SystemInstructions.Parts[0].Text != freeTierSystemPrompt {
		t.Fatalf("应前置 CLI part，实际 %#v", req2.SystemInstructions.Parts)
	}
}

func TestFreeTierPromptUnchanged(t *testing.T) {
	// 提示词是上游指纹匹配的依据，必须与实测版本逐字节一致（含首尾空白）。
	// 若确认要换新版 CLI 的提示词，走「整段替换 + 上游真实链路复测」，不要微调措辞。
	const fingerprint = "You are a title generator."
	if !strings.HasPrefix(freeTierSystemPrompt, fingerprint) {
		t.Fatalf("提示词开头变了：%q", freeTierSystemPrompt[:30])
	}
	if !strings.HasSuffix(freeTierSystemPrompt, "</examples>\n") {
		t.Fatalf("提示词结尾变了：%q", freeTierSystemPrompt[len(freeTierSystemPrompt)-30:])
	}
}
