// @muw-owned
package opencodezen

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	kitreasoning "github.com/QuantumNous/new-api/relaykit/relayconvert/reasoning"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 时间部分的测试向量来自 opencode CLI 的 Original Identifier 实现（帖子里的 js gen()），
// 用同一算法在 Node/浏览器控制台里跑出来的值 —— 改算法就是改这里，别只改一边。
func TestClientIDTimePart(t *testing.T) {
	cases := []struct {
		name       string
		tsMillis   int64
		counter    uint64
		descending bool
		want       string
	}{
		{name: "消息 id（升序）", tsMillis: 1789660428000, counter: 1, descending: false, want: "0b012f6e0001"},
		{name: "会话 id（取反）", tsMillis: 1789660428000, counter: 1, descending: true, want: "f4fed091fffe"},
		{name: "同毫秒内计数器自增", tsMillis: 1789660428000, counter: 2, descending: false, want: "0b012f6e0002"},
		{name: "取反也随计数器变化", tsMillis: 1789660428000, counter: 2, descending: true, want: "f4fed091fffd"},
		{name: "另一个时间点", tsMillis: 1700000000000, counter: 1, descending: false, want: "bcfe56800001"},
		{name: "另一个时间点（取反）", tsMillis: 1700000000000, counter: 1, descending: true, want: "4301a97ffffe"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, clientIDTimePart(tc.tsMillis, tc.counter, tc.descending))
		})
	}
}

func TestNewClientIDFormat(t *testing.T) {
	msgID := newClientID("msg_", false)
	sesID := newClientID("ses_", true)

	for _, id := range []string{msgID, sesID} {
		require.True(t, strings.HasPrefix(id, "msg_") || strings.HasPrefix(id, "ses_"))
		// 4 位前缀（msg_/ses_）+ 12 位十六进制 + 14 位随机 = 30
		assert.Len(t, id, 30, "id 形态必须与 CLI 一致：%s", id)
		body := id[4:]
		for _, r := range body[:12] {
			assert.Contains(t, hexDigits, string(r), "时间部分必须是十六进制：%s", id)
		}
		for _, r := range body[12:] {
			assert.Contains(t, idAlphabet, string(r), "随机部分必须是 base62：%s", id)
		}
	}

	assert.NotEqual(t, msgID, sesID)
	// 每次现算：连续两次请求不允许拿到同一个 id（陈旧 id 会被上游拒）
	assert.NotEqual(t, msgID, newClientID("msg_", false))
}

func TestApplyClientHeaders(t *testing.T) {
	header := http.Header{}
	applyClientHeaders(&header)

	assert.Equal(t, clientUserAgent, header.Get("User-Agent"))
	assert.Equal(t, clientName, header.Get("x-opencode-client"))
	assert.Equal(t, clientProject, header.Get("x-opencode-project"))
	assert.True(t, strings.HasPrefix(header.Get("x-opencode-request"), "msg_"))
	assert.True(t, strings.HasPrefix(header.Get("x-opencode-session"), "ses_"))
	// 头里不能夹带密钥：鉴权只走 Authorization
	for _, value := range header {
		assert.NotContains(t, strings.Join(value, " "), "Bearer")
	}
}

// 上游会用 UA 里的版本号做下限校验：实测 opencode/1.0.0 拿到 426 UpgradeRequired
// （"OpenCode 1.17.0 or newer is required to use the free tier"）。
// 这条测试替我们把门槛守住，免得有人把版本号写旧。
func TestClientUserAgentVersionMeetsUpstreamFloor(t *testing.T) {
	const upstreamFloor = "1.17.0"

	parts := strings.Fields(clientUserAgent)
	require.NotEmpty(t, parts)
	require.True(t, strings.HasPrefix(parts[0], "opencode/"), "UA 必须自报 opencode：%s", clientUserAgent)
	version := strings.TrimPrefix(parts[0], "opencode/")

	assert.GreaterOrEqual(t, compareSemver(version, upstreamFloor), 0,
		"UA 版本 %s 低于上游要求的 %s：Zen 会回 426", version, upstreamFloor)
}

func TestEnsureFreeTierStreaming(t *testing.T) {
	freeTier := func(isStream bool) *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{ApiKey: ""},
			IsStream:    isStream,
		}
	}
	paidTier := func(isStream bool) *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "oc_zen_secret"},
			IsStream:    isStream,
		}
	}

	t.Run("免费套餐 + 非流式：拒绝，且按客户端错误处理（400 而不是 500）", func(t *testing.T) {
		err := ensureFreeTierStreaming(freeTier(false))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "只接受流式请求")
		assert.True(t, kitreasoning.IsClientError(err), "必须走 400 映射，否则前端只会看到 500")
	})

	t.Run("免费套餐 + 流式：放行", func(t *testing.T) {
		assert.NoError(t, ensureFreeTierStreaming(freeTier(true)))
	})

	t.Run("付费钥匙 + 非流式：不拦（行为交上游决定）", func(t *testing.T) {
		assert.NoError(t, ensureFreeTierStreaming(paidTier(false)))
	})

	t.Run("info 为空：不 panic 也不拦", func(t *testing.T) {
		assert.NoError(t, ensureFreeTierStreaming(nil))
	})
}

// compareSemver 只比较 major.minor.patch，用于守着 UA 版本门槛。
func compareSemver(a, b string) int {
	parse := func(s string) [3]int {
		var out [3]int
		for i, part := range strings.SplitN(strings.SplitN(s, "-", 2)[0], ".", 3) {
			out[i], _ = strconv.Atoi(part)
		}
		return out
	}
	av, bv := parse(a), parse(b)
	for i := 0; i < 3; i++ {
		if av[i] != bv[i] {
			return av[i] - bv[i]
		}
	}
	return 0
}
