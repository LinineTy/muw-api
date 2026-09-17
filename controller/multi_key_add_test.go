// @muw-owned
package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseMultiKeyInput(t *testing.T) {
	cases := []struct {
		name  string
		input []string
		want  []string
	}{
		{
			name:  "单把",
			input: []string{"sk-aaa"},
			want:  []string{"sk-aaa"},
		},
		{
			name:  "元素内换行（前端整块粘贴）",
			input: []string{"sk-aaa\nsk-bbb\nsk-ccc"},
			want:  []string{"sk-aaa", "sk-bbb", "sk-ccc"},
		},
		{
			name:  "CRLF 与多余空行",
			input: []string{"sk-aaa\r\n\r\nsk-bbb\r\n"},
			want:  []string{"sk-aaa", "sk-bbb"},
		},
		{
			name:  "多元素输入",
			input: []string{"sk-aaa", "sk-bbb\nsk-ccc"},
			want:  []string{"sk-aaa", "sk-bbb", "sk-ccc"},
		},
		{
			name:  "空白项丢弃",
			input: []string{"  ", "\n", "sk-aaa"},
			want:  []string{"sk-aaa"},
		},
		{
			// 只按换行拆：带空格/逗号的 key（Vertex service_account JSON、逗号分隔的粘贴）
			// 必须整把保留，否则会被切成几段，报错退化成"上游 401"
			name:  "带空格与逗号的 JSON key 不被切开",
			input: []string{`{"type": "service_account", "project_id": "p", "key": "x"}`},
			want:  []string{`{"type": "service_account", "project_id": "p", "key": "x"}`},
		},
		{
			name:  "去重用例交给调用方：本函数保留重复项",
			input: []string{"sk-aaa\nsk-aaa"},
			want:  []string{"sk-aaa", "sk-aaa"},
		},
		{
			name:  "空输入",
			input: nil,
			want:  []string{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, parseMultiKeyInput(tc.input))
		})
	}
}

func TestMultiKeyActionGuards(t *testing.T) {
	// 单密钥目标只放行只读查询与追加（追加第 2 把即转入多密钥模式）
	assert.True(t, multiKeyActionAllowedOnSingleKey("get_key_status"))
	assert.True(t, multiKeyActionAllowedOnSingleKey("add_key"))
	assert.False(t, multiKeyActionAllowedOnSingleKey("disable_key"))
	assert.False(t, multiKeyActionAllowedOnSingleKey("enable_key"))
	assert.False(t, multiKeyActionAllowedOnSingleKey("delete_key"))

	// 写入密钥类动作算敏感写：改 key 列表/删 key 需要 ChannelSensitiveWrite
	assert.True(t, multiKeyActionRequiresSensitiveWrite("add_key"))
	assert.True(t, multiKeyActionRequiresSensitiveWrite("delete_key"))
	assert.True(t, multiKeyActionRequiresSensitiveWrite("delete_disabled_keys"))
	assert.False(t, multiKeyActionRequiresSensitiveWrite("enable_key"))
	assert.False(t, multiKeyActionRequiresSensitiveWrite("disable_key"))
	assert.False(t, multiKeyActionRequiresSensitiveWrite("get_key_status"))
}
