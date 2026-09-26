// @muw-owned
package oauth

import (
	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
)

// PKCEFlow 保存一次授权流程的客户端 PKCE 密钥。它只存在服务端（随 state 一起落库），
// 浏览器只拿到派生的 code_challenge。
type PKCEFlow struct {
	CodeVerifier string `json:"code_verifier"`
}

// PKCEVerifierContextKey 让 provider 在回调换 token 时取回本次流程的 verifier。
const PKCEVerifierContextKey = "oauth_pkce_verifier"

// NewPKCEFlow 生成一个 43~128 字符的 verifier（RFC 7636）。
func NewPKCEFlow() *PKCEFlow {
	return &PKCEFlow{CodeVerifier: oauth2.GenerateVerifier()}
}

// Challenge 返回 S256 challenge；没有流程时返回空串，调用方据此决定是否带上 PKCE 参数。
func (flow *PKCEFlow) Challenge() string {
	if flow == nil || flow.CodeVerifier == "" {
		return ""
	}
	return oauth2.S256ChallengeFromVerifier(flow.CodeVerifier)
}

// SupportsPKCE 判断该 provider 是否需要我们作为客户端发起 PKCE：
// 自定义 OAuth 与内置 OIDC 会校验 PKCE；其它内置 provider 不支持，带上反而多余。
func SupportsPKCE(provider Provider) bool {
	switch provider.(type) {
	case *GenericOAuthProvider, *OIDCProvider:
		return true
	}
	return false
}

// WithPKCEVerifier 把 verifier 挂到本次请求上下文，供 provider 换取 token 时使用。
func WithPKCEVerifier(c *gin.Context, flow *PKCEFlow) {
	if c == nil || flow == nil || flow.CodeVerifier == "" {
		return
	}
	c.Set(PKCEVerifierContextKey, flow.CodeVerifier)
}

// PKCEVerifier 取出本次流程的 verifier；没有则返回空串。
func PKCEVerifier(c *gin.Context) string {
	if c == nil {
		return ""
	}
	value, ok := c.Get(PKCEVerifierContextKey)
	if !ok {
		return ""
	}
	verifier, _ := value.(string)
	return verifier
}
