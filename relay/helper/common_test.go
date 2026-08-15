package helper

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeSSEFrameSeparators(t *testing.T) {
	// 异常上游：帧间换行是字面 "\n\n"（backslash-n）。只还原帧间 "\n\ndata:"。
	in := `{"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]`
	want := "{\"a\":1}\n\ndata: {\"b\":2}\n\ndata: [DONE]"
	require.Equal(t, want, normalizeSSEFrameSeparators(in))

	// 帧内 JSON 转义的字面 "\n"（不紧跟 data:）保持不动，避免破坏 JSON 字符串。
	inJSON := `{"c":"x\ny"}\n\ndata: {"d":1}`
	wantJSON := "{\"c\":\"x\\ny\"}\n\ndata: {\"d\":1}"
	require.Equal(t, wantJSON, normalizeSSEFrameSeparators(inJSON))

	// 正常 SSE（真实换行帧间）原样返回。
	normal := "data: {\"a\":1}\n\ndata: {\"b\":2}"
	require.Equal(t, normal, normalizeSSEFrameSeparators(normal))
}
