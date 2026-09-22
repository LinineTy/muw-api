package operation_setting

import "strings"

var DemoSiteEnabled = false
var SelfUseModeEnabled = false

// UpdateCheckDevChannelEnabled 决定「检查更新」是否也看开发版(未标记稳定的版本)。
// 关(默认)时只比公网源 releases 里最新的非 prerelease 版本号:别人看到的永远是稳定版公告;
// 打开后改比 dev 版本号,用于自己这台尽早看到新构建(2026-09-13 maintainer定)。
var UpdateCheckDevChannelEnabled = false

// AffiliateProgramEnabled 控制推广返利(邀请)功能是否启用。关闭后钱包不再
// 展示推荐卡片，新注册/新 OAuth 登录也不再处理邀请码、不再发放邀请奖励。
var AffiliateProgramEnabled = true

var AutomaticDisableKeywords = []string{
	"Your credit balance is too low",
	"This organization has been disabled.",
	"You exceeded your current quota",
	"Permission denied",
	"The security token included in the request is invalid",
	"Operation not allowed",
	"Your account is not authorized",
}

func AutomaticDisableKeywordsToString() string {
	return strings.Join(AutomaticDisableKeywords, "\n")
}

func AutomaticDisableKeywordsFromString(s string) {
	AutomaticDisableKeywords = []string{}
	ak := strings.SplitSeq(s, "\n")
	for k := range ak {
		k = strings.TrimSpace(k)
		k = strings.ToLower(k)
		if k != "" {
			AutomaticDisableKeywords = append(AutomaticDisableKeywords, k)
		}
	}
}
