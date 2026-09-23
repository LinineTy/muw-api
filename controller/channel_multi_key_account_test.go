package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Multi-key operations must work through the account entry point (account_id),
// where there is no channel object at all. Regression: enabling a key on an
// account threw a nil-pointer panic (HTTP 500) because the channel-status
// restoration step dereferenced the missing channel.
func TestMultiKeyManageOnAccountPathWithoutChannel(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousMaster, previousCache, previousRedis, previousSQLite := common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousType, previousLogType)
		common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath = previousMaster, previousCache, previousRedis, previousSQLite
	})
	t.Setenv("SQL_DSN", os.Getenv("TEST_CHANNEL_SQL_DSN"))
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "account-multi-key.db")
	require.NoError(t, model.InitDB())
	database := model.DB
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	model.LOG_DB = database
	common.SetLogDatabaseType(common.MainDatabaseType())
	require.NoError(t, database.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.User{}, &model.Log{}, &model.AuditLog{}, &model.ChannelModelSetting{}, &model.Account{}, &model.ChannelAccount{}))
	root := &model.User{Username: "multi-key-account-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	require.NoError(t, database.Create(root).Error)
	t.Cleanup(func() { require.NoError(t, database.Unscoped().Delete(root).Error) })

	account := &model.Account{
		Name:   "account-multi-key",
		Key:    "sk-a\nsk-b\nsk-c",
		Status: common.ChannelStatusEnabled,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:         true,
			MultiKeySize:       3,
			MultiKeyMode:       constant.MultiKeyModeRandom,
			MultiKeyStatusList: map[int]int{0: common.ChannelStatusManuallyDisabled, 1: common.ChannelStatusManuallyDisabled, 2: common.ChannelStatusManuallyDisabled},
		},
	}
	require.NoError(t, account.Insert())
	t.Cleanup(func() { require.NoError(t, database.Unscoped().Delete(account).Error) })

	call := func(action string, keyIndex int) map[string]any {
		payload, err := common.Marshal(MultiKeyManageRequest{AccountId: account.Id, Action: action, KeyIndex: common.GetPointer(keyIndex)})
		require.NoError(t, err)
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", root.Id)
		c.Set("role", common.RoleRootUser)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/account/multi_key/manage", bytes.NewReader(payload))
		c.Request.Header.Set("Content-Type", "application/json")
		ManageMultiKeys(c)
		var result map[string]any
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
		return result
	}
	reload := func() *model.Account {
		loaded, err := model.GetAccountById(account.Id, true)
		require.NoError(t, err)
		return loaded
	}

	// 单把启用：状态记录被删除，密钥回到默认启用
	result := call("enable_key", 2)
	assert.Equal(t, true, result["success"], result)
	assert.NotContains(t, reload().ChannelInfo.MultiKeyStatusList, 2)

	// 全部启用：状态表清空
	result = call("enable_all_keys", 0)
	assert.Equal(t, true, result["success"], result)
	assert.Empty(t, reload().ChannelInfo.MultiKeyStatusList)

	// 单把禁用仍可用（此路径本来就正常，防回归）
	result = call("disable_key", 1)
	assert.Equal(t, true, result["success"], result)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, reload().ChannelInfo.MultiKeyStatusList[1])

	// 单把删除：密钥数减少，状态表跟着收缩
	result = call("delete_key", 2)
	assert.Equal(t, true, result["success"], result)
	loaded := reload()
	assert.Len(t, loaded.GetKeys(), 2)
	assert.Equal(t, 2, loaded.ChannelInfo.MultiKeySize)
	assert.Equal(t, true, call("get_key_status", 0)["success"])
}
