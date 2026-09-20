package dto

import "testing"

// 白名单必须与 dto 的通知方式常量保持一致。入口校验统一走 IsValidNotifyType：
// 历史上 controller 里手写过一份白名单，新增「站内消息」时漏加，
// 表现为用户选择该方式保存时报「无效的预警类型」（校验在写库之前就 return）。
func TestIsValidNotifyType(t *testing.T) {
	valid := []string{
		NotifyTypeEmail,
		NotifyTypeWebhook,
		NotifyTypeBark,
		NotifyTypeGotify,
		NotifyTypeWeb,
	}
	for _, typ := range valid {
		if !IsValidNotifyType(typ) {
			t.Errorf("IsValidNotifyType(%q) = false, 应为 true", typ)
		}
	}

	invalid := []string{"", "email ", "Email", "websocket", "webhook2", "unknown", "站内消息"}
	for _, typ := range invalid {
		if IsValidNotifyType(typ) {
			t.Errorf("IsValidNotifyType(%q) = true, 应为 false", typ)
		}
	}
}
