// @muw-owned
package opencodezen

import "github.com/QuantumNous/new-api/relaykit/dto"

// cliToolNames 是 opencode CLI 交给上游的完整工具名集合。
//
// 免费档上游按「工具名表单」判定请求是否来自 CLI（2026-09-22 逐项实测）：
//   - 带 tools 的请求：这整套名字必须齐全（schema 与 description 一律不看，空 schema 也放行），
//     缺任何一个都返回 403 FreeTierError；同时**不能**带 CLI 的标题提示词——提示词 + tools
//     同时出现同样 403（普通短 system 无妨），两套形态互斥；
//   - 不带 tools 的请求：必须像 CLI 的标题生成调用（见 free_tier_prompt.go 的提示词注入）。
//
// 所以调用方自带工具时，我们把缺的名字补上（空参数），让请求满足上游要求的那套形态。
var cliToolNames = []string{
	"bash", "edit", "glob", "grep", "read", "skill",
	"task", "todowrite", "webfetch", "websearch", "write",
}

// freeTierPlaceholderHint 是补位工具的说明，明确劝退模型调用：它们只为满足上游形态，
// 网关不会执行，调用方也没有实现。
const freeTierPlaceholderHint = "[placeholder for upstream compatibility — do not call]"

// padFreeTierTools 给带 tools 的免费档请求补齐 CLI 工具名（只补不删，调用方的工具保持在前）。
// 无 tools 的请求不动：那种请求走的是标题生成形态，补位反而会破坏它。
func padFreeTierTools(request *dto.GeneralOpenAIRequest) {
	if request == nil || len(request.Tools) == 0 {
		return
	}
	have := make(map[string]struct{}, len(request.Tools))
	for _, tool := range request.Tools {
		have[tool.Function.Name] = struct{}{}
	}
	for _, name := range cliToolNames {
		if _, ok := have[name]; ok {
			continue
		}
		request.Tools = append(request.Tools, dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name:        name,
				Description: freeTierPlaceholderHint,
				Parameters: map[string]any{
					"type":       "object",
					"properties": map[string]any{},
				},
			},
		})
	}
}
