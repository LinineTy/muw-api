package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// minMarkerSuggestionLength AI 建议标记词的最小长度（按 rune 计），过滤掉过短
// 的噪音词（如单字符），避免一采纳就全站误伤。
const minMarkerSuggestionLength = 3

// markerAnalysisWatermarkOption 水位线持久化用的 option key。
const markerAnalysisWatermarkOption = "credit_score_setting.marker_analysis_watermark"

// markerAnalysisBatchSize 分析每批喂模型的错误文案条数。全量喂入 + 按 id 升序分批，
// 批大小控制单次 prompt 规模（存量批量分析已验证该量级）。
const markerAnalysisBatchSize = 50

// markerAnalysisAutoMinInterval 自动触发（写日志路径 / 任务结束自续）的最小间隔。
// 积压持续超阈值时会反复触发，用节流避免打爆分析模型；失败后的自愈重试也按此兜底。
const markerAnalysisAutoMinInterval = 5 * time.Minute

// lastMarkerAnalysisAutoTrigger 上次自动入队分析的 unix 秒（内存节流，重启归零无碍）。
var lastMarkerAnalysisAutoTrigger atomic.Int64

// markerAnalysisMaxRetries 单批分析请求遇 429/5xx 时的最大重试次数（指数退避）。
const markerAnalysisMaxRetries = 3

// markerAnalysisMinRetryBackoff 重试退避的最小等待（配置间隔为 0 时也至少等这么久）。
const markerAnalysisMinRetryBackoff = 1 * time.Second

// markerAnalysisRetryableError 上游限流/服务端临时错误（429/5xx），可按退避重试。
type markerAnalysisRetryableError struct {
	status int
	body   string
}

func (e *markerAnalysisRetryableError) Error() string {
	return fmt.Sprintf("marker analysis http %d: %s", e.status, e.body)
}

// MarkerAnalysisErrorStats 风控中心「错误积压」可视化数据：累计（自建站以来）错误日志
// 条数，未分析 = 水位线之后的新增（无 24h 窗口，几天没分析就累计几天）。
type MarkerAnalysisErrorStats struct {
	TotalErrorLogs   int64 `json:"total_error_logs"`
	UnanalyzedLogs   int64 `json:"unanalyzed_error_logs"`
	AnalyzedLogs     int64 `json:"analyzed_error_logs"`
	ThresholdEnabled bool  `json:"threshold_enabled"`
	ThresholdCount   int   `json:"threshold_count"`
	Watermark        int64 `json:"watermark"`
}

// MarkerAnalysisTaskPayload 分析任务入参。Force=true 先把水位线重置为 0（= 从建站第一条
// 强制全跑，不跳过任何已分析日志），再整批重喂。TriggeredBy 记录触发来源（manual/threshold/force）。
type MarkerAnalysisTaskPayload struct {
	Force       bool   `json:"force"`
	TriggeredBy string `json:"triggered_by"`
}

// MarkerAnalysisTaskState 分析任务进度（写入系统任务 state，前端轮询展示）。
type MarkerAnalysisTaskState struct {
	Total       int `json:"total"`
	Processed   int `json:"processed"`
	Suggestions int `json:"suggestions"`
	Progress    int `json:"progress"`
}

// MarkerAnalysisStatus 风控中心分析卡片状态：是否在跑（含进度）、最近一次结果/错误。
type MarkerAnalysisStatus struct {
	Running bool                     `json:"running"`
	State   *MarkerAnalysisTaskState `json:"state,omitempty"`
	Last    *MarkerAnalysisLastRun   `json:"last,omitempty"`
}

// MarkerAnalysisLastRun 最近一次分析任务的结果（成功或失败都算）。
type MarkerAnalysisLastRun struct {
	Analyzed    int    `json:"analyzed"`
	Suggestions int    `json:"suggestions"`
	Error       string `json:"error"`
	FinishedAt  int64  `json:"finished_at"`
}

// getMarkerWatermark 返回水位线（已处理到的错误日志最大 id）。0 表示从未分析（= 从头）。
func getMarkerWatermark() int64 {
	return operation_setting.GetCreditScoreSetting().MarkerAnalysisWatermark
}

// setMarkerWatermark 写回水位线并持久化。model.UpdateOption 会经 handleConfigUpdate
// 同步内存结构体，重启后 LoadFromDB 再读回，水位线跨重启准确。
func setMarkerWatermark(v int64) {
	if v < 0 {
		v = 0
	}
	if err := model.UpdateOption(markerAnalysisWatermarkOption, strconv.FormatInt(v, 10)); err != nil {
		common.SysLog("failed to persist marker analysis watermark: " + err.Error())
	}
}

// CountMarkerAnalysisBacklog 统计水位线之后未分析的错误日志条数（累计，无窗口）。
// 只依赖水位线做一次索引 COUNT，无需加载已分析集合，成本 O(1)。
func CountMarkerAnalysisBacklog(ctx context.Context, watermark int64) (int64, error) {
	var total int64
	err := model.LOG_DB.WithContext(ctx).Model(&model.Log{}).
		Where("type = ?", model.LogTypeError).
		Where("content != ''").
		Where("id > ?", watermark).
		Count(&total).Error
	return total, err
}

// countAllErrorLogs 统计全部错误日志条数（content 非空）。
func countAllErrorLogs(ctx context.Context) (int64, error) {
	var total int64
	err := model.LOG_DB.WithContext(ctx).Model(&model.Log{}).
		Where("type = ?", model.LogTypeError).
		Where("content != ''").
		Count(&total).Error
	return total, err
}

// GetMarkerAnalysisErrorStats 组装风控中心「错误积压」接口数据（含当前触发配置）。
func GetMarkerAnalysisErrorStats(ctx context.Context) (*MarkerAnalysisErrorStats, error) {
	total, err := countAllErrorLogs(ctx)
	if err != nil {
		return nil, err
	}
	unanalyzed, err := CountMarkerAnalysisBacklog(ctx, getMarkerWatermark())
	if err != nil {
		return nil, err
	}
	setting := operation_setting.GetCreditScoreSetting()
	return &MarkerAnalysisErrorStats{
		TotalErrorLogs:   total,
		UnanalyzedLogs:   unanalyzed,
		AnalyzedLogs:     total - unanalyzed,
		ThresholdEnabled: setting.MarkerAnalysisThresholdEnabled,
		ThresholdCount:   setting.MarkerAnalysisThresholdCount,
		Watermark:        getMarkerWatermark(),
	}, nil
}

// MaybeTriggerMarkerAnalysis 写错误日志路径的自动触发：定量开关开着且未分析积压（水位线
// 之后）达到阈值时入队分析任务。带最小间隔节流。任务结束后也调用它做自续/失败重试。
// 注意：完全静默（无新错误日志）时若分析一直失败，需等下一次错误日志写入或管理员手动
// 点击才会重试——这是"量到了就分析、无定时调度"的取舍。
func MaybeTriggerMarkerAnalysis(ctx context.Context) {
	setting := operation_setting.GetCreditScoreSetting()
	if !setting.MarkerAnalysisEnabled || !setting.MarkerAnalysisThresholdEnabled || setting.MarkerAnalysisThresholdCount <= 0 {
		return
	}
	if time.Now().Unix()-lastMarkerAnalysisAutoTrigger.Load() < int64(markerAnalysisAutoMinInterval/time.Second) {
		return
	}
	n, err := CountMarkerAnalysisBacklog(ctx, getMarkerWatermark())
	if err != nil {
		common.SysLog("marker analysis auto trigger count failed: " + err.Error())
		return
	}
	if n < int64(setting.MarkerAnalysisThresholdCount) {
		return
	}
	if _, created, err := EnqueueSystemTask(model.SystemTaskTypeCreditMarkerAnalysis, MarkerAnalysisTaskPayload{TriggeredBy: "threshold"}); err != nil {
		common.SysLog("marker analysis auto trigger enqueue failed: " + err.Error())
		return
	} else if created {
		lastMarkerAnalysisAutoTrigger.Store(time.Now().Unix())
	}
}

// GetMarkerAnalysisStatus 组装风控中心分析卡片状态：是否在跑（含进度）、最近一次结果/错误。
func GetMarkerAnalysisStatus(ctx context.Context) (*MarkerAnalysisStatus, error) {
	status := &MarkerAnalysisStatus{}
	if task, err := model.GetActiveSystemTask(model.SystemTaskTypeCreditMarkerAnalysis); err != nil {
		return nil, err
	} else if task != nil {
		status.Running = true
		st := &MarkerAnalysisTaskState{}
		_ = task.DecodeState(st)
		status.State = st
	}
	if last, err := model.GetLatestSystemTask(model.SystemTaskTypeCreditMarkerAnalysis); err != nil {
		return nil, err
	} else if last != nil && (last.Status == model.SystemTaskStatusSucceeded || last.Status == model.SystemTaskStatusFailed) {
		status.Last = &MarkerAnalysisLastRun{FinishedAt: last.UpdatedAt, Error: last.Error}
		if last.Status == model.SystemTaskStatusSucceeded {
			var result map[string]int
			if err := last.DecodeResult(&result); err == nil {
				status.Last.Analyzed = result["analyzed"]
				status.Last.Suggestions = result["suggestions"]
			}
		}
	}
	return status, nil
}

// markerSuggestion 分析模型返回的单条建议。LogIds 为管道按 marker 子串匹配关联到的源错误
// 日志 id（可为空：匹配不到不丢弃建议，管理员凭 example + 日志 id 自行核对）。
type markerSuggestion struct {
	Marker  string  `json:"marker"`
	Example string  `json:"example"`
	Reason  string  `json:"reason"`
	LogIds  []int64 `json:"log_ids"`
}

type tokenUsage struct {
	Prompt     int
	Completion int
	Total      int
}

// AnalyzeMarkerBacklog 违规标记词 AI 分析统一管道：从水位线开始按 id 升序分批取未分析
// 错误日志（触发时点快照 = 当时的最大 id），每批全量喂给模型（不预筛，只按文本去重），
// 成功批推进水位线并落分析历史；失败批不推进水位线，下次触发从原水位线重试。
// Force=true 先把水位线重置为 0，从头跑到当前（存量/历史全量重跑，不跳过已分析日志）。
// onProgress 每批推进时回调（供任务框架写系统任务 state），可为 nil。
func AnalyzeMarkerBacklog(ctx context.Context, triggeredBy string, force bool, onProgress func(MarkerAnalysisTaskState)) (map[string]int, error) {
	setting := operation_setting.GetCreditScoreSetting()
	if !setting.MarkerAnalysisEnabled {
		return map[string]int{"analyzed": 0, "suggestions": 0}, nil
	}
	baseURL := strings.TrimRight(setting.MarkerAnalysisBaseUrl, "/")
	if baseURL == "" || setting.MarkerAnalysisModel == "" {
		return nil, fmt.Errorf("marker analysis 未配置 base_url/model")
	}
	promptUsed := markerPromptFingerprint(setting.MarkerAnalysisPrompt)
	startTime := time.Now()
	if force {
		common.SysLog("marker analysis: force reset watermark to 0, re-running from site start")
		setMarkerWatermark(0)
	}
	watermark := getMarkerWatermark()

	// 快照：本次只处理到触发时刻的最大错误日志 id，运行期间新增的留到下一次触发。
	var target int64
	if err := model.LOG_DB.WithContext(ctx).Model(&model.Log{}).
		Where("type = ?", model.LogTypeError).
		Where("content != ''").
		Select("COALESCE(MAX(id), 0)").
		Scan(&target).Error; err != nil {
		logMarkerAnalysisRun(startTime, triggeredBy, 0, 0, 0, setting.MarkerAnalysisModel, baseURL, promptUsed, 0, 0, err.Error())
		return nil, err
	}
	if target <= watermark {
		logMarkerAnalysisRun(startTime, triggeredBy, 0, 0, 0, setting.MarkerAnalysisModel, baseURL, promptUsed, 0, 0, "")
		return map[string]int{"analyzed": 0, "suggestions": 0}, nil
	}

	startWatermark := watermark
	fed, inserted, promptTokens, completionTokens, totalRetried := 0, 0, 0, 0, 0
	interval := time.Duration(setting.MarkerAnalysisRequestIntervalMS) * time.Millisecond
	if interval < 0 {
		interval = 0
	}
	var lastModelCall time.Time

	for watermark < target {
		if err := ctx.Err(); err != nil {
			// 中断不推进水位线，下次触发重试。
			return nil, err
		}
		batch, err := fetchMarkerAnalysisBatch(ctx, watermark, target)
		if err != nil {
			logMarkerAnalysisRun(startTime, triggeredBy, fed, promptTokens, completionTokens, setting.MarkerAnalysisModel, baseURL, promptUsed, inserted, 0, err.Error())
			return nil, err
		}
		if batch == nil {
			break
		}
		// 本批取到的最大 id 就是水位线要推进到的位置（重复文本/无内容日志不喂模型，直接跳过）。
		watermark = batch.MaxId
		if len(batch.Unique) == 0 {
			setMarkerWatermark(watermark)
			reportMarkerAnalysisProgress(onProgress, watermark, startWatermark, target, inserted)
			continue
		}
		batchTexts := make([]string, 0, len(batch.Unique))
		batchIds := make([]int64, 0, len(batch.Unique))
		for _, cand := range batch.Unique {
			batchTexts = append(batchTexts, cand.Text)
			batchIds = append(batchIds, int64(cand.Id))
		}
		// 限速：两次模型调用之间至少间隔配置值（全量分析连续请求易被上游限流 429）。
		if wait := interval - time.Since(lastModelCall); wait > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(wait):
			}
		}
		sugs, usage, retried, callErr := callMarkerAnalysisModelWithRetry(ctx, setting, batchTexts, interval)
		totalRetried += retried
		lastModelCall = time.Now()
		if callErr != nil {
			// 失败批不推进水位线（下次触发重试），落一条部分运行历史供审计。
			logMarkerAnalysisRun(startTime, triggeredBy, fed+len(batch.Unique), promptTokens, completionTokens, setting.MarkerAnalysisModel, baseURL, promptUsed, inserted, totalRetried, callErr.Error())
			return nil, callErr
		}
		promptTokens += usage.Prompt
		completionTokens += usage.Completion
		fed += len(batch.Unique)
		// 成功批标记已分析（审计留痕；水位线才是"处理到哪"的判定依据）。
		if markErr := model.MarkErrorLogsAnalyzed(batchIds); markErr != nil {
			common.SysLog("failed to mark analyzed error logs: " + markErr.Error())
		}
		inserted += insertMarkerSuggestions(associateSuggestionLogs(sugs, batch.Unique), force)
		setMarkerWatermark(watermark)
		reportMarkerAnalysisProgress(onProgress, watermark, startWatermark, target, inserted)
	}

	logMarkerAnalysisRun(startTime, triggeredBy, fed, promptTokens, completionTokens, setting.MarkerAnalysisModel, baseURL, promptUsed, inserted, totalRetried, "")
	return map[string]int{"analyzed": fed, "suggestions": inserted}, nil
}

// reportMarkerAnalysisProgress 计算并按 id 跨度推进比例回调当前进度。
func reportMarkerAnalysisProgress(onProgress func(MarkerAnalysisTaskState), watermark, start, target int64, suggestions int) {
	if onProgress == nil {
		return
	}
	state := MarkerAnalysisTaskState{
		Total:       int(target - start),
		Processed:   int(watermark - start),
		Suggestions: suggestions,
		Progress:    percentProgress(watermark-start, target-start),
	}
	onProgress(state)
}

// markerAnalysisBatch 一批取到的错误日志：Unique 为按文本去重后的候选（喂模型），
// MaxId 为本批取到的最大日志 id（水位线推进到它，重复文本直接跳过）。
type markerAnalysisBatch struct {
	Unique []errorLogCandidate
	MaxId  int64
}

// fetchMarkerAnalysisBatch 取一批未分析错误日志（id > watermark 且 id <= target，升序，
// 最多 markerAnalysisBatchSize 条）。同文本只保留一条，避免把重复错误喂给模型。
func fetchMarkerAnalysisBatch(ctx context.Context, watermark, target int64) (*markerAnalysisBatch, error) {
	var logs []model.Log
	err := model.LOG_DB.WithContext(ctx).
		Where("type = ?", model.LogTypeError).
		Where("content != ''").
		Where("id > ? AND id <= ?", watermark, target).
		Order("id asc").Limit(markerAnalysisBatchSize).Find(&logs).Error
	if err != nil {
		return nil, err
	}
	if len(logs) == 0 {
		return nil, nil
	}
	seen := make(map[string]bool)
	out := make([]errorLogCandidate, 0, len(logs))
	for _, l := range logs {
		text := truncate500(l.Content)
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, errorLogCandidate{Id: l.Id, Text: text})
	}
	return &markerAnalysisBatch{Unique: out, MaxId: int64(logs[len(logs)-1].Id)}, nil
}

// errorLogCandidate 一条待分析错误日志：保留日志 ID 用于水位线推进与"已分析"审计标记。
type errorLogCandidate struct {
	Id   int
	Text string
}

// associateSuggestionLogs 把每条建议关联到本批中 marker 子串命中的源错误日志 id。
// 纯 Go 侧 strings.Contains（无 shell/DB 编码问题），大小写不敏感。**匹配不到不丢弃**——
// 只留空 log_ids，管理员凭 example 与是否有日志 id 自行判断（避免误删合理建议）。
func associateSuggestionLogs(sugs []markerSuggestion, batch []errorLogCandidate) []markerSuggestion {
	if len(sugs) == 0 {
		return sugs
	}
	for i := range sugs {
		marker := strings.ToLower(strings.TrimSpace(sugs[i].Marker))
		if marker == "" {
			continue
		}
		var ids []int64
		for _, cand := range batch {
			if strings.Contains(strings.ToLower(cand.Text), marker) {
				ids = append(ids, int64(cand.Id))
			}
		}
		if len(ids) > 0 {
			sugs[i].LogIds = ids
		}
	}
	return sugs
}

// insertMarkerSuggestions 把分析模型返回的建议清洗（去空/过短/超长截断/去重）后入库。
// force=true 时对已存在的 pending 建议做刷新（内容更新、计入产出），而不是跳过——否则
// "强制"后显示 analyzed:1/suggestions:0 像白跑。已采纳（accepted）的建议不刷新，rejected
// 的走下方重新插入。返回实际入库/刷新的条数。
func insertMarkerSuggestions(sugs []markerSuggestion, force bool) int {
	inserted := 0
	for _, s := range sugs {
		s.Marker = strings.TrimSpace(s.Marker)
		if s.Marker == "" {
			continue
		}
		// 过短的标记子串匹配面太宽（如 "no"），直接丢弃。
		if utf8.RuneCountInString(s.Marker) < minMarkerSuggestionLength {
			continue
		}
		// AI 返回的标记词可能超长：落 varchar(255) 列，MySQL/PG 严格模式会拒绝超长，
		// 按 rune 边界截断到列长（截断失败静默丢失，管理员看不到该建议）。
		if len(s.Marker) > 255 {
			cut := 255
			for cut > 0 && !utf8.RuneStart(s.Marker[cut]) {
				cut--
			}
			s.Marker = s.Marker[:cut]
		}
		if markerSuggestionExists(s.Marker) {
			if force && refreshPendingSuggestion(s) {
				inserted++
			}
			continue
		}
		sug := &model.CreditMarkerSuggestion{
			Marker:  s.Marker,
			Example: truncate500(s.Example),
			Reason:  truncate500(s.Reason),
			LogIds:  marshalLogIds(s.LogIds),
			Source:  "ai",
		}
		if err := model.InsertCreditMarkerSuggestion(sug); err == nil {
			inserted++
		}
	}
	return inserted
}

// marshalLogIds 把日志 id 集合序列化成 JSON 数组文本（为空返回 ""）。
func marshalLogIds(ids []int64) string {
	if len(ids) == 0 {
		return ""
	}
	if b, err := common.Marshal(ids); err == nil {
		return string(b)
	}
	return ""
}

// callMarkerAnalysisModelWithRetry 调用分析模型，遇 429/5xx 按指数退避重试
// （最多 markerAnalysisMaxRetries 次，baseDelay 为 0 时也至少等 markerAnalysisMinRetryBackoff）。
// 返回实际发生的重试次数（供分析历史审计）。其余错误（4xx/解析失败）直接返回不重试。
func callMarkerAnalysisModelWithRetry(ctx context.Context, setting *operation_setting.CreditScoreSetting, texts []string, baseDelay time.Duration) ([]markerSuggestion, tokenUsage, int, error) {
	var (
		sugs    []markerSuggestion
		usage   tokenUsage
		lastErr error
		retried int
	)
	for attempt := 0; attempt <= markerAnalysisMaxRetries; attempt++ {
		if attempt > 0 {
			retried++
			wait := baseDelay * time.Duration(1<<(attempt-1))
			if wait < markerAnalysisMinRetryBackoff {
				wait = markerAnalysisMinRetryBackoff
			}
			select {
			case <-ctx.Done():
				return nil, tokenUsage{}, retried, ctx.Err()
			case <-time.After(wait):
			}
		}
		sugs, usage, lastErr = callMarkerAnalysisModel(ctx, setting, texts)
		if lastErr == nil {
			return sugs, usage, retried, nil
		}
		var retryable *markerAnalysisRetryableError
		if !errors.As(lastErr, &retryable) {
			return nil, tokenUsage{}, retried, lastErr
		}
		common.SysLog(fmt.Sprintf("marker analysis retryable error (%s), retrying %d/%d", retryable.Error(), attempt+1, markerAnalysisMaxRetries))
	}
	return nil, tokenUsage{}, retried, lastErr
}

func callMarkerAnalysisModel(ctx context.Context, setting *operation_setting.CreditScoreSetting, candidates []string) ([]markerSuggestion, tokenUsage, error) {
	systemPrompt := setting.MarkerAnalysisPrompt
	if systemPrompt == "" {
		systemPrompt = operation_setting.DefaultMarkerAnalysisPrompt
	}
	joined := strings.Join(candidates, "\n---\n")
	// 提示词可用 {messages} 占位符内嵌待分析消息（默认提示词如此）；不含占位符时消息追加到
	// user 角色（兼容自定义为纯 system 指令的旧式提示词）。
	userContent := joined
	if strings.Contains(systemPrompt, "{messages}") {
		systemPrompt = strings.ReplaceAll(systemPrompt, "{messages}", joined)
		userContent = "请按要求输出 JSON。"
	}
	body := map[string]any{
		"model":       setting.MarkerAnalysisModel,
		"temperature": 0,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userContent},
		},
	}
	data, err := common.Marshal(body)
	if err != nil {
		return nil, tokenUsage{}, err
	}
	// base_url 配置可能带尾部斜杠，TrimRight 后用拼接避免双斜杠（与 AnalyzeMarkerBacklog 的 baseURL 计算一致）。
	baseURL := strings.TrimRight(setting.MarkerAnalysisBaseUrl, "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, tokenUsage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	// 套娃：配置了内部 token 时优先用它调本站——自己的 relay 按 token_key 识别为内部
	// 子请求，跳过敏感词检测/对话留存/扣分（分析内容本身含违规特征，不能被自己的风控
	// 拦截）。未配置内部 token 时退回外部 api key。
	if setting.MarkerAnalysisInternalToken != "" {
		req.Header.Set("Authorization", "Bearer "+setting.MarkerAnalysisInternalToken)
	} else if setting.MarkerAnalysisApiKey != "" {
		req.Header.Set("Authorization", "Bearer "+setting.MarkerAnalysisApiKey)
	}

	resp, err := GetHttpClient().Do(req)
	if err != nil {
		return nil, tokenUsage{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, tokenUsage{}, err
	}
	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("marker analysis http %d: %s", resp.StatusCode, truncate500(string(raw)))
		// 429/5xx 是限流/服务端临时错误，标记为可重试（管道内按退避重试）。
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			return nil, tokenUsage{}, &markerAnalysisRetryableError{
				status: resp.StatusCode,
				body:   truncate500(string(raw)),
			}
		}
		return nil, tokenUsage{}, err
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := common.Unmarshal(raw, &parsed); err != nil {
		return nil, tokenUsage{}, err
	}
	if len(parsed.Choices) == 0 {
		return nil, tokenUsage{}, fmt.Errorf("分析模型返回空 choices")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)
	var result struct {
		Suggestions []markerSuggestion `json:"suggestions"`
	}
	if err := common.Unmarshal([]byte(content), &result); err != nil {
		return nil, tokenUsage{}, fmt.Errorf("解析分析结果失败: %s; content=%s", err.Error(), truncate500(content))
	}
	return result.Suggestions, tokenUsage{
		Prompt:     parsed.Usage.PromptTokens,
		Completion: parsed.Usage.CompletionTokens,
		Total:      parsed.Usage.TotalTokens,
	}, nil
}

func markerSuggestionExists(marker string) bool {
	// 词还在违规标记词中：已采纳，无需再建议（也是候选过滤的前提）。
	if operation_setting.GetCreditScoreSetting().HasUpstreamViolationMarker(marker) {
		return true
	}
	var count int64
	// 仅 pending 建议去重：accepted 的词已进入 violation_markers（上面拦截），若用户又
	// 从违规词中删掉该词，accepted 历史记录不应再挡着重新建议；rejected 同理。
	_ = model.DB.Model(&model.CreditMarkerSuggestion{}).
		Where("LOWER(marker) = LOWER(?) AND status = ?", marker, "pending").Count(&count).Error
	return count > 0
}

// refreshPendingSuggestion 强制重新分析时，用最新分析结果刷新已存在的 pending 建议
// （example/reason/log_ids 更新），避免重复堆积；返回是否刷新成功（用于产出计数）。
func refreshPendingSuggestion(s markerSuggestion) bool {
	var existing model.CreditMarkerSuggestion
	if err := model.DB.
		Where("LOWER(marker) = LOWER(?) AND status = ?", s.Marker, "pending").
		First(&existing).Error; err != nil {
		return false
	}
	return model.DB.Model(&existing).Updates(map[string]any{
		"example": truncate500(s.Example),
		"reason":  truncate500(s.Reason),
		"log_ids": marshalLogIds(s.LogIds),
	}).Error == nil
}

// markerPromptFingerprint 生成分析历史里用的提示词标识：默认提示词（或留空回退默认）返回
// "default"；自定义提示词返回其单行预览（换行折叠为空格、前 48 rune 加省略号）。审计用：
// 提示词可配置后，管理员能区分某批建议是在默认还是自定义提示词下产出的。
func markerPromptFingerprint(prompt string) string {
	if prompt == "" || prompt == operation_setting.DefaultMarkerAnalysisPrompt {
		return "default"
	}
	oneLine := strings.Join(strings.Fields(prompt), " ")
	if runes := []rune(oneLine); len(runes) > 48 {
		oneLine = string(runes[:48]) + "…"
	}
	return oneLine
}

func logMarkerAnalysisRun(startTime time.Time, triggeredBy string, analyzedCount, promptTokens, completionTokens int, modelName, baseURL, promptUsed string, suggestionsCount, retried int, errMsg string) {
	log := &model.CreditMarkerAnalysisLog{
		TriggeredBy:      triggeredBy,
		StartedAt:        startTime.Unix(),
		FinishedAt:       time.Now().Unix(),
		DurationMs:       time.Since(startTime).Milliseconds(),
		AnalyzedCount:    analyzedCount,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      promptTokens + completionTokens,
		Model:            modelName,
		BaseUrl:          maskMarkerBaseURL(baseURL),
		SuggestionsCount: suggestionsCount,
		Retried:          retried,
		ErrorMessage:     errMsg,
		PromptUsed:       promptUsed,
	}
	if err := model.InsertCreditMarkerAnalysisLog(log); err != nil {
		common.SysLog("failed to insert marker analysis log: " + err.Error())
	}
}

func maskMarkerBaseURL(u string) string {
	u = strings.TrimSpace(u)
	if len(u) <= 12 {
		return "***"
	}
	return u[:4] + "***" + u[len(u)-8:]
}

func truncate500(s string) string {
	if len(s) <= 500 {
		return s
	}
	// 回退到 rune 边界，避免切出非法 UTF-8（MySQL/PG 文本列会拒绝）。
	cut := 500
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}

// percentProgress 计算 0-100 进度，分母为 0 时视为已完成。
func percentProgress(processed, total int64) int {
	if total <= 0 {
		return 100
	}
	if processed <= 0 {
		return 0
	}
	if processed >= total {
		return 100
	}
	return int(processed * 100 / total)
}
