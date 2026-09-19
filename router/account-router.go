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
package router

import (
	"net/http"

	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
)

// registerAccountRoutes 账户管理路由（凭证与渠道解耦）。权限复用渠道体系：
// 账户是渠道凭证的载体，读写敏感度与渠道一致。
func registerAccountRoutes(apiRouter *gin.RouterGroup) {
	accountRoute := apiRouter.Group("/account")
	accountRoute.Use(middleware.AdminAuth())

	// 账户密钥明文：Root + 安全验证（高危审计）。
	accountRoute.GET("/:id/key",
		middleware.RootAuth(),
		middleware.CriticalRateLimit(),
		middleware.DisableCache(),
		middleware.SecureVerificationRequired(),
		controller.GetAccountKey,
	)

	type route struct {
		method     string
		path       string
		permission authz.Permission
		handler    gin.HandlerFunc
	}
	routes := []route{
		{method: http.MethodGet, path: "/", permission: authz.ChannelRead, handler: controller.GetAllAccounts},
		{method: http.MethodGet, path: "/:id", permission: authz.ChannelRead, handler: controller.GetAccount},
		{method: http.MethodGet, path: "/:id/channels", permission: authz.ChannelRead, handler: controller.ListAccountChannelRefs},
		{method: http.MethodGet, path: "/:id/coding_plan/quota", permission: authz.ChannelRead, handler: controller.GetAccountCodingPlanQuota},
		// 账户余额：查上游并落库（写操作，权限与渠道侧 update_balance 对齐）。
		{method: http.MethodGet, path: "/:id/balance", permission: authz.ChannelOperate, handler: controller.UpdateAccountBalance},
		{method: http.MethodPost, path: "/", permission: authz.ChannelSensitiveWrite, handler: controller.AddAccount},
		{method: http.MethodPut, path: "/", permission: authz.ChannelSensitiveWrite, handler: controller.UpdateAccount},
		{method: http.MethodDelete, path: "/:id", permission: authz.ChannelSensitiveWrite, handler: controller.DeleteAccount},
		// 账户侧多密钥管理（账户抽屉入口）：复用渠道同款实现（controller.ManageMultiKeys），
		// account_id 放 body；权限与渠道侧 multi_key/manage 对齐。
		{method: http.MethodPost, path: "/multi_key/manage", permission: authz.ChannelOperate, handler: controller.ManageMultiKeys},
	}
	for _, r := range routes {
		accountRoute.Handle(r.method, r.path,
			middleware.RequirePermission(r.permission),
			r.handler,
		)
	}
}
