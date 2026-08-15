package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// minMarkerSuggestionLength AI 建议标记词的最小长度（按 rune 计），过滤掉过短
// 的噪音词（如单字符），避免一采纳就全站误伤。
const minMarkerSuggestionLength = 3

// markerSuggestion 分析模型返回的单条建议。
type markerSuggestion struct {
	Marker  string `json:"marker"`
	Example string `json:"example"`
	Reason  string `json:"reason"`
}

type tokenUsage struct {
	Prompt     int
	Completion int
	Total      int
}

// AnalyzeRecentErrorLogs 违规标记词 AI 自动学习：拉近期错误日志 → 直连 HTTP 调配置的
// OpenAI 兼容分析端点 → 提取疑似内容安全拒绝的稳定子串 → 存 pending 建议（管理员手动采纳，
// 不自动加词）。每次运行落分析日志（时间/用量/成本）。base_url 可填站点自身地址实现套娃。
// force=true 时忽略"已分析去重"过滤，重新分析窗口内所有候选日志（管理员想重查不采纳的建议时用）。
func AnalyzeRecentErrorLogs(ctx context.Context, triggeredBy string, force bool) (map[string]int, error) {
	setting := operation_setting.GetCreditScoreSetting()
	if !setting.MarkerAnalysisEnabled {
		return map[string]int{"analyzed": 0, "suggestions": 0}, nil
	}
	baseURL := strings.TrimRight(setting.MarkerAnalysisBaseUrl, "/")
	if baseURL == "" || setting.MarkerAnalysisModel == "" {
		return nil, fmt.Errorf("marker analysis 未配置 base_url/model")
	}
	startTime := time.Now()

	errorTexts, err := fetchRecentErrorLogs(ctx, 24*3600, 200, force)
	if err != nil {
		logMarkerAnalysisRun(startTime, triggeredBy, 0, 0, 0, setting.MarkerAnalysisModel, baseURL, 0, err.Error())
		return nil, err
	}
	candidates := filterMarkerCandidates(errorTexts, setting)
	if len(candidates) > 20 {
		candidates = candidates[:20]
	}
	if len(candidates) == 0 {
		logMarkerAnalysisRun(startTime, triggeredBy, 0, 0, 0, setting.MarkerAnalysisModel, baseURL, 0, "")
		return map[string]int{"analyzed": 0, "suggestions": 0}, nil
	}

	candidateTexts := make([]string, 0, len(candidates))
	candidateIds := make([]int64, 0, len(candidates))
	for _, cand := range candidates {
		candidateTexts = append(candidateTexts, cand.Text)
		candidateIds = append(candidateIds, int64(cand.Id))
	}

	suggestions, usage, callErr := callMarkerAnalysisModel(ctx, setting, candidateTexts)
	// 只有模型调用成功才标记"已分析"：失败不标记，下次手动分析可重试（避免配置
	// 修好后日志被永久跳过）。已标记的日志不再进入后续分析，不采纳建议也不会反复报。
	if callErr == nil {
		if markErr := model.MarkErrorLogsAnalyzed(candidateIds); markErr != nil {
			common.SysLog("failed to mark analyzed error logs: " + markErr.Error())
		}
	}
	inserted := 0
	if callErr == nil {
		for _, s := range suggestions {
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
				// 强制重新分析：刷新已存在的 pending 建议（内容更新、计入产出），
				// 而不是跳过——否则"强制"后显示 analyzed:1/suggestions:0 像白跑。
				// 已采纳（accepted）的建议不刷新，rejected 的走下方重新插入。
				if force && refreshPendingSuggestion(s) {
					inserted++
				}
				continue
			}
			sug := &model.CreditMarkerSuggestion{
				Marker:  s.Marker,
				Example: truncate500(s.Example),
				Reason:  truncate500(s.Reason),
				Source:  "ai",
			}
			if err := model.InsertCreditMarkerSuggestion(sug); err == nil {
				inserted++
			}
		}
	}

	errMsg := ""
	if callErr != nil {
		errMsg = callErr.Error()
	}
	logMarkerAnalysisRun(startTime, triggeredBy, len(candidates), usage.Prompt, usage.Completion, setting.MarkerAnalysisModel, baseURL, inserted, errMsg)
	if callErr != nil {
		return nil, callErr
	}
	return map[string]int{"analyzed": len(candidates), "suggestions": inserted}, nil
}

// errorLogCandidate 一条待分析错误日志：保留日志 ID 用于"已分析去重"标记。
type errorLogCandidate struct {
	Id   int
	Text string
}

// fetchRecentErrorLogs 拉最近窗口内的错误日志。默认剔除已被分析过的（避免同一条日志被反复
// 分析——尤其管理员不采纳建议后，二次分析会重复报同一条）；force=true 时忽略该过滤（强制重
// 查全部候选）。同文本多日志只保留一条。
func fetchRecentErrorLogs(ctx context.Context, windowSec int64, limit int, force bool) ([]errorLogCandidate, error) {
	if limit <= 0 {
		limit = 200
	}
	var analyzed map[int64]bool
	if !force {
		analyzed, _ = model.GetAnalyzedErrorLogIds()
	}
	var logs []model.Log
	err := model.LOG_DB.WithContext(ctx).
		Where("type = ?", model.LogTypeError).
		Where("content != ''").
		Where("created_at >= ?", time.Now().Add(-time.Duration(windowSec)*time.Second).Unix()).
		Order("id desc").Limit(limit).Find(&logs).Error
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	out := make([]errorLogCandidate, 0, len(logs))
	for _, l := range logs {
		if analyzed != nil && analyzed[int64(l.Id)] {
			continue
		}
		text := truncate500(l.Content)
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, errorLogCandidate{Id: l.Id, Text: text})
	}
	return out, nil
}

// filterMarkerCandidates 粗筛：未被现有标记命中、且含疑似内容安全的词，控制分析成本。
func filterMarkerCandidates(texts []errorLogCandidate, setting *operation_setting.CreditScoreSetting) []errorLogCandidate {
	safetyHints := []string{
		"sensitive", "moderation", "violat", "block", "refus",
		"违规", "敏感", "不当", "审核", "check your input", "content policy",
	}
	out := make([]errorLogCandidate, 0, len(texts))
	for _, t := range texts {
		if setting.HasUpstreamViolationMarker(t.Text) {
			continue // 已命中现有标记，无需分析
		}
		lower := strings.ToLower(t.Text)
		hit := false
		for _, h := range safetyHints {
			if strings.Contains(lower, h) {
				hit = true
				break
			}
		}
		if !hit {
			continue
		}
		out = append(out, t)
	}
	return out
}

func callMarkerAnalysisModel(ctx context.Context, setting *operation_setting.CreditScoreSetting, candidates []string) ([]markerSuggestion, tokenUsage, error) {
	systemPrompt := `你是 AI 网关的风控标记词分析师。下面给你一批上游 LLM 返回的错误信息（每条用 --- 分隔）。请判断哪些属于"内容安全违规拒绝"（用户输入或内容被上游安全系统拦截），而不是普通技术错误（限流、超时、鉴权失败、模型不存在等）。对每条疑似违规，提取一个稳定、简短、可用于子串匹配的标记词（英文优先，小写）。只输出 JSON：{"suggestions":[{"marker":"...","example":"原文片段","reason":"为什么判定为内容安全拒绝"}]}。若没有疑似违规，输出 {"suggestions":[]}。`
	body := map[string]any{
		"model":       setting.MarkerAnalysisModel,
		"temperature": 0,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": strings.Join(candidates, "\n---\n")},
		},
	}
	data, err := common.Marshal(body)
	if err != nil {
		return nil, tokenUsage{}, err
	}
	// base_url 配置可能带尾部斜杠，TrimRight 后用拼接避免双斜杠（与 AnalyzeRecentErrorLogs 的 baseURL 计算一致）。
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
		return nil, tokenUsage{}, fmt.Errorf("marker analysis http %d: %s", resp.StatusCode, truncate500(string(raw)))
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
// （example/reason 更新），避免重复堆积；返回是否刷新成功（用于产出计数）。
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
	}).Error == nil
}

func logMarkerAnalysisRun(startTime time.Time, triggeredBy string, analyzedCount, promptTokens, completionTokens int, modelName, baseURL string, suggestionsCount int, errMsg string) {
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
		ErrorMessage:     errMsg,
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
