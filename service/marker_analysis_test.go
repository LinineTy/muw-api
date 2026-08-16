package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openMarkerAnalysisTestDB 用内存 SQLite 装配 DB 与 LOG_DB（同库），迁移分析管道涉及的
// 日志/已分析标记/建议/分析历史/系统任务/option 表。option 表必须存在：setMarkerWatermark
// 走 model.UpdateOption 持久化并经 handleConfigUpdate 同步内存结构体。
func openMarkerAnalysisTestDB(t *testing.T) {
	t.Helper()
	prevDB, prevLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = prevDB, prevLogDB })

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.Log{},
		&model.CreditMarkerAnalyzedLog{},
		&model.CreditMarkerSuggestion{},
		&model.CreditMarkerAnalysisLog{},
		&model.SystemTask{},
		&model.SystemTaskLock{},
		&model.Option{},
	))
	model.DB = db
	model.LOG_DB = db

	// setMarkerWatermark 经 model.UpdateOption 写 common.OptionMap，单测环境该 map 未由
	// 服务启动初始化，这里确保非 nil。
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Unlock()
}

// withMarkerAnalysisSetting 保存并恢复全局标记词分析设置（含水位线），避免测试间互相污染。
func withMarkerAnalysisSetting(t *testing.T, baseURL string) {
	t.Helper()
	setting := operation_setting.GetCreditScoreSetting()
	prev := *setting
	t.Cleanup(func() { *setting = prev })
	setting.MarkerAnalysisEnabled = true
	setting.MarkerAnalysisBaseUrl = baseURL
	setting.MarkerAnalysisModel = "test-model"
}

func TestCountMarkerAnalysisBacklog(t *testing.T) {
	openMarkerAnalysisTestDB(t)
	now := time.Now().Unix()

	require.NoError(t, model.LOG_DB.Create(&[]*model.Log{
		{Type: model.LogTypeError, Content: "upstream: is sensitive, please check your input", CreatedAt: now},
		{Type: model.LogTypeError, Content: "upstream: request timeout", CreatedAt: now},
		{Type: model.LogTypeConsume, Content: "not an error", CreatedAt: now},
		{Type: model.LogTypeError, Content: "Content violates usage guidelines", CreatedAt: now},
	}).Error)

	var ids []int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Select("id").Order("id asc").Scan(&ids).Error)
	require.Len(t, ids, 4)

	// 水位线 0：累计全部错误日志（非 error 类型排除）。
	n, err := CountMarkerAnalysisBacklog(context.Background(), 0)
	require.NoError(t, err)
	assert.Equal(t, int64(3), n)

	// 水位线推进到第 1 条错误日志：只剩 2 条未分析。
	n, err = CountMarkerAnalysisBacklog(context.Background(), ids[0])
	require.NoError(t, err)
	assert.Equal(t, int64(2), n)

	// 水位线到最大 id：0。
	n, err = CountMarkerAnalysisBacklog(context.Background(), ids[3])
	require.NoError(t, err)
	assert.Equal(t, int64(0), n)
}

// fakeMarkerAnalysisEndpoint 返回固定建议的假分析端点；记录收到的请求供断言全量喂入。
func fakeMarkerAnalysisEndpoint(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"suggestions\":[{\"marker\":\"refusal text\",\"example\":\"e\",\"reason\":\"r\"}]}"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))
	}))
	t.Cleanup(server.Close)
	return server
}

// TestAssociateSuggestionLogs 建议关联来源日志 id：marker 子串命中的日志 id 记录到 LogIds；
// 匹配不上（语言不一致/意译）**不丢弃**，只留空 log_ids 供管理员凭 example 判断。
func TestAssociateSuggestionLogs(t *testing.T) {
	batch := []errorLogCandidate{
		{Id: 55813, Text: "status_code=400, [1301][系统检测到输入或生成内容可能包含不安全或敏感内容]"},
		{Id: 55842, Text: "status_code=451, The content you provided or machine outputted is blocked."},
	}
	got := associateSuggestionLogs([]markerSuggestion{
		{Marker: "unsafe or sensitive content"}, // 英文 marker 配中文源，匹配不上
		{Marker: "系统检测到输入或生成内容"},          // 命中 55813
		{Marker: "content you provided"},        // 命中 55842
		{Marker: "翻译成中文的标记"},                 // 意译，原文没有
	}, batch)
	require.Len(t, got, 4) // 全部保留，不丢弃
	assert.Empty(t, got[0].LogIds)
	assert.Equal(t, []int64{55813}, got[1].LogIds)
	assert.Equal(t, []int64{55842}, got[2].LogIds)
	assert.Empty(t, got[3].LogIds)

	// 空批次：全部空关联。
	got = associateSuggestionLogs([]markerSuggestion{{Marker: "x"}}, nil)
	require.Len(t, got, 1)
	assert.Empty(t, got[0].LogIds)
}

// TestAnalyzeMarkerBacklogFullFeedAdvancesWatermark 全量喂入：命中现有标记词/无安全提示词的
// 日志也照喂（不做预筛），只按文本去重；成功后水位线推进到最大 id，建议按已有标记去重。
func TestAnalyzeMarkerBacklogFullFeedAdvancesWatermark(t *testing.T) {
	openMarkerAnalysisTestDB(t)
	InitHttpClient() // 单测环境 httpClient 未由服务启动初始化
	server := fakeMarkerAnalysisEndpoint(t)
	withMarkerAnalysisSetting(t, server.URL)
	now := time.Now().Unix()

	// 3 条错误日志：一条命中默认标记词（is sensitive）、一条无安全提示词、一条重复文本。
	require.NoError(t, model.LOG_DB.Create(&[]*model.Log{
		{Type: model.LogTypeError, Content: "upstream: is sensitive, please check your input", CreatedAt: now},
		{Type: model.LogTypeError, Content: "upstream: some arbitrary refusal text", CreatedAt: now},
		{Type: model.LogTypeError, Content: "upstream: is sensitive, please check your input", CreatedAt: now},
	}).Error)
	var ids []int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Select("id").Order("id asc").Scan(&ids).Error)
	require.Len(t, ids, 3)

	summary, err := AnalyzeMarkerBacklog(context.Background(), "manual", false, nil)
	require.NoError(t, err)
	// 去重后喂 2 条（重复文本只喂一次），不预筛：命中现有标记词的也喂。
	assert.Equal(t, 2, summary["analyzed"])
	// 建议去重：命中默认标记词的丢弃，只入 1 条。
	assert.Equal(t, 1, summary["suggestions"])

	// 水位线推进到最大 id：再次统计无未分析。
	n, err := CountMarkerAnalysisBacklog(context.Background(), getMarkerWatermark())
	require.NoError(t, err)
	assert.Equal(t, int64(0), n)
	assert.Equal(t, int64(ids[2]), getMarkerWatermark())

	// 已分析标记落审计表。
	var analyzedCount int64
	require.NoError(t, model.DB.Model(&model.CreditMarkerAnalyzedLog{}).Count(&analyzedCount).Error)
	assert.Equal(t, int64(2), analyzedCount)

	// 落一条分析历史。
	logs, total, err := model.ListCreditMarkerAnalysisLogs(0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	assert.Equal(t, "manual", logs[0].TriggeredBy)
	assert.Equal(t, 2, logs[0].AnalyzedCount)
	// 用默认提示词跑：分析历史记录 prompt_used=default（审计可区分默认/自定义）。
	assert.Equal(t, "default", logs[0].PromptUsed)
}

// TestAnalyzeMarkerBacklogForceResetsWatermark force 从建站第一条重跑：重置水位线为 0，
// 连此前已分析的日志也重新喂（不跳过），存量全量重跑语义。
func TestAnalyzeMarkerBacklogForceResetsWatermark(t *testing.T) {
	openMarkerAnalysisTestDB(t)
	InitHttpClient()
	server := fakeMarkerAnalysisEndpoint(t)
	withMarkerAnalysisSetting(t, server.URL)
	now := time.Now().Unix()

	require.NoError(t, model.LOG_DB.Create(&model.Log{
		Type: model.LogTypeError, Content: "first error ever", CreatedAt: now - 1000,
	}).Error)
	var id1 int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Select("id").Scan(&id1).Error)

	// 第一次普通跑：水位线推进到 id1。
	summary, err := AnalyzeMarkerBacklog(context.Background(), "manual", false, nil)
	require.NoError(t, err)
	assert.Equal(t, 1, summary["analyzed"])
	assert.Equal(t, int64(id1), getMarkerWatermark())

	// 新增一条错误。
	require.NoError(t, model.LOG_DB.Create(&model.Log{
		Type: model.LogTypeError, Content: "second error", CreatedAt: now,
	}).Error)
	var id2 int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Select("MAX(id)").Scan(&id2).Error)

	// 普通跑只处理新增：喂 1 条，水位线到 id2。
	summary, err = AnalyzeMarkerBacklog(context.Background(), "manual", false, nil)
	require.NoError(t, err)
	assert.Equal(t, 1, summary["analyzed"])
	assert.Equal(t, int64(id2), getMarkerWatermark())

	// force 重置水位线为 0，从头重跑：两条都喂。
	summary, err = AnalyzeMarkerBacklog(context.Background(), "force", true, nil)
	require.NoError(t, err)
	assert.Equal(t, 2, summary["analyzed"])
	assert.Equal(t, int64(id2), getMarkerWatermark())
}

// TestMarkerAnalysisPromptSubstitution 可配置提示词的组装语义：含 {messages} 占位符时在
// system 提示词内替换为待分析消息（user 消息只放一句指令）；不含占位符时消息追加到 user。
func TestMarkerAnalysisPromptSubstitution(t *testing.T) {
	captured := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, common.DecodeJson(r.Body, &body))
		captured <- body
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"suggestions\":[]}"}}],"usage":{}}`))
	}))
	defer server.Close()

	setting := &operation_setting.CreditScoreSetting{
		MarkerAnalysisBaseUrl: server.URL,
		MarkerAnalysisModel:   "test-model",
	}
	ctx := context.Background()
	candidates := []string{"err one", "err two"}

	// 默认提示词走占位符路径：system 内替换，user 只留指令。
	setting.MarkerAnalysisPrompt = operation_setting.DefaultMarkerAnalysisPrompt
	_, _, err := callMarkerAnalysisModel(ctx, setting, candidates)
	require.NoError(t, err)
	body := <-captured
	messages := body["messages"].([]any)
	sys := messages[0].(map[string]any)["content"].(string)
	usr := messages[1].(map[string]any)["content"].(string)
	assert.Contains(t, sys, "err one\n---\nerr two")
	assert.NotContains(t, sys, "{messages}")
	assert.Equal(t, "请按要求输出 JSON。", usr)

	// 自定义无占位符提示词：消息追加到 user。
	setting.MarkerAnalysisPrompt = "你是分析助手。"
	_, _, err = callMarkerAnalysisModel(ctx, setting, candidates)
	require.NoError(t, err)
	body = <-captured
	messages = body["messages"].([]any)
	sys = messages[0].(map[string]any)["content"].(string)
	usr = messages[1].(map[string]any)["content"].(string)
	assert.Equal(t, "你是分析助手。", sys)
	assert.Equal(t, "err one\n---\nerr two", usr)

	// 留空提示词：回退默认提示词。
	setting.MarkerAnalysisPrompt = ""
	_, _, err = callMarkerAnalysisModel(ctx, setting, candidates)
	require.NoError(t, err)
	body = <-captured
	messages = body["messages"].([]any)
	sys = messages[0].(map[string]any)["content"].(string)
	assert.Contains(t, sys, "err one\n---\nerr two") // 默认提示词占位符被替换为消息
	assert.NotContains(t, sys, "{messages}")
}

// TestMarkerPromptFingerprint 分析历史提示词标识：默认/留空→"default"，自定义→单行预览截断。
func TestMarkerPromptFingerprint(t *testing.T) {
	assert.Equal(t, "default", markerPromptFingerprint(""))
	assert.Equal(t, "default", markerPromptFingerprint(operation_setting.DefaultMarkerAnalysisPrompt))
	// 自定义多行提示词折叠为单行预览；超长截断到 48 rune 加省略号。
	assert.Equal(t, "你是分析助手。", markerPromptFingerprint("你是分析助手。"))
	long := strings.Repeat("密", 60)
	fp := markerPromptFingerprint(long)
	assert.Equal(t, 49, len([]rune(fp)))
	assert.Equal(t, "密", string([]rune(fp)[47:48]))
	assert.Equal(t, "…", string([]rune(fp)[48:]))
}

func TestInsertMarkerSuggestions(t *testing.T) {
	prevDB := model.DB
	t.Cleanup(func() { model.DB = prevDB })
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.CreditMarkerSuggestion{}))
	model.DB = db

	// 命中系统默认违规标记词的不重复建议；过短（<3 rune）丢弃；正常词入库。
	inserted := insertMarkerSuggestions([]markerSuggestion{
		{Marker: "is sensitive", Example: "x", Reason: "y"},              // 命中默认标记词
		{Marker: "no", Example: "x", Reason: "y"},                        // 过短丢弃
		{Marker: "blocked by content policy", Example: "e", Reason: "r"}, // 正常插入
	}, false)
	assert.Equal(t, 1, inserted)

	// 已存在的 pending 建议不重复插入。
	inserted = insertMarkerSuggestions([]markerSuggestion{
		{Marker: "blocked by content policy", Example: "e2", Reason: "r2"},
	}, false)
	assert.Equal(t, 0, inserted)

	// force 刷新 pending 建议：内容更新、计入产出。
	inserted = insertMarkerSuggestions([]markerSuggestion{
		{Marker: "blocked by content policy", Example: "e3", Reason: "r3"},
	}, true)
	assert.Equal(t, 1, inserted)
}
