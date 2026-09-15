/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestContextWindowErrorLimit 保护上下文窗口判定：估算输入 + max_tokens 超过
// 上限则 400 拒绝，等于上限不拒绝。
func TestContextWindowErrorLimit(t *testing.T) {
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-4o"}
	tests := []struct {
		name      string
		prompt    int
		maxTokens int
		limit     int
		wantErr   bool
	}{
		{name: "under limit", prompt: 100, maxTokens: 50, limit: 200, wantErr: false},
		{name: "exact limit is allowed", prompt: 100, maxTokens: 50, limit: 150, wantErr: false},
		{name: "over limit", prompt: 100, maxTokens: 50, limit: 140, wantErr: true},
		{name: "no max tokens but input over", prompt: 150, maxTokens: 0, limit: 100, wantErr: true},
		// limit<=0 由调用方（CheckModelContextWindow / CheckChannelContextWindow）短路，
		// contextWindowError 本身按 total > limit 判定。
		{name: "zero limit treated as over", prompt: 150, maxTokens: 100, limit: 0, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			meta := &types.TokenCountMeta{MaxTokens: tt.maxTokens}
			err := contextWindowError(info, meta, tt.prompt, tt.limit, true, false)
			if tt.wantErr {
				require.NotNil(t, err)
				assert.Equal(t, http.StatusBadRequest, err.StatusCode)
				assert.Equal(t, types.ErrorCodeContextWindowExceeded, err.GetErrorCode())
			} else {
				assert.Nil(t, err)
			}
		})
	}
}

// TestContextWindowErrorSkipRetryFlag 保护模型级检查带 SkipRetry（同一模型所有渠道
// 限制一致，无需重试）、渠道级检查不带（其他渠道可能有更大覆盖，允许重试）。
func TestContextWindowErrorSkipRetryFlag(t *testing.T) {
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-4o"}
	meta := &types.TokenCountMeta{MaxTokens: 50}

	withSkip := contextWindowError(info, meta, 200, 100, true, false)
	require.NotNil(t, withSkip)
	assert.True(t, types.IsSkipRetryError(withSkip))

	withoutSkip := contextWindowError(info, meta, 200, 100, false, false)
	require.NotNil(t, withoutSkip)
	assert.False(t, types.IsSkipRetryError(withoutSkip))
}

// TestEstimateTokensForContext 保护上下文校验的估算内核：文本按 rune 计数，
// OpenAI 格式叠加工具/消息/名称结构化加成。
func TestEstimateTokensForContext(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	meta := &types.TokenCountMeta{
		TokenType:     types.TokenTypeTextNumber,
		CombineText:   "abcdefghijk", // 11 runes
		ToolsCount:    2,
		MessagesCount: 3,
		NameCount:     1,
	}
	info := &relaycommon.RelayInfo{RelayFormat: types.RelayFormatOpenAI}
	// 11 + 2*8 + 3*3 + 1*3 + 3 = 42
	assert.Equal(t, 42, estimateTokensForContext(c, meta, info))

	// 非 OpenAI 格式不加结构化加成
	infoClaude := &relaycommon.RelayInfo{}
	assert.Equal(t, 11, estimateTokensForContext(c, meta, infoClaude))

	// nil meta 不 panic
	assert.Equal(t, 0, estimateTokensForContext(c, nil, info))
}
