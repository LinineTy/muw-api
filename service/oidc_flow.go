// @muw-owned
package service

import (
	"crypto/hmac"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/common"
) // OIDC 授权流程的浏览器绑定。
// 要解决的问题：/oauth/authorize 是浏览器直接跳转（站内的会话凭据是 JS 里的
// Bearer + 一个 Path=/api/user/auth 且 SameSite=Strict 的刷新 Cookie，授权端点
// 两者都拿不到），所以授权端点无法知道"是谁在发起"。而同意页是 SPA，带 Bearer，
// 知道当前账号。于是 A 发起的授权请求可以被 B 打开并点「允许」——签发的授权码会
// 绑到 B 的身份，而 code + PKCE verifier 在 A 手里，等于 A 拿到了 B 的身份信息。
//
// 做法：authorize 端点下发一个短寿命 HttpOnly Cookie（随机值），签名凭据里只放它的
// HMAC（凭据会出现在 URL 里，不能让它反过来暴露 Cookie）。同意页的两个接口都要求
// "Cookie 与凭据里的哈希对得上"，即必须是同一个浏览器走完这次流程。
const (
	// OIDCFlowCookieName 是授权流程的浏览器标识 Cookie。
	OIDCFlowCookieName = "new_api_oidc_flow"
	oidcFlowTTL        = 10 * time.Minute // 与授权请求凭据同寿命
	oidcFlowCookieMax  = 5                // 同一浏览器允许并存的未完成流程数
)

// OIDCIssueFlowCookie 生成本次流程的浏览器标识、写回 Cookie，并返回它的 HMAC
// （放进签名凭据的 flow_id_hash）。
func OIDCIssueFlowCookie(c *gin.Context) (string, error) {
	flowId, err := oidcRandomToken(16)
	if err != nil {
		return "", err
	}
	writeOIDCFlowCookie(c, mergeOIDCFlowCookie(c, flowId))
	return hashOIDCToken(flowId), nil
}

// OIDCFlowMatches 判断当前浏览器是否就是发起这次授权流程的那个。
func OIDCFlowMatches(c *gin.Context, expectedHash string) bool {
	if expectedHash == "" {
		return false
	}
	for _, id := range oidcFlowIds(c) {
		if hmac.Equal([]byte(hashOIDCToken(id)), []byte(expectedHash)) {
			return true
		}
	}
	return false
}

// mergeOIDCFlowCookie 把新流程追加进 Cookie（保留最近几个未完成的流程）：
// 同一浏览器可能同时开多个第三方登录，覆盖式写入会让前一个流程作废。
func mergeOIDCFlowCookie(c *gin.Context, flowId string) string {
	existing, _ := c.Cookie(OIDCFlowCookieName)
	ids := []string{flowId}
	for _, id := range strings.Split(existing, ".") {
		if id = strings.TrimSpace(id); id != "" && len(ids) < oidcFlowCookieMax {
			ids = append(ids, id)
		}
	}
	return strings.Join(ids, ".")
}

func oidcFlowIds(c *gin.Context) []string {
	raw, _ := c.Cookie(OIDCFlowCookieName)
	var out []string
	for _, id := range strings.Split(raw, ".") {
		if id = strings.TrimSpace(id); id != "" {
			out = append(out, id)
		}
	}
	return out
}

func writeOIDCFlowCookie(c *gin.Context, value string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     OIDCFlowCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   int(oidcFlowTTL.Seconds()),
		HttpOnly: true,
		Secure:   common.SessionCookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}
