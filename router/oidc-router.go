// @muw-owned
package router

import (
	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
)

// SetOIDCRouter 注册 OIDC Provider 的协议端点。这些路径必须显式注册：
// 未注册的路径会落进 /api 的 NoRoute 兜底或前端回退，第三方拿到的是 404 / HTML。
// authorize/token/userinfo/revoke 挂 OIDCProtocolRateLimit：它们无需登录即可访问，
// /oauth/token 还会每次都做一次 bcrypt 客户端密钥校验。discovery 与 JWKS 不限流 ——
// 两者是可缓存（300s）的纯读公开文档，客户端库会按自己节奏拉取。
func SetOIDCRouter(router *gin.Engine) {
	limiter := middleware.OIDCProtocolRateLimit()
	router.GET("/.well-known/openid-configuration", controller.OIDCDiscovery)
	router.GET("/oauth/jwks.json", controller.OIDCJWKS)
	router.GET("/oauth/authorize", limiter, controller.OIDCAuthorize)
	router.POST("/oauth/token", limiter, controller.OIDCToken)
	router.GET("/oauth/userinfo", limiter, controller.OIDCUserInfo)
	router.POST("/oauth/userinfo", limiter, controller.OIDCUserInfo)
	router.POST("/oauth/revoke", limiter, controller.OIDCRevoke)
}
