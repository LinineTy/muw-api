package constant

var StreamingTimeout int
var DifyDebug bool
var MaxFileDownloadMB int
var StreamScannerMaxBufferMB int
var ForceStreamOption bool
var CountToken bool
var GetMediaToken bool
var GetMediaTokenNotStream bool
var UpdateTask bool
var MaxRequestBodyMB int
var AnonymousRequestBodyLimitKB int
var AzureDefaultAPIVersion string
var NotifyLimitCount int
var NotificationLimitDurationMinute int
var GenerateDefaultToken bool
var ErrorLogEnabled bool
// RecordPreConsumeErrorLog 预扣费失败(余额/订阅/配额不足)错误日志开关。
// 默认关：这类高频预期错误刷日志，仅需要审计"谁在持续额度不足"的部署才开启。
var RecordPreConsumeErrorLog bool
var TaskQueryLimit int
var TaskTimeoutMinutes int

// temporary variable for sora patch, will be removed in future
var TaskPricePatches []string

// TrustedRedirectDomains is a list of trusted domains for redirect URL validation.
// Domains support subdomain matching (e.g., "example.com" matches "sub.example.com").
var TrustedRedirectDomains []string
