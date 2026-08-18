package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestPersistConversationRecordPreConsumeFailPersistsErrorStatus 回归：敏感词命中(扣分) +
// 预扣费失败(额度不足) 的请求此前在 persistConversationRecord 里 nil pointer panic
// （relayInfo.ChannelId 经嵌入的 nil *ChannelMeta 提升访问，预扣费失败时未选渠道）。
// 修复后应正常落对话记录且 status_code 标记为错误(403)，不 panic。
func TestPersistConversationRecordPreConsumeFailPersistsErrorStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// 测试 DB（异步 InsertConversationRecord 用）。`:memory:` 每连接独立库，
	// 限单连接让 gopool 插入与查询共享同一内存库。
	prevDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.ConversationRecord{}))
	model.DB = db
	t.Cleanup(func() { model.DB = prevDB })

	// 开启对话留存（生产 conversation_retention_setting.enabled=true）
	retention := operation_setting.GetConversationRetentionSetting()
	prevRetention := *retention
	retention.Enabled = true
	t.Cleanup(func() { *retention = prevRetention })

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{}`))

	relayInfo := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatClaude,
		RelayMode:       relayconstant.RelayModeUnknown,
		UserId:          1408,
		TokenId:         1,
		// ChannelMeta 保持 nil：预扣费失败，未选渠道
		RequestId: "repro-request-id",
		OriginModelName: "GLM-5.3",
		IsStream:        false,
		Request: &dto.ClaudeRequest{
			Model: "GLM-5.3",
			Messages: []dto.ClaudeMessage{
				{Role: "user", Content: "方法论 敏感词"},
			},
		},
	}

	tee := InstallConversationCapture(c, 65536)
	apiErr := types.NewErrorWithStatusCode(
		errors.New("预扣费额度失败, 用户剩余额度: 0.579, 需要预扣费额度: 9.888"),
		types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
		types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())

	require.NotPanics(t, func() {
		persistConversationRecord(c, relayInfo, apiErr, tee)
	})

	// 异步落库（gopool），轮询等待并验证预扣费失败请求也落对话记录、状态标记为错误(403)。
	var rec model.ConversationRecord
	deadline := time.Now().Add(3 * time.Second)
	for {
		err := model.DB.Where("request_id = ?", relayInfo.RequestId).First(&rec).Error
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("conversation record not persisted: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	require.Equal(t, http.StatusForbidden, rec.StatusCode)
}

// TestRecordPreConsumeErrorLogSwitch 验证预扣费失败错误日志受 RECORD_PRE_CONSUME_ERROR_LOG
// 开关控制：关(默认)不落 type=5 错误日志，开则在使用日志(logs 表)里落一条带"余额不足"的
// 错误记录。这是"余额不足也落库、报错误"在"使用日志"侧的体现，默认关避免高频预期错误刷屏。
func TestRecordPreConsumeErrorLogSwitch(t *testing.T) {
	gin.SetMode(gin.TestMode)

	prevDB := model.DB
	prevLogDB := model.LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.User{}))
	model.DB = db
	model.LOG_DB = db
	t.Cleanup(func() {
		model.DB = prevDB
		model.LOG_DB = prevLogDB
	})

	// 测试环境 Redis 未初始化：禁用 Redis，让 GetUserSetting 走 DB 路径（RecordErrorLog 内部）。
	prevRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = prevRedis })

	prevSwitch := constant.RecordPreConsumeErrorLog
	t.Cleanup(func() { constant.RecordPreConsumeErrorLog = prevSwitch })

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{}`))
	c.Set("token_name", "test-token")
	c.Set("group", "default")

	relayInfo := &relaycommon.RelayInfo{
		UserId:          1,
		TokenId:         1,
		OriginModelName: "GLM-5.3",
		IsStream:        false,
	}
	apiErr := types.NewErrorWithStatusCode(
		errors.New("预扣费额度失败, 用户剩余额度: 0.5, 需要预扣费额度: 9.8"),
		types.ErrorCodeInsufficientUserQuota, http.StatusForbidden)

	// 开关关闭（默认）：不记录
	constant.RecordPreConsumeErrorLog = false
	recordPreConsumeErrorLog(c, relayInfo, apiErr)
	var count int64
	require.NoError(t, model.DB.Model(&model.Log{}).Count(&count).Error)
	require.Equal(t, int64(0), count)

	// 开关开启：落一条 type=5 错误日志，内容带被拒原因
	constant.RecordPreConsumeErrorLog = true
	recordPreConsumeErrorLog(c, relayInfo, apiErr)
	require.NoError(t, model.DB.Model(&model.Log{}).Count(&count).Error)
	require.Equal(t, int64(1), count)
	var rec model.Log
	require.NoError(t, model.DB.First(&rec).Error)
	require.Equal(t, model.LogTypeError, rec.Type)
	require.Equal(t, "GLM-5.3", rec.ModelName)
	require.Equal(t, 1, rec.UserId)
	require.Contains(t, rec.Content, "预扣费额度失败")
}
