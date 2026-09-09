package operation_setting

import "strings"

var DemoSiteEnabled = false
var SelfUseModeEnabled = false
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
