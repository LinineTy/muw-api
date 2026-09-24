package common

import (
	"crypto/tls"
	//"os"
	//"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

var StartTime = time.Now().Unix() // unit: second
var Version = "v0.0.0"            // this hard coding will be replaced automatically when building, no need to manually change

// 构建期注入的版本号可能带空白：VERSION 文件在 Windows 检出是 CRLF，`$(cat VERSION)`
// 只去尾换行不去 \r，于是 ldflags 会把 `v26.09.11.muw.9\r` 注进来（生产实测过）。
// 在包初始化时统一去掉两侧空白，任何拿 Version 做比较/展示的地方都不用再自己 trim。
func init() {
	Version = strings.TrimSpace(Version)
}

// SystemName 是"数据库里没有 SystemName 选项时"的默认站点名；线上实例由选项
// 覆盖（设置 → 站点与品牌）。fork 自己的品牌名，2026-09-13定（改这个不涉及
// 上游署名：README/版权头/module path/镜像名仍保持原样，见 AGENTS.md fork note）。
var SystemName = "Muw API Dev"
var Footer = ""
var Logo = ""
var TopUpLink = ""

// var ChatLink = ""
// var ChatLink2 = ""
var QuotaPerUnit = 500 * 1000.0 // $0.002 / 1K tokens
// 保留旧变量以兼容历史逻辑，实际展示由 general_setting.quota_display_type 控制
var DisplayInCurrencyEnabled = true
var DisplayTokenStatEnabled = true
var DrawingEnabled = true
var TaskEnabled = true
var DataExportEnabled = true
var DataExportInterval = 5         // unit: minute
var DataExportDefaultTime = "hour" // unit: minute
var DefaultCollapseSidebar = false // default value of collapse sidebar

// Any options with "Secret", "Token" in its key won't be return by GetOptions

var SessionSecret = uuid.New().String()
var CryptoSecret = uuid.New().String()
var SessionCookieSecure = false
var SessionCookieTrustedURLs []string

const (
	DefaultUserSessionActiveLimit           = 10
	DefaultUserSessionIssuanceLimit         = 100
	DefaultUserSessionIssuanceWindowSeconds = 24 * 60 * 60
	DefaultUserSessionRevokedRetentionDays  = 7
	DefaultUserSessionHourlyAlertThreshold  = 5000
)

var (
	UserSessionActiveLimit           = DefaultUserSessionActiveLimit
	UserSessionIssuanceLimit         = DefaultUserSessionIssuanceLimit
	UserSessionIssuanceWindowSeconds = int64(DefaultUserSessionIssuanceWindowSeconds)
	UserSessionRevokedRetentionDays  = DefaultUserSessionRevokedRetentionDays
	UserSessionHourlyAlertThreshold  = DefaultUserSessionHourlyAlertThreshold
)

var OptionMap map[string]string
var OptionMapRWMutex sync.RWMutex

var ItemsPerPage = 10
var MaxRecentItems = 1000

var PasswordLoginEnabled = true
var PasswordLoginEncryptionEnabled = false
var PasswordRegisterEnabled = true
var EmailVerificationEnabled = false
var GitHubOAuthEnabled = false
var LinuxDOOAuthEnabled = false
var WeChatAuthEnabled = false
var TelegramOAuthEnabled = false
var TurnstileCheckEnabled = false
var RegisterEnabled = true

// InviteCodeRegisterEnabled 邀请码激活制开关（option key 沿用历史名 InviteCodeRegisterEnabled）：
// 开启后新注册账号、以及 OAuth 首次登录自动创建的账号都是"待激活"临时账号（activated=0），
// 登录后只能访问激活页，需在激活页提交邀请码（ActivateInviteCode → OccupyInviteCode 占位）
// 才转正。它同时以 invite_activation_enabled 暴露给前端（controller/misc.go）。
// 注意：注册请求本身不携带邀请码，注册流程是"建号后置待激活"，不是"注册时必须填写"。
var InviteCodeRegisterEnabled = false

// TrapInviteCodeBanReason 钓鱼邀请码（Redemption.IsTrap）命中后写入 users.remark 的
// 封禁原因。登录被拒时该字段作为 login_status.reason 展示给本人
// （见 controller.setupLoginAtAuthVersion）。
const TrapInviteCodeBanReason = "你真的是人类吗？"

// DefaultInviteTrapGraceSeconds 钓鱼邀请码命中后的默认宽限秒数（15 分钟）。
// 命中不再立刻停用账号：宽限期内用有效邀请码激活成功即免于停用，到期仍未激活的
// 由定时任务统一停用（model.ListExpiredInviteTrapGraces → DisableUserByTrap）。
const DefaultInviteTrapGraceSeconds = 15 * 60

// MinInviteTrapGraceSeconds 宽限窗口下限：给得太短会让"提示都没来得及看"的真人被误伤，
// 因此配置值低于此下限时按下限生效。
const MinInviteTrapGraceSeconds = 60

// InviteTrapGraceSeconds 钓鱼邀请码宽限秒数，可通过 option key InviteTrapGraceSeconds 调整。
var InviteTrapGraceSeconds = DefaultInviteTrapGraceSeconds

// InviteTrapGraceWindow 返回生效的宽限秒数（非法值回落默认，低于下限取下限）。
func InviteTrapGraceWindow() int {
	if InviteTrapGraceSeconds <= 0 {
		return DefaultInviteTrapGraceSeconds
	}
	if InviteTrapGraceSeconds < MinInviteTrapGraceSeconds {
		return MinInviteTrapGraceSeconds
	}
	return InviteTrapGraceSeconds
}

// HoneypotBanReason 隐形蜜罐命中后写入 users.remark 的封禁原因。
const HoneypotBanReason = "检测到自动化提交，账号已停用"

// LoginChallengeEnabled 登录、注册、第三方登录入口的人机校验开关（默认关）。
// 开启且 PoWChallengeBits > 0 时，三处入口都要带一道通过校验的挑战。
var LoginChallengeEnabled = false

// ActivationHoneypotEnabled 激活页隐形蜜罐字段开关（默认开）：
// 字段对用户不可见也不可聚焦，非空即判为自动化提交。
var ActivationHoneypotEnabled = true

// DefaultActivationPoWBits 人机校验默认难度（sha256 前导零位数，期望 2^n 次哈希）。
const DefaultActivationPoWBits = 18

// MaxActivationPoWBits 难度上限；每 +1 位成本翻倍，再高会影响真人等待时间。
const MaxActivationPoWBits = 24

// ActivationPoWBits 生效难度，可通过 option key PoWChallengeBits 调整；<=0 表示关闭校验。
var ActivationPoWBits = DefaultActivationPoWBits

// ActivationPoWBitsEffective 返回生效难度：0 表示关闭，超过上限按上限生效。
func ActivationPoWBitsEffective() int {
	if ActivationPoWBits <= 0 {
		return 0
	}
	if ActivationPoWBits > MaxActivationPoWBits {
		return MaxActivationPoWBits
	}
	return ActivationPoWBits
}

// MaxUserCount 站点最大非超管用户数,0 表示不限制。超管(root)不计入额度,
// 因此配置值 N 意味着站点允许 N 个非超管用户(加上超管共 N+1)。
var MaxUserCount = 0

var EmailDomainRestrictionEnabled = false // 是否启用邮箱域名限制
var EmailAliasRestrictionEnabled = false  // 是否启用邮箱别名限制
var EmailDomainWhitelist = []string{
	"gmail.com",
	"163.com",
	"126.com",
	"qq.com",
	"outlook.com",
	"hotmail.com",
	"icloud.com",
	"yahoo.com",
	"foxmail.com",
}
var EmailLoginAuthServerList = []string{
	"smtp.sendcloud.net",
	"smtp.azurecomm.net",
}

var DebugEnabled bool
var MemoryCacheEnabled bool

var LogConsumeEnabled = true

var TLSInsecureSkipVerify bool
var InsecureTLSConfig = &tls.Config{InsecureSkipVerify: true}

var SMTPServer = ""
var SMTPPort = 587
var SMTPSSLEnabled = false
var SMTPStartTLSEnabled = false
var SMTPInsecureSkipVerify = false
var SMTPForceAuthLogin = false
var SMTPAccount = ""
var SMTPFrom = ""
var SMTPToken = ""

var GitHubClientId = ""
var GitHubClientSecret = ""
var LinuxDOClientId = ""
var LinuxDOClientSecret = ""
var LinuxDOMinimumTrustLevel = 0

// LinuxDoRefreshEnabled controls the scheduled background refresh of LinuxDo
// trust levels. LinuxDoRefreshIntervalHours is the interval in hours (>=1).
// The names deliberately avoid the Token/Secret/Key suffixes so the admin
// settings page can read/write them (see controller/option.go hiding rules).
var LinuxDoRefreshEnabled = true
var LinuxDoRefreshIntervalHours = 24

// LinuxDOBlacklist lists LinuxDO accounts that are forbidden from logging in or
// registering, regardless of trust level. Each entry carries a match type so a
// numeric id and a username that happen to be identical are never conflated.
var LinuxDOBlacklist = []LinuxDOBlacklistEntry{}

// LinuxDOGroupMapping maps a LinuxDO trust level (L0-L4) to a user group, e.g.
// {"2":"vip","3":"svip"}. An empty map disables LinuxDO auto group assignment.
var LinuxDOGroupMapping = map[string]string{}

var WeChatServerAddress = ""
var WeChatServerToken = ""
var WeChatAccountQRCodeImageURL = ""

var TurnstileSiteKey = ""
var TurnstileSecretKey = ""

var TelegramBotToken = ""
var TelegramBotName = ""

var QuotaForNewUser = 0
var QuotaForInviter = 0
var QuotaForInvitee = 0

// DefaultUserGroup is the group new users land in when no group is specified.
var DefaultUserGroup = "default"

var ChannelDisableThreshold = 5.0
var AutomaticDisableChannelEnabled = false
var AutomaticEnableChannelEnabled = false
var QuotaRemindThreshold = 1000

// PreConsumedQuota is retained for old option clients; token reservations now
// use quota_setting.pre_consume_multiplier and the estimated input cost.
var PreConsumedQuota = 500

// Subscription feature toggles (synced from the options table).
var (
	// SubscriptionMaxSimultaneous caps how many active subscriptions a user may hold
	// at once. 0 disables the cap.
	SubscriptionMaxSimultaneous = 0
	// SubscriptionAutoRenewEnabled toggles the automatic renewal task.
	SubscriptionAutoRenewEnabled = true
	// SubscriptionPriorityEnabled toggles the user-facing "Use First" consumption
	// priority feature.
	SubscriptionPriorityEnabled = true
	// SubscriptionGroupUpgradeEnabled toggles the user group upgrade on purchase and
	// downgrade on expiry/cancel.
	SubscriptionGroupUpgradeEnabled = true
	// SubscriptionExclusiveGroupEnabled toggles mutual-exclusion groups (same-group
	// plans cannot coexist and purchases trigger a prorated switch).
	SubscriptionExclusiveGroupEnabled = true
)

var RetryTimes = 0

//var RootUserEmail = ""

var IsMasterNode bool

const (
	NodeNameSourceManual   = "manual"
	NodeNameSourceHostname = "hostname"
)

// NodeName 节点名称，优先从 NODE_NAME 环境变量读取，未配置时回退主机名。
// 用于审计日志和后台任务中标识节点身份；多实例部署时建议显式配置稳定 NODE_NAME。
var NodeName = ""

// NodeNameSource records how NodeName was chosen so future instance-management
// reporting can distinguish operator-configured names from automatic fallback.
var NodeNameSource = NodeNameSourceHostname

var NodeNameManuallyConfigured bool

var requestInterval int
var RequestInterval time.Duration

var SyncFrequency int // unit is second

var BatchUpdateEnabled = false
var BatchUpdateInterval int

var RelayTimeout int // unit is second

var RelayIdleConnTimeout int // unit is second

// RelayResponseHeaderTimeout limits how long the relay transport waits for the
// upstream response headers after the request has been fully written.
// 0 disables it (previous behaviour: wait forever).
//
// Note this is NOT the same as RelayTimeout (http.Client.Timeout), which covers
// the whole response read and therefore breaks legitimate long streaming calls.
// ResponseHeaderTimeout only bounds the wait for the response headers; once the
// headers arrive, streaming is unaffected.
var RelayResponseHeaderTimeout int // unit is second
var RelayMaxIdleConns int
var RelayMaxIdleConnsPerHost int

var GeminiSafetySetting string

// https://docs.cohere.com/docs/safety-modes Type; NONE/CONTEXTUAL/STRICT
var CohereSafetySetting string

const (
	RequestIdKey         = "X-Oneapi-Request-Id"
	UpstreamRequestIdKey = "X-Upstream-Request-Id"
)

const (
	RoleGuestUser  = 0
	RoleCommonUser = 1
	RoleAdminUser  = 10
	RoleRootUser   = 100
)

func IsValidateRole(role int) bool {
	return role == RoleGuestUser || role == RoleCommonUser || role == RoleAdminUser || role == RoleRootUser
}

var (
	FileUploadPermission    = RoleGuestUser
	FileDownloadPermission  = RoleGuestUser
	ImageUploadPermission   = RoleGuestUser
	ImageDownloadPermission = RoleGuestUser
)

// All duration's unit is seconds
// Shouldn't larger then RateLimitKeyExpirationDuration
var (
	GlobalApiRateLimitEnable   bool
	GlobalApiRateLimitNum      int
	GlobalApiRateLimitDuration int64

	GlobalWebRateLimitEnable   bool
	GlobalWebRateLimitNum      int
	GlobalWebRateLimitDuration int64

	CriticalRateLimitEnable   bool
	CriticalRateLimitNum            = 20
	CriticalRateLimitDuration int64 = 20 * 60

	UploadRateLimitNum            = 10
	UploadRateLimitDuration int64 = 60

	DownloadRateLimitNum            = 10
	DownloadRateLimitDuration int64 = 60

	// Per-user search rate limit (applies after authentication, keyed by user ID)
	SearchRateLimitEnable         = true
	SearchRateLimitNum            = 10
	SearchRateLimitDuration int64 = 60
)

var RateLimitKeyExpirationDuration = 20 * time.Minute

const (
	UserStatusEnabled  = 1 // don't use 0, 0 is the default value!
	UserStatusDisabled = 2 // also don't use 0
)

const (
	TokenStatusEnabled   = 1 // don't use 0, 0 is the default value!
	TokenStatusDisabled  = 2 // also don't use 0
	TokenStatusExpired   = 3
	TokenStatusExhausted = 4
)

const (
	RedemptionCodeStatusEnabled  = 1 // don't use 0, 0 is the default value!
	RedemptionCodeStatusDisabled = 2 // also don't use 0
	RedemptionCodeStatusUsed     = 3 // also don't use 0
)

const (
	RedemptionCodeTypeTopup  = 1 // 兑换额度（原兑换码行为）
	RedemptionCodeTypeInvite = 2 // 注册邀请（放行注册）
)

const (
	ChannelStatusUnknown          = 0
	ChannelStatusEnabled          = 1 // don't use 0, 0 is the default value!
	ChannelStatusManuallyDisabled = 2 // also don't use 0
	ChannelStatusAutoDisabled     = 3
)

const (
	TopUpStatusPending = "pending"
	TopUpStatusSuccess = "success"
	TopUpStatusFailed  = "failed"
	TopUpStatusExpired = "expired"
)
