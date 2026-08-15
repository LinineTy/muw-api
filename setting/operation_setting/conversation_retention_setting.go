package operation_setting

import (
	"github.com/QuantumNous/new-api/setting/config"
)

// ConversationRetentionSetting 对话记录留存配置。Enabled 总开关（默认关）。
// Request/Response 内容各自截断到 MaxBytes（0/负值 = 用默认值 2 MB，见
// EffectiveRequestMaxBytes/EffectiveResponseMaxBytes）；TTLDays 控制定时清理保留窗口；
// MaxTotalBytes 为整表总存量上限（0 = 不限），超出后清理任务滚动删最老记录。
type ConversationRetentionSetting struct {
	Enabled          bool  `json:"enabled"`
	RequestMaxBytes  int   `json:"request_max_bytes"`
	ResponseMaxBytes int   `json:"response_max_bytes"`
	TTLDays          int   `json:"ttl_days"`
	MaxTotalBytes    int64 `json:"max_total_bytes"`
}

// defaultConversationMaxBytes 单条 request/response 的截断上限默认值（2 MB）。
const defaultConversationMaxBytes = 2 * 1024 * 1024

// 默认配置。单条请求/响应截断上限 2 MB：已远超任何模型单次上下文/输出（1–2M
// token ≈ 4–8 MB 文本），同时把流式响应在途捕获 buffer 的内存占用压到可控范围。
// MaxTotalBytes 5 GB 作为总存量兜底（记录平均 KB 级，5 GB 足够数月留存）。
var conversationRetentionSetting = ConversationRetentionSetting{
	Enabled:          false,
	RequestMaxBytes:  2097152, // 2 MB
	ResponseMaxBytes: 2097152, // 2 MB
	TTLDays:          30,
	MaxTotalBytes:    5368709120, // 5 GB 总存量上限（0 = 不限）
}

// EffectiveRequestMaxBytes 返回生效的请求截断上限；配置为 0/负值时回落到默认值。
// 0 语义与响应 buffer 的硬上限统一（0 = 用默认，而不是"不截断"——那会允许无界
// 内存缓冲）。
func (s *ConversationRetentionSetting) EffectiveRequestMaxBytes() int {
	if s == nil || s.RequestMaxBytes <= 0 {
		return defaultConversationMaxBytes
	}
	return s.RequestMaxBytes
}

// EffectiveResponseMaxBytes 返回生效的响应截断上限；配置为 0/负值时回落到默认值。
func (s *ConversationRetentionSetting) EffectiveResponseMaxBytes() int {
	if s == nil || s.ResponseMaxBytes <= 0 {
		return defaultConversationMaxBytes
	}
	return s.ResponseMaxBytes
}

func init() {
	config.GlobalConfig.Register("conversation_retention_setting", &conversationRetentionSetting)
}

func GetConversationRetentionSetting() *ConversationRetentionSetting {
	return &conversationRetentionSetting
}
