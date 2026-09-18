// @muw-owned
package opencodezen

import (
	"crypto/rand"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// OpenCode Zen 网关的客户端校验（2026-09-17 逐条实测；09-19 增补第三道）：
//
//	免费套餐只放行「看起来来自 opencode CLI」的请求，判据三条，缺一不可：
//	  1. 请求头：User-Agent 里的版本号 + x-opencode-client / x-opencode-project /
//	     x-opencode-request / x-opencode-session。乱填 id（长度或字符集对不上）会被拒，
//	     陈旧 id 也会被拒 ⇒ 每次请求现算；UA 版本号实测有下限：写 opencode/1.0.0 返回
//	     426 UpgradeRequired（"OpenCode 1.17.0 or newer is required to use the free tier"）。
//	  2. 请求体必须 stream:true —— 非流式一律 403 FreeTierError，与 Accept 头无关
//	     （带 Accept: text/event-stream 的非流式请求同样 403）。
//	  3. system 上下文必须含 opencode CLI 的真实内置提示词（子串匹配）——
//	     见 free_tier_prompt.go，注入逻辑也在那里。
//
// 所以这里负责补客户端头；非流式请求由 adaptor.ensureFreeTierStreaming 提前拦下并给出人话。

// clientUserAgent 里的版本号取 opencode 发布版（写这份时 npm 上 opencode-ai 最新为 1.18.31）。
// 上游抬版本门槛时会返回 426 并告知最低版本，届时只改这一行。
const clientUserAgent = "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14"

const (
	clientName    = "cli"
	clientProject = "global"
)

// idAlphabet / idRandomLen 与 opencode CLI 的实现保持一致（base62、14 位）。
const (
	idAlphabet  = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	idRandomLen = 14
	hexDigits   = "0123456789abcdef"
)

// idCounter 对应 CLI 里「同一毫秒内自增」的计数器，取低 12 位塞进 id 低位。
var idCounter atomic.Uint64

// applyClientHeaders 补齐 opencode CLI 的客户端头。
// 这些头不含任何密钥，鉴权仍然走 Authorization（免费套餐 = Bearer public，见 resolveApiKey）。
// 注意：渠道级「请求头覆盖」会在此之后应用并优先，所以别在这几个头（尤其 UA 与两个 id）上
// 配静态覆盖值 —— 静态值会过期，过期 id 会被上游拒。
func applyClientHeaders(req *http.Header) {
	if req == nil {
		return
	}
	req.Set("User-Agent", clientUserAgent)
	req.Set("x-opencode-client", clientName)
	req.Set("x-opencode-project", clientProject)
	req.Set("x-opencode-request", newClientID("msg_", false))
	req.Set("x-opencode-session", newClientID("ses_", true))
}

// newClientID 生成 opencode 形态的 id：msg_/ses_ + 12 位十六进制 + 14 位 base62 随机串。
func newClientID(prefix string, descending bool) string {
	counter := idCounter.Add(1) & 0xfff
	if counter == 0 {
		// CLI 的计数器从 1 起，不会出现 0（避免与"没有计数器"的形态重合）
		counter = 1
	}
	return prefix + clientIDTimePart(time.Now().UnixMilli(), counter, descending) + clientIDRandomPart()
}

// clientIDTimePart 复刻 opencode CLI 的 Identifier 算法：
// v = 毫秒时间戳<<12 | 计数器，会话 id 再按位取反，最后取低 48 位（6 字节 → 12 位十六进制）。
func clientIDTimePart(tsMillis int64, counter uint64, descending bool) string {
	v := uint64(tsMillis)<<12 | (counter & 0xfff)
	if descending {
		v = ^v
	}
	var sb strings.Builder
	for i := 0; i < 6; i++ {
		b := byte(v >> (40 - 8*i) & 0xff)
		sb.WriteByte(hexDigits[b>>4])
		sb.WriteByte(hexDigits[b&0x0f])
	}
	return sb.String()
}

func clientIDRandomPart() string {
	buf := make([]byte, idRandomLen)
	if _, err := rand.Read(buf); err != nil {
		// 随机源不可用时退化成全 '0'：格式依旧合法（上游只校验形态与新鲜度）
		clear(buf)
	}
	out := make([]byte, idRandomLen)
	for i, b := range buf {
		out[i] = idAlphabet[int(b)%len(idAlphabet)]
	}
	return string(out)
}

// isFreeTier 判断该请求是否走免费套餐：渠道没配密钥时 resolveApiKey 兜底成 public。
func isFreeTier(info *relaycommon.RelayInfo) bool {
	return resolveApiKey(info) == PublicApiKey
}
