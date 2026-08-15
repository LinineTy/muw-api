package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// GetRiskControlOverview 风控中心概览统计。
func GetRiskControlOverview(c *gin.Context) {
	overview, err := service.GetRiskControlOverview()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, overview)
}

// GetUserCreditStatus 用户自己的信誉分状态（个人中心展示）。
func GetUserCreditStatus(c *gin.Context) {
	userId := c.GetInt("id")
	status, err := service.GetUserCreditStatus(c, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, status)
}

// CreditScorePledge 用户完成保证书加分。
func CreditScorePledge(c *gin.Context) {
	userId := c.GetInt("id")
	newBalance, nextPledgeAt, err := service.ApplyUserPledge(c, userId)
	if err != nil {
		if errors.Is(err, service.ErrPledgeCooldown) {
			common.ApiSuccess(c, gin.H{"cooldown": true, "next_pledge_at": nextPledgeAt})
			return
		}
		if errors.Is(err, service.ErrPledgeAtFullScore) {
			common.ApiErrorMsg(c, common.TranslateMessage(c, i18n.MsgCreditScoreAtFullScore))
			return
		}
		if errors.Is(err, service.ErrPledgeDisabled) {
			common.ApiErrorI18n(c, i18n.MsgCreditScorePledgeDisabled)
			return
		}
		common.ApiError(c, err)
		return
	}
	// 用户本人完成保证书也落操作审计（普通用户安全敏感操作，无 admin_info）。
	recordUserSecurityAudit(c, userId, "risk_control.pledge", map[string]interface{}{
		"points":       operation_setting.GetCreditScoreSetting().PledgePoints,
		"credit_score": newBalance,
	})
	common.ApiSuccess(c, gin.H{"cooldown": false, "credit_score": newBalance, "next_pledge_at": nextPledgeAt})
}

// GetLowCreditScoreUsers 风控中心：低分用户列表（credit_score < threshold）。
func GetLowCreditScoreUsers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	setting := operation_setting.GetCreditScoreSetting()
	threshold := setting.FreezeThreshold
	if t := c.Query("threshold"); t != "" {
		if v, err := strconv.Atoi(t); err == nil && v > 0 {
			threshold = v
		}
	}
	if threshold <= 0 {
		threshold = 500
	}
	users, total, err := model.ListLowCreditScoreUsers(threshold, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(users)
	common.ApiSuccess(c, pageInfo)
}

// GetCreditScoreLogs 风控中心：扣分/恢复明细。
func GetCreditScoreLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	source := c.Query("source")
	start, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	logs, total, err := model.ListCreditScoreLogs(userId, source, start, end, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

// AdjustCreditScore 管理端手动调整信用分（正=恢复，负=扣分）。
func AdjustCreditScore(c *gin.Context) {
	var req struct {
		UserId int    `json:"user_id"`
		Points int    `json:"points"`
		Reason string `json:"reason"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	if req.UserId <= 0 || req.Points == 0 {
		common.ApiErrorI18n(c, i18n.MsgRiskControlInvalidAdjust)
		return
	}
	if len(req.Reason) > 255 {
		// 按字节截断会切坏多字节 UTF-8（reason 落 varchar(512)，MySQL/PG 严格模式
		// 拒绝非法 UTF-8），复用同包 truncateBytes 回退到 rune 边界。
		req.Reason = truncateBytes(req.Reason, 255)
	}
	newBalance, err := service.AdjustUserCreditScore(c, req.UserId, req.Points, req.Reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, req.UserId, "risk_control.adjust", map[string]interface{}{
		"points": req.Points,
		"reason": req.Reason,
	})
	common.ApiSuccess(c, gin.H{"user_id": req.UserId, "balance": newBalance})
}

// GetRiskControlMarkers 返回当前违规标记词列表（换行分隔 → 数组）。
func GetRiskControlMarkers(c *gin.Context) {
	setting := operation_setting.GetCreditScoreSetting()
	common.ApiSuccess(c, gin.H{"markers": splitMarkerLines(setting.ViolationMarkers)})
}

// SetRiskControlMarkers 管理员编辑标记词列表（数组 → 换行分隔写回设置）。
func SetRiskControlMarkers(c *gin.Context) {
	var req struct {
		Markers []string `json:"markers"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	setting := operation_setting.GetCreditScoreSetting()
	setting.ViolationMarkers = joinMarkerLines(req.Markers)
	if err := updateOperationSettingOption(c, "credit_score_setting", "violation_markers", setting.ViolationMarkers); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"markers": splitMarkerLines(setting.ViolationMarkers)})
}

func splitMarkerLines(raw string) []string {
	if raw == "" {
		return []string{}
	}
	var out []string
	cur := ""
	for _, r := range raw {
		if r == '\n' || r == '\r' {
			if cur != "" {
				out = append(out, cur)
				cur = ""
			}
			continue
		}
		cur += string(r)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}

func joinMarkerLines(items []string) string {
	out := ""
	for i, s := range items {
		s = trimMarkerLine(s)
		if s == "" {
			continue
		}
		if i > 0 && out != "" {
			out += "\n"
		}
		out += s
	}
	return out
}

func trimMarkerLine(s string) string {
	start := 0
	end := len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\r' || s[end-1] == '\n') {
		end--
	}
	return s[start:end]
}

// updateOperationSettingOption 把配置写进 options 表并热生效（走通用 /api/option 链路）。
func updateOperationSettingOption(c *gin.Context, module, field, value string) error {
	key := module + "." + field
	return model.UpdateOption(key, value)
}

// AnalyzeMarkers 手动立即跑一次违规标记词 AI 分析。
func AnalyzeMarkers(c *gin.Context) {
	summary, err := service.AnalyzeRecentErrorLogs(c.Request.Context(), "manual")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

// GetMarkerSuggestions 待审/已处理建议列表。
func GetMarkerSuggestions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	status := c.Query("status")
	suggestions, total, err := model.ListCreditMarkerSuggestions(status, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(suggestions)
	common.ApiSuccess(c, pageInfo)
}

// AcceptMarkerSuggestion 采纳建议：append 进 violation_markers 并写 option，标记 accepted。
func AcceptMarkerSuggestion(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		common.ApiErrorMsg(c, "invalid suggestion id")
		return
	}
	var sug model.CreditMarkerSuggestion
	if err := model.DB.First(&sug, id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if sug.Status != "pending" {
		common.ApiErrorI18n(c, i18n.MsgRiskControlSuggestionNotPending)
		return
	}
	setting := operation_setting.GetCreditScoreSetting()
	markers := splitMarkerLines(setting.ViolationMarkers)
	exists := false
	for _, m := range markers {
		if strings.EqualFold(strings.TrimSpace(m), strings.TrimSpace(sug.Marker)) {
			exists = true
			break
		}
	}
	if !exists {
		markers = append(markers, sug.Marker)
		setting.ViolationMarkers = joinMarkerLines(markers)
		if err := model.UpdateOption("credit_score_setting.violation_markers", setting.ViolationMarkers); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if err := model.SetCreditMarkerSuggestionStatus(id, "accepted"); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}

// RejectMarkerSuggestion 忽略建议。
func RejectMarkerSuggestion(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		common.ApiErrorMsg(c, "invalid suggestion id")
		return
	}
	if err := model.SetCreditMarkerSuggestionStatus(id, "rejected"); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}
