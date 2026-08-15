package operation_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// CreditScoreSetting 信誉分体系配置。Enabled 总开关（默认关，部署后在设置页开启）；
// AutoFreezeEnabled 低于 FreezeThreshold 时 TokenAuth 冻结 /v1 调用（账号本身不禁用）。
// ViolationMarkers 为换行分隔的上游违规标记词（大小写不敏感子串匹配）。
type CreditScoreSetting struct {
	Enabled                    bool   `json:"enabled"`
	AutoFreezeEnabled          bool   `json:"auto_freeze_enabled"`
	FullScore                  int    `json:"full_score"`
	FreezeThreshold            int    `json:"freeze_threshold"`
	DeductionUpstreamViolation int    `json:"deduction_upstream_violation"`
	DeductionLocalKeyword      int    `json:"deduction_local_keyword"`
	ViolationMarkers           string `json:"violation_markers"`
	RepeatMultiplierEnabled    bool   `json:"repeat_multiplier_enabled"`
	MaxDailyDeduction          int    `json:"max_daily_deduction"`
	RecoverEnabled             bool   `json:"recover_enabled"`
	RecoverPerDay              int    `json:"recover_per_day"`
	// 保证书主动恢复：用户完成保证书 +PledgePoints，冷却 PledgeCooldownDays 天。
	PledgePoints       int `json:"pledge_points"`
	PledgeCooldownDays int `json:"pledge_cooldown_days"`
	// 标记词 AI 自动学习：直连 OpenAI 兼容端点（base_url 可填站点自身地址实现套娃）。
	MarkerAnalysisEnabled bool   `json:"marker_analysis_enabled"`
	MarkerAnalysisBaseUrl string `json:"marker_analysis_base_url"`
	MarkerAnalysisApiKey  string `json:"marker_analysis_api_key"`
	MarkerAnalysisModel   string `json:"marker_analysis_model"`
}

// 默认配置。标记词按真实日志格式配：现有 violation_fee 的两个硬编码标记 +
// 用户实测的 "image is sensitive / please check your input" 格式。
var creditScoreSetting = CreditScoreSetting{
	Enabled:                    false,
	AutoFreezeEnabled:          true,
	FullScore:                  650,
	FreezeThreshold:            500,
	DeductionUpstreamViolation: 5,
	DeductionLocalKeyword:      1,
	ViolationMarkers: "Failed check: SAFETY_CHECK_TYPE\n" +
		"Content violates usage guidelines\n" +
		"is sensitive\n" +
		"please check your input",
	RepeatMultiplierEnabled: true,
	MaxDailyDeduction:       50,
	RecoverEnabled:          true,
	RecoverPerDay:           5,
	PledgePoints:            10,
	PledgeCooldownDays:      7,
	MarkerAnalysisEnabled:   false,
}

func init() {
	// 注册到全局配置管理器，key 前缀 = credit_score_setting
	config.GlobalConfig.Register("credit_score_setting", &creditScoreSetting)
}

func GetCreditScoreSetting() *CreditScoreSetting {
	return &creditScoreSetting
}

// IsFrozen 判断分数是否触发冻结（开关 + 阈值均生效）。
func (s *CreditScoreSetting) IsFrozen(score int) bool {
	if s == nil || !s.Enabled || !s.AutoFreezeEnabled {
		return false
	}
	if s.FreezeThreshold <= 0 {
		return false
	}
	return score < s.FreezeThreshold
}

// HasUpstreamViolationMarker 对上游错误文案做大小写不敏感子串匹配。
func (s *CreditScoreSetting) HasUpstreamViolationMarker(msg string) bool {
	return s.MatchedViolationMarker(msg) != ""
}

// MatchedViolationMarker 返回命中的第一个标记词（写入扣分日志 Reason）。
func (s *CreditScoreSetting) MatchedViolationMarker(msg string) string {
	if s == nil || msg == "" {
		return ""
	}
	lower := strings.ToLower(msg)
	for _, m := range splitViolationMarkerLines(s.ViolationMarkers) {
		if m != "" && strings.Contains(lower, m) {
			return m
		}
	}
	return ""
}

func splitViolationMarkerLines(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == '\n' || r == '\r'
	})
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, strings.ToLower(p))
		}
	}
	return out
}
