package middleware

import (
	"bytes"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// auditResponseWriter 包装 gin.ResponseWriter，捕获响应状态码并将响应体复制一份到
// 有限大小的缓冲区，用于判断业务是否成功（解析响应 JSON 的 success 字段）。
// 缓冲区有上限，避免大响应（如密钥导出）占用过多内存；超出上限则不再缓存，
// 此时仅依据 HTTP 状态码判断成败。
type auditResponseWriter struct {
	gin.ResponseWriter
	body    *bytes.Buffer
	maxSize int
}

func (w *auditResponseWriter) Write(b []byte) (int, error) {
	if w.body.Len() < w.maxSize {
		remain := w.maxSize - w.body.Len()
		if remain >= len(b) {
			w.body.Write(b)
		} else {
			w.body.Write(b[:remain])
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *auditResponseWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

// auditRouteActions 将「METHOD + 路由模板」映射为语言无关的操作标识 action。
// 这些是未被 handler 手动埋点的写操作，由中间件兜底记录；前端依据 action 用 i18n 本地化展示。
// 未命中的写操作回退为 action="generic"，前端展示 "METHOD route"。
var auditRouteActions = map[string]string{
	// 用户管理
	"POST /api/user/topup/complete":                    "user.topup_complete",
	"DELETE /api/user/:id/reset_passkey":               "user.reset_passkey",
	"DELETE /api/user/:id/oauth/bindings/:provider_id": "user.oauth_unbind",

	// 系统设置（root）
	"POST /api/option/rest_model_ratio":         "option.reset_ratio",
	"DELETE /api/option/channel_affinity_cache": "option.clear_affinity_cache",

	// 自定义 OAuth（root）
	"POST /api/custom-oauth-provider/":      "custom_oauth.create",
	"PUT /api/custom-oauth-provider/:id":    "custom_oauth.update",
	"DELETE /api/custom-oauth-provider/:id": "custom_oauth.delete",
	"POST /api/custom-oauth-provider/discovery": "custom_oauth.discovery",

	// 性能/缓存（root）
	"DELETE /api/performance/disk_cache": "performance.clear_disk_cache",
	"POST /api/performance/gc":           "performance.gc",
	"DELETE /api/performance/logs":       "performance.clear_logs",
	"POST /api/performance/reset_stats":  "performance.reset_stats",

	// 兑换码
	"PUT /api/redemption/":           "redemption.update",
	"DELETE /api/redemption/:id":     "redemption.delete",
	"DELETE /api/redemption/invalid": "redemption.delete_invalid",

	// 预填组
	"POST /api/prefill_group/":      "prefill_group.create",
	"PUT /api/prefill_group/":       "prefill_group.update",
	"DELETE /api/prefill_group/:id": "prefill_group.delete",

	// 供应商
	"POST /api/vendors/":      "vendor.create",
	"PUT /api/vendors/":       "vendor.update",
	"DELETE /api/vendors/:id": "vendor.delete",

	// 模型元数据
	"POST /api/models/":              "model.create",
	"PUT /api/models/":               "model.update",
	"DELETE /api/models/:id":         "model.delete",
	"POST /api/models/sync_upstream": "model.sync_upstream",

	// 订阅（管理员）
	"POST /api/subscription/admin/plans":    "subscription.plan_create",
	"PUT /api/subscription/admin/plans/:id": "subscription.plan_update",
	"POST /api/subscription/admin/bind":     "subscription.bind",
	// 订阅管理：计划状态/删除、用户订阅的新增/作废/删除/彻底清除
	"PATCH /api/subscription/admin/plans/:id":                    "subscription.plan_status_update",
	"DELETE /api/subscription/admin/plans/:id":                    "subscription.plan_delete",
	"POST /api/subscription/admin/users/:id/subscriptions":        "subscription.user_subscription_create",
	"POST /api/subscription/admin/user_subscriptions/:id/invalidate": "subscription.user_subscription_invalidate",
	"DELETE /api/subscription/admin/user_subscriptions/:id":       "subscription.user_subscription_delete",
	"POST /api/subscription/admin/user_subscriptions/:id/purge":   "subscription.user_subscription_purge",

	// 比率同步（root）
	"POST /api/ratio_sync/fetch": "ratio_sync.fetch",

	// 系统信息（root）
	"DELETE /api/system-info/stale-instances":      "system_info.delete_stale_instances",
	"DELETE /api/system-info/instances/:node_name": "system_info.delete_instance",

	// 图床图片（root）
	"POST /api/images/":    "image.upload",
	"DELETE /api/images/:id": "image.delete",

	// 日志
	"POST /api/system-task/log-cleanup": "log.cleanup_start",

	// 渠道：能力修复 / 拉取上游模型 / Codex / Ollama / 上游模型检测
	"POST /api/channel/fix":                     "channel.fix_abilities",
	"POST /api/channel/fetch_models":            "channel.fetch_models",
	"POST /api/channel/:id/codex/refresh":       "channel.codex_refresh",
	"POST /api/channel/:id/codex/usage/reset":   "channel.codex_reset_usage",
	"POST /api/channel/ollama/pull":             "channel.ollama_pull",
	"POST /api/channel/ollama/pull/stream":      "channel.ollama_pull_stream",
	"DELETE /api/channel/ollama/delete":         "channel.ollama_delete",
	"POST /api/channel/upstream_updates/detect": "channel.upstream_detect",
}

// beginAdminAudit 在管理/root 写操作进入 handler 前包装 ResponseWriter，
// 以便事后解析响应判断业务是否成功。仅对写方法（POST/PUT/PATCH/DELETE）生效；
// 只读请求返回 nil，调用方据此跳过事后兜底记录。
//
// 该函数由 authHelper 在鉴权通过、c.Next() 之前调用：因为任何管理/root 接口都
// 必然经过 AdminAuth/RootAuth，将审计兜底内聚到鉴权链路即可保证「新增接口自动留痕」，
// 无需在路由上再单独挂一层审计中间件（避免漏挂）。
func beginAdminAudit(c *gin.Context) *auditResponseWriter {
	method := c.Request.Method
	if method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
		return nil
	}
	writer := &auditResponseWriter{
		ResponseWriter: c.Writer,
		body:           bytes.NewBuffer(nil),
		maxSize:        64 * 1024,
	}
	c.Writer = writer
	return writer
}

// resolveAuditAction 将「METHOD + 路由模板」解析为审计 action 与 op.params：
// 命中 auditRouteActions 时返回命名 action 并携带路由参数(如 :id/:node_name)，
// 供前端模板引用 {{id}} 展示被操作的资源；未命中回退 action="generic"，
// 此时 op.params 携带 method/route，前端展示 "METHOD route"。
func resolveAuditAction(method, route string, routeParams map[string]string) (string, map[string]interface{}) {
	action := auditRouteActions[method+" "+route]
	opParams := map[string]interface{}{}
	if action == "" {
		action = "generic"
		opParams["method"] = method
		opParams["route"] = route
	} else if len(routeParams) > 0 {
		for k, v := range routeParams {
			opParams[k] = v
		}
	}
	return action, opParams
}

// finishAdminAudit 在 c.Next() 之后对管理/高危写操作做兜底审计记录。
// 若 handler 内已手动埋点（设置 ContextKeyAuditLogged），则跳过，避免重复。
func finishAdminAudit(c *gin.Context, writer *auditResponseWriter) {
	if writer == nil {
		return
	}
	method := c.Request.Method

	// handler 已手动记录更精细的审计日志，跳过兜底。
	if common.GetContextKeyBool(c, constant.ContextKeyAuditLogged) {
		return
	}

	operatorId := c.GetInt("id")
	operatorName := c.GetString("username")
	operatorRole := c.GetInt("role")
	ip := c.ClientIP()
	status := writer.Status()
	success := auditResponseSuccess(status, writer.body.Bytes())

	route := c.FullPath()
	routeParams := map[string]string{}
	for _, p := range c.Params {
		routeParams[p.Key] = p.Value
	}
	action, opParams := resolveAuditAction(method, route, routeParams)

	// content 为英文兜底文本（供导出等非本地化消费者使用）。
	content := method + " " + route

	adminInfo := map[string]interface{}{
		"admin_id":       operatorId,
		"admin_username": operatorName,
		"admin_role":     operatorRole,
		"auth_method":    auditAuthMethod(c),
	}
	auditInfo := map[string]interface{}{
		"method":  method,
		"route":   route,
		"path":    c.Request.URL.Path,
		"status":  status,
		"success": success,
	}
	if len(routeParams) > 0 {
		auditInfo["params"] = routeParams
	}

	gopool.Go(func() {
		model.RecordOperationAuditLog(operatorId, content, ip, action, opParams, adminInfo, auditInfo)
	})
}

func auditAuthMethod(c *gin.Context) string {
	if c.GetBool("use_access_token") {
		return "access_token"
	}
	return "session"
}

// auditResponseSuccess 依据 HTTP 状态码与响应体推断操作是否成功。
// 优先解析响应 JSON 中的 success 字段；无法解析时退回到状态码判断。
func auditResponseSuccess(status int, body []byte) bool {
	if status >= 400 {
		return false
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 && trimmed[0] == '{' {
		var resp struct {
			Success *bool `json:"success"`
		}
		if err := common.Unmarshal(trimmed, &resp); err == nil && resp.Success != nil {
			return *resp.Success
		}
	}
	return status < 400
}
