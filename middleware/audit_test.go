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
package middleware

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveAuditActionNamed(t *testing.T) {
	// 已适配的管理写路由解析为命名 action，并把路由参数(如 :id)带进 op.params，
	// 前端模板可据此引用 {{id}} 展示被操作的资源。
	action, params := resolveAuditAction("DELETE", "/api/subscription/admin/plans/:id", map[string]string{"id": "7"})
	assert.Equal(t, "subscription.plan_delete", action)
	require.Contains(t, params, "id")
	assert.Equal(t, "7", params["id"])

	action, params = resolveAuditAction("POST", "/api/channel/:id/codex/refresh", map[string]string{"id": "42"})
	assert.Equal(t, "channel.codex_refresh", action)
	require.Contains(t, params, "id")
	assert.Equal(t, "42", params["id"])
}

func TestResolveAuditActionNamedNoParams(t *testing.T) {
	// 命名 action 但路由无参数时，op.params 保持空 map（nil 与空 map 等价，
	// 前端渲染不依赖它）。
	action, params := resolveAuditAction("POST", "/api/ratio_sync/fetch", nil)
	assert.Equal(t, "ratio_sync.fetch", action)
	assert.Empty(t, params)
}

func TestResolveAuditActionGeneric(t *testing.T) {
	// 未适配的写路由回退 generic，op.params 携带 method/route 供前端展示原始路由。
	action, params := resolveAuditAction("POST", "/api/some/unknown/write", nil)
	assert.Equal(t, "generic", action)
	assert.Equal(t, "POST", params["method"])
	assert.Equal(t, "/api/some/unknown/write", params["route"])
}

func TestAuditResponseSuccess(t *testing.T) {
	// 依据响应体 success 字段判定业务成败（HTTP 200 + success:false 视为失败）。
	assert.False(t, auditResponseSuccess(200, []byte(`{"success":false,"message":"nope"}`)))
	assert.True(t, auditResponseSuccess(200, []byte(`{"success":true}`)))
	assert.True(t, auditResponseSuccess(204, []byte(``)))
	// 非 JSON 响应退回到状态码判断。
	assert.False(t, auditResponseSuccess(500, []byte(`oops`)))
	assert.True(t, auditResponseSuccess(200, []byte(`plain text`)))
}
