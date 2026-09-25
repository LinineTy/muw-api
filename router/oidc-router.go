// @muw-owned
package router

import (
	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/controller"
)

// SetOIDCRouter 注册 OIDC Provider 的协议端点。这些路径必须显式注册：
// 未注册的路径会落进 /api 的 NoRoute 兜底或前端回退，第三方拿到的是 404 / HTML。
func SetOIDCRouter(router *gin.Engine) {
	router.GET("/.well-known/openid-configuration", controller.OIDCDiscovery)
	router.GET("/oauth/jwks.json", controller.OIDCJWKS)
	router.GET("/oauth/authorize", controller.OIDCAuthorize)
	router.POST("/oauth/token", controller.OIDCToken)
	router.GET("/oauth/userinfo", controller.OIDCUserInfo)
	router.POST("/oauth/userinfo", controller.OIDCUserInfo)
	router.POST("/oauth/revoke", controller.OIDCRevoke)
}
