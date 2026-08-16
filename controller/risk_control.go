package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

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

// RevertCreditScoreDeduction 管理端打回一条敏感词扣分记录（审核认定误判）：恢复分数，
// 可选从敏感词库删除命中的词（remove_words 为空数组=仅打回不删词）。幂等：同一记录
// 只能打回一次，重复打回返回已打回错误。
func RevertCreditScoreDeduction(c *gin.Context) {
	var req struct {
		LogId       int64    `json:"log_id"`
		RemoveWords []string `json:"remove_words"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	if req.LogId <= 0 {
		common.ApiErrorMsg(c, "invalid log_id")
		return
	}
	newBalance, userId, points, err := service.RevertKeywordDeduction(req.LogId, req.RemoveWords)
	if err != nil {
		if errors.Is(err, model.ErrCreditScoreLogAlreadyReverted) {
			common.ApiErrorMsg(c, "该扣分记录已打回")
			return
		}
		common.ApiErrorMsg(c, err.Error())
		return
	}
	// 管理审计归属被操作用户，params 携带打回详情（分数/删词），前端按 action 模板本地化渲染。
	recordManageAuditFor(c, userId, "risk_control.revert_keyword_deduction", map[string]interface{}{
		"log_id":       req.LogId,
		"points":       points,
		"remove_words": req.RemoveWords,
	})
	common.ApiSuccess(c, gin.H{"log_id": req.LogId, "balance": newBalance})
}

// ResetCreditScores 管理端全站信誉分重置：把所有用户 credit_score 设为当前满分，并清除
// 仍在冷却期的保证书（重置后可立即重新做保证书）。后台系统任务执行（带进度），逐用户落
// 审计明细（source=full_score_reset），可审计、可重跑。
func ResetCreditScores(c *gin.Context) {
	setting := operation_setting.GetCreditScoreSetting()
	if setting.FullScore <= 0 {
		common.ApiErrorMsg(c, "full_score must be positive")
		return
	}
	task, started, err := service.EnqueueSystemTask(model.SystemTaskTypeCreditScoreReset, nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "risk_control.reset_credit_scores", map[string]interface{}{
		"full_score": setting.FullScore,
	})
	common.ApiSuccess(c, gin.H{"started": started, "task_id": task.TaskID})
}

// GetCreditScoreResetStatus 信誉分重置任务状态（是否在跑含进度、最近一次结果/错误）。
func GetCreditScoreResetStatus(c *gin.Context) {
	status, err := service.GetCreditScoreResetStatus(c.Request.Context())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, status)
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

// AnalyzeMarkers 触发一次违规标记词 AI 分析（入队后台任务，带进度轮询）。body 可选
// force=true：先把水位线重置为 0，从建站第一条强制全跑（存量/历史全量重跑，不跳过任何
// 已分析日志）。常规触发（threshold/manual）只处理水位线之后的新增错误。
func AnalyzeMarkers(c *gin.Context) {
	var req struct {
		Force bool `json:"force"`
	}
	// body 可为空（旧调用不带 body），解码失败按 force=false 处理。
	_ = common.DecodeJson(c.Request.Body, &req)
	triggeredBy := "manual"
	if req.Force {
		triggeredBy = "force"
	}
	task, created, err := service.EnqueueSystemTask(model.SystemTaskTypeCreditMarkerAnalysis,
		service.MarkerAnalysisTaskPayload{Force: req.Force, TriggeredBy: triggeredBy})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"started": created, "task_id": task.TaskID})
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

// GetMarkerAnalysisLogs 标记词 AI 分析运行历史（审计：时间/用量/是否调用了模型）。
func GetMarkerAnalysisLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	logs, total, err := model.ListCreditMarkerAnalysisLogs(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

// GetMarkerAnalysisErrorStats 风控中心「错误积压」：累计全部/已分析/未分析错误日志条数
// + 当前定量触发配置，供前端可视化判断阈值何时达到（未分析 = 水位线之后新增，无窗口）。
func GetMarkerAnalysisErrorStats(c *gin.Context) {
	stats, err := service.GetMarkerAnalysisErrorStats(c.Request.Context())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, stats)
}

// GetMarkerAnalysisStatus 分析任务卡片状态：是否在跑（含进度）、最近一次结果/错误。
func GetMarkerAnalysisStatus(c *gin.Context) {
	status, err := service.GetMarkerAnalysisStatus(c.Request.Context())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, status)
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

// FetchMarkerAnalysisUpstreamModels 拉取自定义端点（上游 /v1/models）的模型列表，供 custom
// 模式下"自动获取"分析模型用。base_url/api_key 均为管理员配置的部署目标，走通用 outbound client。
func FetchMarkerAnalysisUpstreamModels(c *gin.Context) {
	var req struct {
		BaseUrl string `json:"base_url"`
		ApiKey  string `json:"api_key"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	baseURL := strings.TrimRight(strings.TrimSpace(req.BaseUrl), "/")
	if baseURL == "" {
		common.ApiErrorMsg(c, "base_url is required")
		return
	}
	httpReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, baseURL+"/models", nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ApiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+req.ApiKey)
	}
	httpReq.Header.Set("Accept", "application/json")
	resp, err := service.GetHttpClient().Do(httpReq)
	if err != nil {
		common.ApiErrorMsg(c, "fetch upstream models failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if resp.StatusCode != http.StatusOK {
		common.ApiErrorMsg(c, fmt.Sprintf("upstream /models http %d: %s", resp.StatusCode, truncateBytes(string(raw), 200)))
		return
	}
	var parsed struct {
		Data []struct {
			Id string `json:"id"`
		} `json:"data"`
	}
	if err := common.Unmarshal(raw, &parsed); err != nil {
		common.ApiErrorMsg(c, "parse upstream models failed: "+err.Error())
		return
	}
	models := make([]string, 0, len(parsed.Data))
	seen := make(map[string]bool)
	for _, m := range parsed.Data {
		id := strings.TrimSpace(m.Id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		models = append(models, id)
	}
	common.ApiSuccess(c, gin.H{"models": models})
}

// ResetRiskControlMarkers 把违规标记词重置为系统初始自带的默认值（"重置"按钮语义）。
func ResetRiskControlMarkers(c *gin.Context) {
	setting := operation_setting.GetCreditScoreSetting()
	setting.ViolationMarkers = operation_setting.DefaultViolationMarkers
	if err := model.UpdateOption("credit_score_setting.violation_markers", operation_setting.DefaultViolationMarkers); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"markers": splitMarkerLines(setting.ViolationMarkers)})
}

// ResetMarkerAnalysisPrompt 把标记词分析的提示词重置为系统内置默认值（"恢复默认"按钮语义），
// 与 ResetRiskControlMarkers 对称。返回默认提示词供前端回填表单。
func ResetMarkerAnalysisPrompt(c *gin.Context) {
	setting := operation_setting.GetCreditScoreSetting()
	setting.MarkerAnalysisPrompt = operation_setting.DefaultMarkerAnalysisPrompt
	if err := model.UpdateOption("credit_score_setting.marker_analysis_prompt", operation_setting.DefaultMarkerAnalysisPrompt); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "risk_control.marker_analysis_prompt_reset", map[string]interface{}{})
	common.ApiSuccess(c, gin.H{"prompt": operation_setting.DefaultMarkerAnalysisPrompt})
}

// GetMarkerAnalysisTokenStatus 套娃内部 token 状态（值敏感不回显，只给 masked 尾号 + 分组）。
// 同时返回本站内部 base_url（自动按运行端口推断），供前端"本站套娃"预设自动填充——
// 不用管理员手改非标端口。
func GetMarkerAnalysisTokenStatus(c *gin.Context) {
	setting := operation_setting.GetCreditScoreSetting()
	maskedKey := ""
	tokenGroup := ""
	if setting.MarkerAnalysisInternalToken != "" {
		maskedKey = model.MaskTokenKey(setting.MarkerAnalysisInternalToken)
		// token 表的 group 才是真实路由分组：option 里的 group 可能被设置页单独保存过
		// （改分组没重新生成），前端据此红字提示需要重新生成。
		if t, err := model.GetTokenByKey(setting.MarkerAnalysisInternalToken, false); err == nil {
			tokenGroup = t.Group
		}
	}
	common.ApiSuccess(c, gin.H{
		"configured":        setting.MarkerAnalysisInternalToken != "",
		"masked_key":        maskedKey,
		"group":             setting.MarkerAnalysisInternalGroup,
		"token_group":       tokenGroup,
		"internal_base_url": buildInternalAnalysisBaseURL(),
	})
}

// buildInternalAnalysisBaseURL 构造后端进程可达的自身 /v1 地址（回环 + 运行端口）。
// 套娃请求从后端进程发往此处，不经过外部反代，127.0.0.1 一定可达。
func buildInternalAnalysisBaseURL() string {
	port := os.Getenv("PORT")
	if port == "" {
		port = strconv.Itoa(*common.Port)
	}
	return "http://127.0.0.1:" + port + "/v1"
}

// RegenerateAnalysisToken 生成/重生成套娃内部 token：挂 root、allow_ips 仅本地回环、
// 永不过期、额度不限；旧 token 立即禁用，避免重新生成后旧值仍可免交互使用。
func RegenerateAnalysisToken(c *gin.Context) {
	var req struct {
		Group string `json:"group"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	req.Group = strings.TrimSpace(req.Group)
	// auto 分组按用户所在组动态路由，内部 token 需要固定的分组才能路由渠道，直接拒绝。
	if req.Group == "auto" {
		common.ApiErrorMsg(c, "auto group is not allowed for the internal analysis token")
		return
	}
	if _, ok := ratio_setting.GetGroupRatioCopy()[req.Group]; !ok {
		common.ApiErrorMsg(c, fmt.Sprintf("invalid group: %s", req.Group))
		return
	}
	rootUser := model.GetRootUser()
	if rootUser == nil || rootUser.Id == 0 {
		common.ApiErrorMsg(c, "root user not found")
		return
	}
	setting := operation_setting.GetCreditScoreSetting()
	// 删除旧 token：重新生成后旧值立即作废。内部 token 无审计价值，删除比禁用更干净
	// （不留堆积的失效行）；token.Delete 走软删除，auth 查询会自动排除，即刻不可用。
	if oldKey := setting.MarkerAnalysisInternalToken; oldKey != "" {
		if oldToken, err := model.GetTokenByKey(oldKey, false); err == nil {
			if delErr := oldToken.Delete(); delErr != nil {
				common.SysLog("failed to delete old marker analysis token: " + delErr.Error())
			}
		}
	}
	key, err := common.GenerateKey()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	allowIps := "127.0.0.1\n::1"
	token := model.Token{
		UserId:         rootUser.Id,
		Name:           model.InternalTokenNamePrefix + " (risk-control)",
		Key:            key,
		CreatedTime:    common.GetTimestamp(),
		AccessedTime:   common.GetTimestamp(),
		ExpiredTime:    -1,
		UnlimitedQuota: true,
		AllowIps:       &allowIps,
		Group:          req.Group,
	}
	if err := token.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption("credit_score_setting.marker_analysis_internal_token", key); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption("credit_score_setting.marker_analysis_internal_group", req.Group); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"configured": true,
		"masked_key": model.MaskTokenKey(key),
		"group":      req.Group,
	})
}
