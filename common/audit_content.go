package common

import (
	"fmt"
	"os"
)

// auditContentTemplates 将稳定的操作标识 action 映射为英文兜底模板，渲染后写入
// Log.Content（供导出等非本地化消费者使用）。占位符为 ${name}，由该
// action 的 params 填充。本地化展示文案在前端 i18n 模板中维护，本表是语言中立的
// 英文基线——调用方因此无需在每个埋点处手写句子（避免与 params 重复书写同一份值）。
// 放在 common 包：controller（手动埋点）与 middleware（兜底审计）都要用它渲染
// content，避免两处各自维护一份。
var auditContentTemplates = map[string]string{
	"user.create":           "Created user ${username} (role ${role})",
	"user.update":           "Updated user ${username} (ID: ${id})",
	"user.delete":           "Deleted user ${username} (ID: ${id})",
	"user.manage":           "Performed ${action} on user ${username} (ID: ${id})",
	"user.quota_add":        "Increased user quota by ${quota}",
	"user.quota_subtract":   "Decreased user quota by ${quota}",
	"user.quota_override":   "Overrode user quota from ${from} to ${to}",
	"user.binding_clear":    "Cleared ${bindingType} binding for user ${username}",
	"user.2fa_disable":      "Force-disabled two-factor authentication for the user",
	"user.passkey_register": "Registered a passkey",
	"user.passkey_delete":   "Deleted a passkey",
	"user.reset_passkey":    "Reset the user passkey",
	"user.topup_complete":   "Completed top-up order for the user",
	"user.oauth_unbind":     "Removed an OAuth binding for the user",
	"option.update":         "Updated system setting ${key}",
	"option.reset_ratio":    "Reset model ratios",
	"option.clear_affinity_cache": "Cleared channel affinity cache",

	"channel.create":              "Created channel ${name} (type ${type}, count ${count})",
	"channel.update":              "Updated channel ${name} (ID: ${id})",
	"channel.delete":              "Deleted channel ${name} (ID: ${id})",
	"channel.delete_batch":        "Batch deleted ${count} channels",
	"channel.delete_disabled":     "Deleted all disabled channels (${count})",
	"channel.key_view":            "Viewed channel key ${name} (ID: ${id})",
	"channel.tag_disable":         "Disabled channels with tag ${tag}",
	"channel.tag_enable":          "Enabled channels with tag ${tag}",
	"channel.tag_edit":            "Edited channels with tag ${tag}",
	"channel.tag_batch_set":       "Batch set tag for ${count} channels",
	"channel.copy":                "Copied channel (source ID: ${sourceId}) to ${name} (new ID: ${id})",
	"channel.multi_key_manage":    "Multi-key management ${action} on channel (ID: ${id})",
	"channel.upstream_apply":      "Applied upstream model changes to channel (ID: ${id})",
	"channel.upstream_apply_all":  "Applied upstream model changes to ${count} channels",
	"channel.status_update":       "Updated channel status (ID: ${id})",
	"channel.status_update_batch": "Updated status of ${count} of ${total} channels",
	"channel.upstream_detect_all": "Started upstream model update detection (task ${task_id})",
	"channel.fix_abilities":       "Fixed channel abilities",
	"channel.fetch_models":        "Fetched upstream models",
	"channel.codex_refresh":       "Refreshed Codex credential (channel ID: ${id})",
	"channel.codex_reset_usage":   "Reset Codex usage (channel ID: ${id})",
	"channel.ollama_pull":         "Pulled Ollama model",
	"channel.ollama_pull_stream":  "Pulled Ollama model (streaming)",
	"channel.ollama_delete":       "Deleted Ollama model",
	"channel.upstream_detect":     "Detected upstream model updates",

	"redemption.create": "Created ${count} redemption codes named ${name} (${quota} each)",
	"redemption.update":        "Updated a redemption code",
	"redemption.delete":        "Deleted a redemption code",
	"redemption.delete_invalid": "Deleted invalid redemption codes",

	"subscription.plan_reset":                   "Reset active subscriptions for plan ${plan_id}",
	"subscription.user_plan_reset":              "Reset active plan ${plan_id} subscriptions for user ${target_user_id}",
	"subscription.plan_status_update":           "Updated subscription plan status (ID: ${id})",
	"subscription.plan_delete":                  "Deleted subscription plan (ID: ${id})",
	"subscription.user_subscription_create":     "Created a subscription for user (ID: ${id})",
	"subscription.user_subscription_invalidate": "Invalidated user subscription (ID: ${id})",
	"subscription.user_subscription_delete":     "Deleted user subscription (ID: ${id})",
	"subscription.user_subscription_purge":      "Purged user subscription (ID: ${id})",
	"subscription.plan_create":                  "Created a subscription plan",
	"subscription.plan_update":                  "Updated a subscription plan",
	"subscription.bind":                         "Bound a subscription",

	"performance.reset_stats":            "Reset performance statistics",
	"performance.clear_disk_cache":       "Cleared disk cache",
	"performance.gc":                     "Triggered garbage collection",
	"performance.clear_logs":             "Cleared log files",
	"ratio_sync.fetch":                   "Fetched upstream ratios",
	"system_info.delete_stale_instances": "Deleted stale system instances",
	"system_info.delete_instance":        "Deleted system instance ${node_name}",
	"custom_oauth.discovery":             "Fetched custom OAuth discovery",
	"custom_oauth.create":                "Created a custom OAuth provider",
	"custom_oauth.update":                "Updated a custom OAuth provider",
	"custom_oauth.delete":                "Deleted a custom OAuth provider",

	// 预填组 / 供应商 / 模型元数据
	"prefill_group.create": "Created a prefill group",
	"prefill_group.update": "Updated a prefill group",
	"prefill_group.delete": "Deleted a prefill group",

	"vendor.create": "Created a vendor",
	"vendor.update": "Updated a vendor",
	"vendor.delete": "Deleted a vendor",

	"model.create":        "Created a model",
	"model.update":        "Updated a model",
	"model.delete":        "Deleted a model",
	"model.sync_upstream": "Synced upstream models",

	// 日志 / 图床
	"log.cleanup_start": "Log cleanup task started.",
	"image.upload":      "Uploaded a file to the media library",
	"image.delete":      "Deleted image (ID: ${id})",

	"home_page_theme.import":        "Imported landing page theme ${theme_name} (ID: ${theme_id})",
	"home_page_theme.select":        "Selected landing page theme (ID: ${theme_id})",
	"home_page_theme.manual_update": "Updated the manual landing page preset",
	"home_page_theme.delete":        "Deleted landing page theme ${theme_name} (ID: ${theme_id})",

	// 风控（信誉分/敏感词/标记词分析）
	"risk_control.adjust":                       "Adjusted credit score by ${points} points for user ${target_user_id}",
	"risk_control.revert_keyword_deduction":     "Reverted a sensitive-word deduction of ${points} points (log #${log_id}) for user ${target_user_id}",
	"risk_control.revert_keyword_deductions":    "Batch reverted ${count} sensitive-word deductions (${users} users, ${points} points restored)",
	"risk_control.revert_keyword_hits":          "Reverted all deductions hitting keyword ${keyword} (${count} logs, ${points} points restored)",
	"risk_control.markers_update":               "Updated violation markers",
	"risk_control.markers_reset":                "Reset violation markers to defaults",
	"risk_control.analyze_markers":              "Ran marker analysis on recent error logs",
	"risk_control.regenerate_analysis_token":    "Regenerated the internal marker analysis token",
	"risk_control.fetch_upstream_models":        "Fetched upstream models for marker analysis",
	"risk_control.marker_accept":                "Accepted marker suggestion ${id}",
	"risk_control.marker_reject":                "Rejected marker suggestion ${id}",
	"risk_control.pledge":                       "Completed the content-safety pledge (+${points} points)",
	"risk_control.marker_analysis_prompt_reset": "Restored the marker analysis prompt to default",
	"risk_control.reset_credit_scores":          "Reset all user credit scores to the full score (${full_score})",

	"operation.vision_fallback_prompt_reset": "Restored the vision fallback description prompt to default",
}

// AuditContentEN 按 action 模板渲染英文兜底文本。ok=false 表示该 action 未登记模板，
// 此时返回的 content 为 action 本身，调用方应使用更有上下文的兜底（如 method+route）。
func AuditContentEN(action string, params map[string]interface{}) (string, bool) {
	tmpl, ok := auditContentTemplates[action]
	if !ok {
		return action, false
	}
	return os.Expand(tmpl, func(key string) string {
		if v, ok := params[key]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}), true
}
