/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package model

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/relaykit/types"
)

// ChannelTestSourceTest marks records produced by scheduled auto-tests and
// manual channel tests (synthetic probes).
const ChannelTestSourceTest = "test"

// ChannelTestSourceUser marks records produced by real user traffic.
const ChannelTestSourceUser = "user"

// 失败归类(error_kind)——模型健康页按责任方给失败块分色,替代"失败一律红":
//
//	client     请求自身的毛病(参数/格式/模型名/超上下文/余额不足/权限),换渠道
//	           也救不了,不算渠道的病 → 黄
//	moderation 上游正常处理并返回内容审核拦截——渠道活着且全链路工作 → 绿
//	upstream   上游/系统侧问题(限流/配额/5xx/超时/渠道key失效) → 红
const (
	ErrorKindClient     = "client"
	ErrorKindModeration = "moderation"
	ErrorKindUpstream   = "upstream"
)

// moderationPatterns 内容审核特征。上游把审核拦截当业务结果返回(请求被正常
// 处理了),健康度语义上等价于成功。
var moderationPatterns = []string{
	"inappropriate content",
	"content_filter",
	"content policy",
	"sensitive", // input new_sensitive / sensitive_words 等
}

// clientPatterns 请求侧文本特征(上游透传的业务校验错误往往只剩文本)。
var clientPatterns = []string{
	"field ",      // field ReasoningEffort invalid / field Messages[0].Role invalid
	"must be",     // must be set / must be one of / must be passed back
	"not supported",
	"not found",   // model is not found
	"does not exist",
	"invalid request",
}

// upstreamPatterns 上游/系统侧文本特征。
// 注意不含 "bad response status code":那是本站给上游非 2xx 响应加的包装前缀
// (showBodyWhenFail 时拼在真实 message 前),不能作为上游责任的特征——这类错误
// 的责任方由状态码兜底判定(语义 4xx→client,429/401/403/5xx→upstream),删掉
// 后默认落兜底仍是红,行为不回退。
var upstreamPatterns = []string{
	"exhausted", // inference tpm exhausted / rpm exhausted
	"quota exceeded",
	"exceeded your current quota",
	"rate limit",
	"upstream", // upstream error / Upstream request failed
	"endpoint is unavailable",
	"internal server error",
	"do request failed",
	"session usage limit", // 上游套餐会话限额
}

func matchesAny(lowerMsg string, patterns []string) bool {
	for _, p := range patterns {
		if strings.Contains(lowerMsg, p) {
			return true
		}
	}
	return false
}

// ClassifyRelayError 把一次 relay 失败归类为 client / moderation / upstream。
// 判定顺序:结构化 errorCode 精确匹配 → 文本特征兜底 → 状态码 → 默认 upstream
// (拿不准的先标红,绝不把真实故障淡化成黄色)。nil 返回空串(调用方仅对失败记录)。
func ClassifyRelayError(apiErr *types.NewAPIError) string {
	if apiErr == nil {
		return ""
	}
	// 内容审核优先判定,避免被 client 的宽松文本(如 not supported)误吞。
	switch apiErr.GetErrorCode() {
	case types.ErrorCodeSensitiveWordsDetected, types.ErrorCodePromptBlocked:
		return ErrorKindModeration
	}
	lowerMsg := strings.ToLower(apiErr.Error())
	if matchesAny(lowerMsg, moderationPatterns) {
		return ErrorKindModeration
	}
	// 请求侧:改请求本身就能过(参数/格式/模型名/上下文窗口/余额/权限)。
	switch apiErr.GetErrorCode() {
	case types.ErrorCodeBadRequestBody,
		types.ErrorCodeReadRequestBodyFailed,
		types.ErrorCodeConvertRequestFailed,
		types.ErrorCodeContextWindowExceeded,
		types.ErrorCodeInvalidRequest,
		types.ErrorCodeAccessDenied,
		types.ErrorCodeInsufficientUserQuota,
		types.ErrorCodePreConsumeTokenQuotaFailed,
		types.ErrorCodeCreditScoreInsufficient,
		types.ErrorCodeModelNotFound:
		return ErrorKindClient
	}
	if matchesAny(lowerMsg, clientPatterns) {
		return ErrorKindClient
	}
	// 上游侧:明确的传输/响应错误码。BadResponseStatusCode 除外——它是
	// "上游原样返回非 2xx"的统一包装,真实语义在状态码里,单独分支判定。
	switch apiErr.GetErrorCode() {
	case types.ErrorCodeDoRequestFailed,
		types.ErrorCodeBadResponse,
		types.ErrorCodeBadResponseBody,
		types.ErrorCodeEmptyResponse,
		types.ErrorCodeReadResponseBodyFailed:
		return ErrorKindUpstream
	}
	// BadResponseStatusCode(上游非 2xx 包装,含非标准错误体如 Gemini 裸文本):
	// 状态码就是上游给出的判定。请求语义明确的 4xx(422 参数/格式,400/404/
	// 405/413/415 等)说明改请求才能过,归 client;401/403/429/5xx 是渠道
	// key/限流/故障,归 upstream。注意状态码可能已被渠道 status_code_mapping
	// 改写——那是站长配置的语义,尊重映射后的最终值。
	if apiErr.GetErrorCode() == types.ErrorCodeBadResponseStatusCode {
		switch apiErr.StatusCode {
		case 400, 404, 405, 413, 415, 422:
			return ErrorKindClient
		}
		return ErrorKindUpstream
	}
	if matchesAny(lowerMsg, upstreamPatterns) {
		return ErrorKindUpstream
	}
	// 状态码兜底:4xx 中请求语义明确的归 client;429/401/403/5xx 与未知
	// 一律 upstream——relay 阶段的 401/403 是渠道 key/上游鉴权问题,不是用户的。
	switch apiErr.StatusCode {
	case 400, 404, 405, 413, 415, 422:
		return ErrorKindClient
	}
	return ErrorKindUpstream
}

// ChannelTestRecord persists one channel connectivity probe (scheduled
// auto-test, manual test or real user traffic) so channel/model health can be
// aggregated over time: success rate, latency trend and recent errors.
type ChannelTestRecord struct {
	Id           int    `json:"id"`
	ChannelId    int    `json:"channel_id" gorm:"index"`
	ChannelName  string `json:"channel_name"`
	ModelName    string `json:"model_name" gorm:"index"`
	Success      bool   `json:"success"`
	ResponseTime int    `json:"response_time"` // milliseconds
	ErrorReason  string `json:"error_reason" gorm:"type:text"`
	// ErrorKind 失败归类(ErrorKindClient/Moderation/Upstream),成功时为空。
	// NULL/空 = 旧数据(未分类),展示侧按 upstream 红色保守渲染。
	ErrorKind string `json:"error_kind" gorm:"type:varchar(16);index"`
	Source    string `json:"source"` // ChannelTestSourceTest | ChannelTestSourceUser
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime;index"`
}

// TestTrendPoint is one probe in the recent history of a (channel, model) pair.
type TestTrendPoint struct {
	CreatedAt    int64 `json:"created_at"`
	ResponseTime int   `json:"response_time"`
	Success      bool  `json:"success"`
	// ErrorKind 失败归类,透传给前端心跳条分色;成功/旧数据为空。
	ErrorKind string `json:"error_kind,omitempty"`
}

// ModelHealthRow aggregates one (channel_id, model_name) pair over a window.
type ModelHealthRow struct {
	ChannelId        int              `json:"channel_id"`
	ChannelName      string           `json:"channel_name"`
	ModelName        string           `json:"model_name"`
	TestCount        int              `json:"test_count"`
	SuccessCount     int              `json:"success_count"`
	SuccessRate      float64          `json:"success_rate"` // 0-100, one decimal
	AvgResponseTime  int              `json:"avg_response_time"`
	LastResponseTime int              `json:"last_response_time"`
	LastTestTime     int64            `json:"last_test_time"`
	LastError        string           `json:"last_error"`
	LastErrorKind    string           `json:"last_error_kind"` // 最近一次展示错误的归类,配合圆点分色
	Trend            []TestTrendPoint `json:"trend"`
	// UserTrafficCount is how many of the TestCount records came from real user
	// traffic (ChannelTestSourceUser) rather than synthetic tests.
	UserTrafficCount int `json:"user_traffic_count"`
	// ClientErrorCount / ModerationCount 窗口内各类失败的条数。技术成功率把
	// client 错误从分母剔除、moderation 视作成功;原始成功率可由前端用
	// success_count/test_count 自行算出。
	ClientErrorCount     int `json:"client_error_count"`
	UpstreamErrorCount   int `json:"upstream_error_count"`
	ModerationCount      int `json:"moderation_count"`
}

// technicalSuccessRate 技术成功率 = (成功 + 审核拦截) / (总数 - client 错误)。
// 健康度语义是"换个正常请求,渠道能不能服务":client 错误是请求自身的毛病,
// 不该砸渠道的分数;moderation 是上游正常返回的业务结果,渠道工作正常。
// 分母归零(窗口内全是 client 错误)时返回 100——没有证据表明渠道有病。
func technicalSuccessRate(successCount, moderationCount, testCount, clientErrorCount int) float64 {
	denom := testCount - clientErrorCount
	if denom <= 0 {
		return 100
	}
	return math.Round(float64(successCount+moderationCount)/float64(denom)*1000) / 10
}

// channelTestTrendLimit bounds how many recent probes are kept per pair for the
// trend strip. Kept generous so the frontend can render as many fixed-size
// blocks as fit the container width on wide screens.
const channelTestTrendLimit = 200

// AggregateChannelTestRecords groups probe records by (channel_id, model_name)
// and computes per-pair success rate, latency stats, the most recent failure
// reason and a rolling trend. Records may arrive in any order; the function
// sorts chronologically internally. The result order is first-seen.
func AggregateChannelTestRecords(records []ChannelTestRecord) []ModelHealthRow {
	sorted := make([]ChannelTestRecord, len(records))
	copy(sorted, records)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].CreatedAt != sorted[j].CreatedAt {
			return sorted[i].CreatedAt < sorted[j].CreatedAt
		}
		return sorted[i].Id < sorted[j].Id
	})

	type acc struct {
		row        ModelHealthRow
		latencySum int64
		trend      []TestTrendPoint
		// lastAnyErr / lastNonClientErr 分别记录"最近一次任意失败"与"最近一次
		// 非 client 失败"(含 kind 为空的旧数据,视作上游侧)。LastError 优先展示
		// 非 client 错误——用户传错参数不该把真正的渠道故障从详情里顶掉。
		lastAnyErr        string
		lastAnyKind       string
		lastNonClientErr  string
		lastNonClientKind string
	}
	groups := make(map[string]*acc)
	var order []string
	for _, r := range sorted {
		key := fmt.Sprintf("%d|%s", r.ChannelId, r.ModelName)
		a, ok := groups[key]
		if !ok {
			a = &acc{row: ModelHealthRow{ChannelId: r.ChannelId, ChannelName: r.ChannelName, ModelName: r.ModelName}}
			groups[key] = a
			order = append(order, key)
		}
		a.row.TestCount++
		if r.Success {
			a.row.SuccessCount++
		} else {
			switch r.ErrorKind {
			case ErrorKindClient:
				a.row.ClientErrorCount++
			case ErrorKindModeration:
				a.row.ModerationCount++
			default: // upstream 及空(旧数据未分类,保守计上游)
				a.row.UpstreamErrorCount++
			}
		}
		if r.Source == ChannelTestSourceUser {
			a.row.UserTrafficCount++
		}
		a.latencySum += int64(r.ResponseTime)
		if r.CreatedAt >= a.row.LastTestTime {
			a.row.LastTestTime = r.CreatedAt
			a.row.LastResponseTime = r.ResponseTime
		}
		if !r.Success && r.ErrorReason != "" {
			a.lastAnyErr = r.ErrorReason // chronological order → most recent wins
			a.lastAnyKind = r.ErrorKind
			if r.ErrorKind != ErrorKindClient {
				a.lastNonClientErr = r.ErrorReason
				a.lastNonClientKind = r.ErrorKind
			}
		}
		if len(a.trend) < channelTestTrendLimit {
			a.trend = append(a.trend, TestTrendPoint{CreatedAt: r.CreatedAt, ResponseTime: r.ResponseTime, Success: r.Success, ErrorKind: r.ErrorKind})
		} else {
			copy(a.trend, a.trend[1:])
			a.trend[len(a.trend)-1] = TestTrendPoint{CreatedAt: r.CreatedAt, ResponseTime: r.ResponseTime, Success: r.Success, ErrorKind: r.ErrorKind}
		}
	}

	rows := make([]ModelHealthRow, 0, len(order))
	for _, key := range order {
		a := groups[key]
		if a.row.TestCount > 0 {
			a.row.AvgResponseTime = int(math.Round(float64(a.latencySum) / float64(a.row.TestCount)))
		}
		a.row.SuccessRate = technicalSuccessRate(a.row.SuccessCount, a.row.ModerationCount, a.row.TestCount, a.row.ClientErrorCount)
		if a.lastNonClientErr != "" {
			a.row.LastError = a.lastNonClientErr
			a.row.LastErrorKind = a.lastNonClientKind
		} else {
			a.row.LastError = a.lastAnyErr
			a.row.LastErrorKind = a.lastAnyKind
		}
		a.row.Trend = a.trend
		rows = append(rows, a.row)
	}
	return rows
}

// CollapseToModelLevel folds per-(channel, model) ModelHealthRow aggregation
// into one model-level row per model, dropping channel-scoped details. It backs
// the model health page for non-admin users, who must not learn channel
// identity, per-channel latency or error reasons. ChannelId, ChannelName and
// LastError are therefore always zeroed. Counts sum across channels, average
// response time is test-count weighted, and trends are merged and re-sorted
// chronologically. The result order is first-seen by model name.
func CollapseToModelLevel(rows []ModelHealthRow) []ModelHealthRow {
	type acc struct {
		row        ModelHealthRow
		latencySum int64
	}
	groups := make(map[string]*acc)
	var order []string
	for _, row := range rows {
		a, ok := groups[row.ModelName]
		if !ok {
			a = &acc{row: ModelHealthRow{ModelName: row.ModelName}}
			groups[row.ModelName] = a
			order = append(order, row.ModelName)
		}
		a.row.TestCount += row.TestCount
		a.row.SuccessCount += row.SuccessCount
		a.row.UserTrafficCount += row.UserTrafficCount
		a.row.ClientErrorCount += row.ClientErrorCount
		a.row.UpstreamErrorCount += row.UpstreamErrorCount
		a.row.ModerationCount += row.ModerationCount
		a.latencySum += int64(row.AvgResponseTime) * int64(row.TestCount)
		if row.LastTestTime > a.row.LastTestTime {
			a.row.LastTestTime = row.LastTestTime
			a.row.LastResponseTime = row.LastResponseTime
		}
		a.row.Trend = append(a.row.Trend, row.Trend...)
	}

	out := make([]ModelHealthRow, 0, len(order))
	for _, key := range order {
		a := groups[key]
		if a.row.TestCount > 0 {
			a.row.AvgResponseTime = int(math.Round(float64(a.latencySum) / float64(a.row.TestCount)))
		}
		a.row.SuccessRate = technicalSuccessRate(a.row.SuccessCount, a.row.ModerationCount, a.row.TestCount, a.row.ClientErrorCount)
		sort.SliceStable(a.row.Trend, func(i, j int) bool {
			if a.row.Trend[i].CreatedAt != a.row.Trend[j].CreatedAt {
				return a.row.Trend[i].CreatedAt < a.row.Trend[j].CreatedAt
			}
			return a.row.Trend[i].ResponseTime < a.row.Trend[j].ResponseTime
		})
		out = append(out, a.row)
	}
	return out
}
