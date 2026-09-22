package model

import (
	"errors"
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAggregateChannelTestRecords(t *testing.T) {
	records := []ChannelTestRecord{
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "gpt-4o", Success: true, ResponseTime: 100, CreatedAt: 1000},
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "gpt-4o", Success: false, ResponseTime: 300, ErrorReason: "upstream 500", CreatedAt: 2000},
		{Id: 3, ChannelId: 1, ChannelName: "A", ModelName: "gpt-4o", Success: true, ResponseTime: 200, CreatedAt: 3000},
		{Id: 4, ChannelId: 1, ChannelName: "A", ModelName: "gpt-4o-mini", Success: false, ResponseTime: 500, ErrorReason: "timeout", CreatedAt: 1500},
		{Id: 5, ChannelId: 2, ChannelName: "B", ModelName: "gpt-4o", Success: true, ResponseTime: 50, CreatedAt: 2500},
	}

	rows := AggregateChannelTestRecords(records)
	require.Len(t, rows, 3)

	byKey := map[string]ModelHealthRow{}
	for _, row := range rows {
		byKey[fmt.Sprintf("%d|%s", row.ChannelId, row.ModelName)] = row
	}

	// Channel 1 × gpt-4o: 3 tests, 2 success, avg (100+300+200)/3=200.
	rowA := byKey["1|gpt-4o"]
	assert.Equal(t, 3, rowA.TestCount)
	assert.Equal(t, 2, rowA.SuccessCount)
	assert.InDelta(t, 66.7, rowA.SuccessRate, 0.1)
	assert.Equal(t, 200, rowA.AvgResponseTime)
	assert.Equal(t, 200, rowA.LastResponseTime) // newest probe succeeded at t=3000
	assert.Equal(t, int64(3000), rowA.LastTestTime)
	assert.Equal(t, "upstream 500", rowA.LastError) // most recent failure
	require.Len(t, rowA.Trend, 3)
	assert.False(t, rowA.Trend[1].Success)

	// Channel 1 × gpt-4o-mini: 1 test, failed.
	rowMini := byKey["1|gpt-4o-mini"]
	assert.Equal(t, 1, rowMini.TestCount)
	assert.InDelta(t, 0, rowMini.SuccessRate, 0.001)
	assert.Equal(t, "timeout", rowMini.LastError)

	// Channel 2 × gpt-4o: 1 test, success.
	rowB := byKey["2|gpt-4o"]
	assert.Equal(t, 1, rowB.TestCount)
	assert.InDelta(t, 100, rowB.SuccessRate, 0.001)
	assert.Equal(t, "", rowB.LastError)
}

func TestAggregateChannelTestRecordsTrendWindow(t *testing.T) {
	const total = 250
	var records []ChannelTestRecord
	for i := 1; i <= total; i++ {
		records = append(records, ChannelTestRecord{
			Id:           i,
			ChannelId:    1,
			ChannelName:  "A",
			ModelName:    "gpt-4o",
			Success:      i%2 == 0,
			ResponseTime: i,
			CreatedAt:    int64(1000 + i),
		})
	}

	rows := AggregateChannelTestRecords(records)
	require.Len(t, rows, 1)
	require.Len(t, rows[0].Trend, channelTestTrendLimit)
	// Trend keeps the newest probes (ids total-limit+1 .. total).
	assert.Equal(t, total-channelTestTrendLimit+1, rows[0].Trend[0].ResponseTime)
	assert.Equal(t, total, rows[0].Trend[channelTestTrendLimit-1].ResponseTime)
	// Counts still reflect the whole window.
	assert.Equal(t, total, rows[0].TestCount)
	assert.Equal(t, total/2, rows[0].SuccessCount)
}

func TestAggregateChannelTestRecordsEmpty(t *testing.T) {
	rows := AggregateChannelTestRecords(nil)
	assert.Empty(t, rows)
}


func TestMaskChannelIdentityForViewer(t *testing.T) {
	rows := []ModelHealthRow{
		{
			ChannelId: 7, ChannelName: "Secret Upstream", ModelName: "gpt-4o",
			TestCount: 3, SuccessCount: 2, SuccessRate: 66.7, AvgResponseTime: 200,
			LastResponseTime: 200, LastTestTime: 3000, LastError: "upstream 500",
			LastErrorKind: "upstream", UserTrafficCount: 1, ClientErrorCount: 0,
			ModerationCount: 0,
			Trend: []TestTrendPoint{
				{CreatedAt: 1000, ResponseTime: 100, Success: true},
				{CreatedAt: 2000, ResponseTime: 300, Success: false, ErrorKind: "upstream"},
			},
		},
	}

	masked := MaskChannelIdentityForViewer(rows)
	require.Len(t, masked, 1)
	row := masked[0]

	// 渠道身份与延迟/错误细节一律不下发；渠道 id 保留（前端只拿它当标签）
	assert.Equal(t, 7, row.ChannelId)
	assert.Equal(t, "gpt-4o", row.ModelName)
	assert.Equal(t, "", row.ChannelName)
	assert.Equal(t, 0, row.AvgResponseTime)
	assert.Equal(t, 0, row.LastResponseTime)
	assert.Equal(t, "", row.LastError)
	assert.Equal(t, "", row.LastErrorKind)

	// 计数、成功率、探测时间线保留（模型级汇总与条带要靠它们）
	assert.Equal(t, 3, row.TestCount)
	assert.Equal(t, 2, row.SuccessCount)
	assert.InDelta(t, 66.7, row.SuccessRate, 0.01)
	assert.Equal(t, 1, row.UserTrafficCount)
	assert.Equal(t, int64(3000), row.LastTestTime)
	require.Len(t, row.Trend, 2)
	assert.Equal(t, int64(2000), row.Trend[1].CreatedAt)
	assert.False(t, row.Trend[1].Success)
	assert.Equal(t, "upstream", row.Trend[1].ErrorKind)
	// 单次探测的耗时也要抹掉（tooltip 不再暴露渠道速度）
	assert.Equal(t, 0, row.Trend[0].ResponseTime)
	assert.Equal(t, 0, row.Trend[1].ResponseTime)

	// 输入不被就地改写
	assert.Equal(t, "Secret Upstream", rows[0].ChannelName)
	assert.Equal(t, 100, rows[0].Trend[0].ResponseTime)
}

func TestMaskChannelIdentityForViewerEmpty(t *testing.T) {
	assert.Empty(t, MaskChannelIdentityForViewer(nil))
}

func TestAggregateChannelTestRecordsUserTrafficSource(t *testing.T) {
	records := []ChannelTestRecord{
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "deepseek-chat", Success: true, ResponseTime: 100, Source: ChannelTestSourceUser, CreatedAt: 1000},
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "deepseek-chat", Success: false, ResponseTime: 400, ErrorReason: "upstream 500", Source: ChannelTestSourceUser, CreatedAt: 2000},
		{Id: 3, ChannelId: 1, ChannelName: "A", ModelName: "deepseek-chat", Success: true, ResponseTime: 150, Source: ChannelTestSourceTest, CreatedAt: 3000},
		{Id: 4, ChannelId: 1, ChannelName: "A", ModelName: "deepseek-chat", Success: true, ResponseTime: 120, Source: "", CreatedAt: 4000}, // legacy rows have no source
	}

	rows := AggregateChannelTestRecords(records)
	require.Len(t, rows, 1)
	row := rows[0]
	// UserTrafficCount counts only source == "user"; TestCount stays the total.
	assert.Equal(t, 4, row.TestCount)
	assert.Equal(t, 2, row.UserTrafficCount)
	// Success rate and latency still mix all records.
	assert.Equal(t, 3, row.SuccessCount)
	assert.InDelta(t, 75, row.SuccessRate, 0.1)
	assert.Equal(t, 193, row.AvgResponseTime) // round((100+400+150+120)/4) = 193
	// The most recent failure comes from the user-traffic record.
	assert.Equal(t, "upstream 500", row.LastError)
}

func TestAggregateChannelTestRecordsOrderIndependent(t *testing.T) {
	records := []ChannelTestRecord{
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: true, ResponseTime: 100, CreatedAt: 2000},
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 300, ErrorReason: "e", CreatedAt: 1000},
		{Id: 3, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: true, ResponseTime: 200, CreatedAt: 3000},
	}
	shuffled := []ChannelTestRecord{
		records[2], records[0], records[1],
	}
	ordered := AggregateChannelTestRecords(records)
	unordered := AggregateChannelTestRecords(shuffled)

	require.Len(t, ordered, 1)
	require.Len(t, unordered, 1)
	a, b := ordered[0], unordered[0]
	assert.Equal(t, a.TestCount, b.TestCount)
	assert.Equal(t, a.SuccessCount, b.SuccessCount)
	assert.Equal(t, a.AvgResponseTime, b.AvgResponseTime)
	assert.Equal(t, a.LastResponseTime, b.LastResponseTime)
	assert.Equal(t, a.LastError, b.LastError)
	assert.Equal(t, a.LastTestTime, b.LastTestTime)
	require.Len(t, a.Trend, 3)
	require.Len(t, b.Trend, 3)
	assert.Equal(t, a.Trend[0].CreatedAt, b.Trend[0].CreatedAt)
	assert.Equal(t, a.Trend[2].CreatedAt, b.Trend[2].CreatedAt)
}

// ── 错误归类(ClassifyRelayError)────────────────────────────────

// TestClassifyRelayError 用生产环境真实错误文本验证归类:client(请求自身的
// 毛病)/moderation(上游正常返回审核拦截)/upstream(渠道侧问题)。
func TestClassifyRelayError(t *testing.T) {
	newErr := func(msg string, code types.ErrorCode, statusCode int) *types.NewAPIError {
		return types.NewErrorWithStatusCode(errors.New(msg), code, statusCode)
	}

	cases := []struct {
		name string
		err  *types.NewAPIError
		want string
	}{
		// 结构化 errorCode 优先
		{"context window exceeded", newErr("input 208818 > 96000", types.ErrorCodeContextWindowExceeded, 400), ErrorKindClient},
		{"insufficient user quota", newErr("user quota not enough", types.ErrorCodeInsufficientUserQuota, 402), ErrorKindClient},
		{"sensitive words detected", newErr("hit sensitive words", types.ErrorCodeSensitiveWordsDetected, 400), ErrorKindModeration},
		{"do request failed", newErr("do request failed", types.ErrorCodeDoRequestFailed, 0), ErrorKindUpstream},

		// 文本特征(上游透传业务错误,errorCode 为空)
		{"field invalid", newErr("field ReasoningEffort invalid, should be one of: low, medium, high", "", 0), ErrorKindClient},
		{"role invalid", newErr("field Messages[0].Role invalid, should be set", "", 0), ErrorKindClient},
		{"model not supported", newErr("Model x-preview-f-free is not supported", "", 0), ErrorKindClient},
		{"reasoning_effort must be", newErr("'reasoning_effort' must be one of: 'none', 'minimal'", "", 0), ErrorKindClient},
		{"system message must be", newErr("System message must be at the beginning.", "", 0), ErrorKindClient},

		{"tpm exhausted", newErr("inference tpm exhausted", "", 0), ErrorKindUpstream},
		{"rpm exhausted", newErr("rpm exhausted", "", 0), ErrorKindUpstream},
		{"quota exceeded", newErr("Allocated quota exceeded, please increase your quota limit.", "", 0), ErrorKindUpstream},
		{"billing quota", newErr("You exceeded your current quota, please check your plan and billing details.", "", 0), ErrorKindUpstream},
		{"upstream error", newErr("upstream error: do request failed", "", 0), ErrorKindUpstream},
		{"endpoint unavailable", newErr("Error from provider (Console): Upstream request failed: Endpoint is unavailable.", "", 0), ErrorKindUpstream},

		// moderation 优先于 client 文本,避免被宽松正则误吞
		{"input moderation", newErr("Input data may contain inappropriate content. For details, see: https://help.aliyun.com", "", 0), ErrorKindModeration},
		{"output moderation", newErr("Output data may contain inappropriate content.", "", 0), ErrorKindModeration},
		{"aliyun sensitive", newErr("input new_sensitive (1026)", "", 0), ErrorKindModeration},

		// 状态码兜底
		{"400 generic", newErr("bad request", "", 400), ErrorKindClient},
		{"413 payload", newErr("payload too large", "", 413), ErrorKindClient},
		{"429 rate limited", newErr("too many requests", "", 429), ErrorKindUpstream},
		{"502 upstream", newErr("bad gateway", "", 502), ErrorKindUpstream},
		{"401 upstream auth (relay 阶段=渠道key问题)", newErr("invalid api key", "", 401), ErrorKindUpstream},

		// 上游非 2xx 包装(ErrorCodeBadResponseStatusCode):状态码即上游判定
		{"upstream raw 422", newErr("bad response status code 422, body: {\"error\":{...}}", types.ErrorCodeBadResponseStatusCode, 422), ErrorKindClient},
		{"upstream raw 400", newErr("bad response status code 400", types.ErrorCodeBadResponseStatusCode, 400), ErrorKindClient},
		{"upstream raw 429", newErr("bad response status code 429", types.ErrorCodeBadResponseStatusCode, 429), ErrorKindUpstream},
		{"upstream raw 401", newErr("bad response status code 401", types.ErrorCodeBadResponseStatusCode, 401), ErrorKindUpstream},
		{"upstream raw 503", newErr("bad response status code 503", types.ErrorCodeBadResponseStatusCode, 503), ErrorKindUpstream},
		// 透传 errorCode + showBodyWhenFail 包装前缀:前缀不算上游特征,落状态码兜底
		{"透传code+包装前缀+422", newErr("bad response status code 422, message: unknown parameter: tools", "some_upstream_code", 422), ErrorKindClient},
		{"透传code+包装前缀+500", newErr("bad response status code 500, message: internal", "some_upstream_code", 500), ErrorKindUpstream},

		// 未知默认 upstream:拿不准先红,不掩盖真实故障
		{"unknown", newErr("something odd happened", "", 0), ErrorKindUpstream},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyRelayError(tc.err)
			assert.Equal(t, tc.want, got)
		})
	}
}

// TestAggregateErrorKinds 验证分色口径:client 错误不进成功率分母、moderation
// 视作成功、LastError 优先展示非 client 错误、trend 透传 error_kind。
func TestAggregateErrorKinds(t *testing.T) {
	records := []ChannelTestRecord{
		// t=1000 成功
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: true, ResponseTime: 100, CreatedAt: 1000},
		// t=2000 用户传错参数(client)——不进分母
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 50, ErrorReason: "field X invalid", ErrorKind: ErrorKindClient, CreatedAt: 2000},
		// t=3000 上游限流(upstream)——进分母且算失败
		{Id: 3, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 200, ErrorReason: "inference tpm exhausted", ErrorKind: ErrorKindUpstream, CreatedAt: 3000},
		// t=4000 内容审核(moderation)——计成功
		{Id: 4, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 300, ErrorReason: "input sensitive", ErrorKind: ErrorKindModeration, CreatedAt: 4000},
	}

	rows := AggregateChannelTestRecords(records)
	require.Len(t, rows, 1)
	row := rows[0]

	assert.Equal(t, 4, row.TestCount)
	assert.Equal(t, 1, row.SuccessCount)
	assert.Equal(t, 1, row.ClientErrorCount)
	assert.Equal(t, 1, row.UpstreamErrorCount)
	assert.Equal(t, 1, row.ModerationCount)
	// 技术成功率 = (成功1 + 审核1) / (4 - client1) = 2/3 ≈ 66.7
	assert.InDelta(t, 66.7, row.SuccessRate, 0.1)
	// LastError 优先非 client:最近一次失败是 moderation(t=4000),非 client → 展示它
	assert.Equal(t, "input sensitive", row.LastError)
	assert.Equal(t, ErrorKindModeration, row.LastErrorKind)
	// trend 透传
	require.Len(t, row.Trend, 4)
	assert.Equal(t, ErrorKindClient, row.Trend[1].ErrorKind)
	assert.Equal(t, ErrorKindUpstream, row.Trend[2].ErrorKind)
	assert.Equal(t, ErrorKindModeration, row.Trend[3].ErrorKind)
}

// TestAggregateLastErrorPrefersNonClient 用户 client 错误发生在渠道故障之后,
// LastError 仍应展示更早的渠道故障,而不是被最近的传参错误顶掉。
func TestAggregateLastErrorPrefersNonClient(t *testing.T) {
	records := []ChannelTestRecord{
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 100, ErrorReason: "bad response status code 502", ErrorKind: ErrorKindUpstream, CreatedAt: 1000},
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 20, ErrorReason: "field Y must be set", ErrorKind: ErrorKindClient, CreatedAt: 2000},
	}
	rows := AggregateChannelTestRecords(records)
	require.Len(t, rows, 1)
	assert.Equal(t, "bad response status code 502", rows[0].LastError)
	assert.Equal(t, ErrorKindUpstream, rows[0].LastErrorKind)
	// 全 client 回退:没有非 client 错误时展示最近一次任意失败
	recordsAllClient := []ChannelTestRecord{
		{Id: 1, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 20, ErrorReason: "field A invalid", ErrorKind: ErrorKindClient, CreatedAt: 1000},
		{Id: 2, ChannelId: 1, ChannelName: "A", ModelName: "m", Success: false, ResponseTime: 20, ErrorReason: "field B invalid", ErrorKind: ErrorKindClient, CreatedAt: 2000},
	}
	rows2 := AggregateChannelTestRecords(recordsAllClient)
	require.Len(t, rows2, 1)
	assert.Equal(t, "field B invalid", rows2[0].LastError)
	assert.Equal(t, ErrorKindClient, rows2[0].LastErrorKind)
	// 分母全是 client → 100(没有证据表明渠道有病)
	assert.InDelta(t, 100, rows2[0].SuccessRate, 0.001)
}

// TestTechnicalSuccessRate 边界:全成功、moderation 计入分子、空窗口。
func TestTechnicalSuccessRate(t *testing.T) {
	assert.InDelta(t, 100, technicalSuccessRate(10, 0, 10, 0), 0.001)
	assert.InDelta(t, 100, technicalSuccessRate(0, 5, 5, 0), 0.001)   // 全部 moderation
	assert.InDelta(t, 100, technicalSuccessRate(0, 0, 3, 3), 0.001)   // 全部 client
	assert.InDelta(t, 50, technicalSuccessRate(1, 0, 3, 1), 0.001)    // 1/(3-1)
	assert.InDelta(t, 100, technicalSuccessRate(0, 0, 0, 0), 0.001)   // 空窗口
}

func TestApplyChannelNames(t *testing.T) {
	rows := []ModelHealthRow{
		{ChannelId: 7, ChannelName: "old-name", ModelName: "m1"},
		{ChannelId: 8, ChannelName: "gone", ModelName: "m1"},
	}
	out := ApplyChannelNames(rows, map[int]string{7: "new-name"})

	if out[0].ChannelName != "new-name" {
		t.Fatalf("重命名后的渠道应显示实时名, got %q", out[0].ChannelName)
	}
	if out[1].ChannelName != "gone" {
		t.Fatalf("渠道已不存在时应保留快照名, got %q", out[1].ChannelName)
	}
}
