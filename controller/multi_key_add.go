// @muw-owned
package controller

import "strings"

// parseMultiKeyInput 把「追加密钥」的输入拆成独立的密钥列表。
// 每个元素内部允许再含换行（用户从各处粘贴多把 key 的常见形态），逐把 TrimSpace 后丢弃空串。
//
// **只按换行拆**，不按空格/逗号/分号拆：
//   - 存储格式本身就是 `key1\nkey2`（GetKeys 按 \n 切），换行是唯一确定的分隔符；
//   - Vertex 之类的 key 是带空格与逗号的 JSON 串，按它们拆会静默把一把 key 切成几段
//     （报错会退化成"上游 401"，比"少粘一把"难查得多）。
//
// 也**不做去重**——去重要对照目标现有列表，由调用方判定。
func parseMultiKeyInput(input []string) []string {
	parsed := make([]string, 0, len(input))
	for _, raw := range input {
		for _, field := range strings.FieldsFunc(raw, isMultiKeyLineBreak) {
			key := strings.TrimSpace(field)
			if key != "" {
				parsed = append(parsed, key)
			}
		}
	}
	return parsed
}

func isMultiKeyLineBreak(r rune) bool {
	return r == '\n' || r == '\r'
}
