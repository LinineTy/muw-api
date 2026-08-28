package controller

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupCodingPlanSyncTestDB 开一个内存 SQLite 并挂到 model.DB,供同步 helper 测试。
func setupCodingPlanSyncTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}))
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

// TestSyncCodingPlanAutoControlToGroup 回归:同 key 多渠道共享同一套餐账号,保存任一
// 渠道携带自动启停配置时,后端要同步到同组其余渠道;不同 key 的渠道不受影响;
// 未携带自动启停字段的局部更新不触发同步。
func TestSyncCodingPlanAutoControlToGroup(t *testing.T) {
	setupCodingPlanSyncTestDB(t)

	provider := "zhipu"
	mk := func(key string) *model.Channel {
		return &model.Channel{
			Name:               "ch-" + key,
			Type:               constant.ChannelTypeZhipu_v4,
			Key:                key,
			CodingPlanProvider: &provider,
		}
	}
	a := mk("shared")
	b := mk("shared")
	c := mk("other")
	require.NoError(t, model.DB.Create(a).Error)
	require.NoError(t, model.DB.Create(b).Error)
	require.NoError(t, model.DB.Create(c).Error)

	// 保存 A 时携带自动启停配置 → 同步到同 key 的 B,不影响不同 key 的 C。
	require.NoError(t, syncCodingPlanAutoControlToGroup(a, map[string]any{
		"coding_plan_auto_control":      true,
		"coding_plan_disable_threshold": float64(95),
		"coding_plan_enable_threshold":  float64(85),
	}))

	gotB := &model.Channel{}
	require.NoError(t, model.DB.First(gotB, b.Id).Error)
	require.NotNil(t, gotB.CodingPlanAutoControl)
	assert.True(t, *gotB.CodingPlanAutoControl)
	require.NotNil(t, gotB.CodingPlanDisableThreshold)
	assert.Equal(t, 95, *gotB.CodingPlanDisableThreshold)
	require.NotNil(t, gotB.CodingPlanEnableThreshold)
	assert.Equal(t, 85, *gotB.CodingPlanEnableThreshold)

	gotC := &model.Channel{}
	require.NoError(t, model.DB.First(gotC, c.Id).Error)
	assert.Nil(t, gotC.CodingPlanAutoControl, "不同 key 的渠道不应被同步")

	// 未携带自动启停字段的局部更新不触发同步。
	gotA := &model.Channel{}
	require.NoError(t, model.DB.First(gotA, a.Id).Error)
	require.NoError(t, syncCodingPlanAutoControlToGroup(gotA, map[string]any{"name": "renamed"}))
	gotB2 := &model.Channel{}
	require.NoError(t, model.DB.First(gotB2, b.Id).Error)
	require.NotNil(t, gotB2.CodingPlanDisableThreshold)
	assert.Equal(t, 95, *gotB2.CodingPlanDisableThreshold, "未携带自动启停字段不应触发同步")
}
