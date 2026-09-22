// @muw-owned
package opencodezen

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
)

func TestPadFreeTierToolsFillsMissingCLINames(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{Tools: []dto.ToolCallRequest{
		{Type: "function", Function: dto.FunctionRequest{Name: "my_tool"}},
		{Type: "function", Function: dto.FunctionRequest{Name: "bash"}},
	}}
	padFreeTierTools(req)
	got := make(map[string]bool, len(req.Tools))
	for _, tool := range req.Tools {
		got[tool.Function.Name] = true
	}
	if !got["my_tool"] {
		t.Fatal("调用方自己的工具被弄丢了")
	}
	for _, name := range cliToolNames {
		if !got[name] {
			t.Fatalf("缺少 CLI 工具名 %s", name)
		}
	}
	if len(req.Tools) != len(cliToolNames)+1 {
		t.Fatalf("补位数量不对: %d", len(req.Tools))
	}
	if req.Tools[0].Function.Name != "my_tool" {
		t.Fatal("调用方的工具必须排在最前")
	}
	padFreeTierTools(req)
	if len(req.Tools) != len(cliToolNames)+1 {
		t.Fatalf("非幂等: %d", len(req.Tools))
	}
}

func TestPadFreeTierToolsLeavesToolLessRequestAlone(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{}
	padFreeTierTools(req)
	if len(req.Tools) != 0 {
		t.Fatal("无 tools 的请求不该补位（会破坏标题生成形态）")
	}
}
