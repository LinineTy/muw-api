package middleware

import (
	"bytes"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

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
	"PUT /api/option/":                          "option.update",

	// 自定义 OAuth（root）
	"POST /api/custom-oauth-provider/":          "custom_oauth.create",
	"PUT /api/custom-oauth-provider/:id":        "custom_oauth.update",
	"DELETE /api/custom-oauth-provider/:id":     "custom_oauth.delete",
	"POST /api/custom-oauth-provider/discovery": "custom_oauth.discovery",

	// 性能/缓存（root）
	"DELETE /api/performance/disk_cache": "performance.clear_disk_cache",
	"POST /api/performance/gc":           "performance.gc",
	"DELETE /api/performance/logs":       "performance.clear_logs",
	"POST /api/performance/reset_stats":  "performance.reset_stats",

	// 兑换码
	"PUT /api/redemption/":           "redemption.update",
	"POST /api/redemption/batch":     "redemption.delete_batch",
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
	"PATCH /api/subscription/admin/plans/:id":                        "subscription.plan_status_update",
	"DELETE /api/subscription/admin/plans/:id":                       "subscription.plan_delete",
	"POST /api/subscription/admin/users/:id/subscriptions":           "subscription.user_subscription_create",
	"POST /api/subscription/admin/user_subscriptions/:id/invalidate": "subscription.user_subscription_invalidate",
	"DELETE /api/subscription/admin/user_subscriptions/:id":          "subscription.user_subscription_delete",
	"POST /api/subscription/admin/user_subscriptions/:id/purge":      "subscription.user_subscription_purge",

	// 比率同步（root）
	"POST /api/ratio_sync/fetch": "ratio_sync.fetch",

	// 系统信息（root）
	"DELETE /api/system-info/stale-instances":      "system_info.delete_stale_instances",
	"DELETE /api/system-info/instances/:node_name": "system_info.delete_instance",

	// 图床图片（root）
	"POST /api/images/":      "image.upload",
	"DELETE /api/images/:id": "image.delete",

	// 用户云空间（admin）
	"POST /api/playground/admin/images/cleanup":  "playground.image_cleanup",
	"POST /api/playground/admin/orders/complete": "playground.order_complete",
	"POST /api/playground/admin/orders/reject":   "playground.order_reject",

	// 日志
	"POST /api/system-task/log-cleanup": "log.cleanup_start",

	// 风控
	"POST /api/risk-control/adjust":                        "risk_control.adjust",
	"POST /api/risk-control/revert-deduction":              "risk_control.revert_keyword_deduction",
	"PUT /api/risk-control/markers":                        "risk_control.markers_update",
	"POST /api/risk-control/markers/reset":                 "risk_control.markers_reset",
	"POST /api/risk-control/analyze-markers":               "risk_control.analyze_markers",
	"POST /api/risk-control/marker-analysis/reset-prompt":  "risk_control.marker_analysis_prompt_reset",
	"POST /api/risk-control/regenerate-analysis-token":     "risk_control.regenerate_analysis_token",
	"POST /api/risk-control/fetch-upstream-models":         "risk_control.fetch_upstream_models",
	"POST /api/risk-control/marker-suggestions/:id/accept": "risk_control.marker_accept",
	"POST /api/risk-control/marker-suggestions/:id/reject": "risk_control.marker_reject",
	"POST /api/risk-control/reset-credit-scores":           "risk_control.reset_credit_scores",
	"POST /api/risk-control/revert-deductions":             "risk_control.revert_keyword_deductions",
	"POST /api/risk-control/revert-keyword-hits":           "risk_control.revert_keyword_hits",

	// 视觉兜底
	"POST /api/visual-fallback/reset-prompt": "operation.vision_fallback_prompt_reset",

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

	// 设置保存（PUT /api/option/）由 UpdateOption 埋点 option key，让审计能展示改了哪个配置。
	if key := c.GetString("audit_option_key"); key != "" {
		opParams["key"] = key
	}

	// content 为英文兜底文本（供导出等非本地化消费者使用）。命中的命名 action 按模板
	// 渲染成句子，避免落库原始 "METHOD route"；无模板的命名 action 与 generic 路由都
	// 退回 method+route 以便识别。
	content := method + " " + route
	if action != "generic" {
		if rendered, ok := common.AuditContentEN(action, opParams); ok {
			content = rendered
		}
	}

	adminInfo := &model.AuditAdminInfo{
		AdminID:       operatorId,
		AdminUsername: operatorName,
		AdminRole:     operatorRole,
		AuthMethod:    auditAuthMethod(c),
	}
	auditInfo := &model.AuditRequestInfo{
		Method:  method,
		Route:   route,
		Path:    route,
		Status:  status,
		Success: success,
		Params:  routeParams,
	}

	model.RecordOperationAuditLog(operatorId, operatorRole, content, ip, action, opParams, adminInfo, auditInfo, c)
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

const accessTokenAuditContextKey = "access_token_request_audit"

// TokenOperationAudit runs after UserAuth and before endpoint rate limits.
// Handlers add only allowlisted metadata; neither bodies nor raw errors are persisted.
func TokenOperationAudit() gin.HandlerFunc {
	return func(c *gin.Context) {
		var action, content string
		switch c.Request.Method + " " + c.FullPath() {
		case "POST /api/token/":
			action, content = "token.create", "API token creation"
		case "PUT /api/token/":
			action, content = "token.update", "API token configuration update"
			if c.Query("status_only") != "" {
				action, content = "token.status_update", "API token status update"
			}
		case "DELETE /api/token/:id":
			action, content = "token.delete", "API token deletion"
		case "POST /api/token/batch":
			action, content = "token.delete_batch", "API token batch deletion"
		case "POST /api/token/:id/key":
			action, content = "token.key_view", "API token key access"
		case "POST /api/token/batch/keys":
			action, content = "token.key_view_batch", "API token batch key access"
		default:
			c.Next()
			return
		}

		params := model.AuditFields{}
		if id, err := strconv.Atoi(c.Param("id")); err == nil && id > 0 {
			params["id"] = id
		}
		common.SetContextKey(c, constant.ContextKeyTokenAuditParams, params)
		entry := model.AuditLog{
			UserId: c.GetInt("id"), Username: c.GetString("username"), ActorRole: c.GetInt("role"),
			Category: model.AuditCategorySecurity, Action: action, Content: content,
			Other: model.AuditOther{Op: &model.AuditOperation{Action: action, Params: params}},
		}
		writer := &auditResponseWriter{ResponseWriter: c.Writer, body: bytes.NewBuffer(nil), maxSize: 64 * 1024}
		c.Writer = writer
		c.Next()
		entry.Status = writer.Status()
		entry.Success = auditResponseSuccess(entry.Status, writer.body.Bytes())
		if writer.body.Len() == writer.maxSize {
			// JSON may be truncated before its success field. A completed handler
			// supplies the result without retaining an unbounded response body.
			entry.Success = entry.Status < 400 && common.GetContextKeyBool(c, constant.ContextKeyTokenAuditSucceeded)
		}
		model.RecordAuditLog(c, entry)
	}
}

type accessTokenRequestAudit struct {
	entry  model.AuditLog
	writer *auditResponseWriter
}

// AccessTokenAudit also captures public reads and rejections before route-level
// authentication (for example, rate limiting). It does not grant authentication.
func AccessTokenAudit() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, present := authorizationToken(c.GetHeader("Authorization"))
		if present {
			_, internal, _ := service.ParseDashboardAccessToken(raw)
			if !internal {
				user, err := model.ValidateAccessToken(raw)
				if err == nil && user != nil && user.Id > 0 {
					beginAccessTokenAudit(c, user, raw)
					defer finishAccessTokenAudit(c)
				}
			}
		}
		c.Next()
	}
}

func beginAccessTokenAudit(c *gin.Context, user *model.User, token string) {
	if _, exists := c.Get(accessTokenAuditContextKey); exists {
		return
	}
	writer := &auditResponseWriter{ResponseWriter: c.Writer, body: bytes.NewBuffer(nil), maxSize: 64 * 1024}
	c.Writer = writer
	c.Set(accessTokenAuditContextKey, &accessTokenRequestAudit{
		entry:  model.AuditLog{UserId: user.Id, Username: user.Username, ActorRole: user.Role, Category: model.AuditCategoryAccessToken, AuthMethod: "access_token", TokenRef: model.AccessTokenFingerprint(token), CreatedAt: common.GetTimestamp(), EventId: common.NewRequestId()},
		writer: writer,
	})
}

func finishAccessTokenAudit(c *gin.Context) {
	value, exists := c.Get(accessTokenAuditContextKey)
	if !exists {
		return
	}
	audit, ok := value.(*accessTokenRequestAudit)
	if !ok {
		return
	}
	audit.entry.Status = audit.writer.Status()
	audit.entry.Success = auditResponseSuccess(audit.entry.Status, audit.writer.body.Bytes())
	model.RecordAuditLog(c, audit.entry)
}
