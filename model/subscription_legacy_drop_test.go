package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestEnsureDropLegacySubscriptionColumns 验证 legacy 列幂等删除：种一个带 9 个 legacy 列
// 的旧库，ensureDropLegacy* 应删掉它们、保留展示/动态列，再次调用为空操作。
// 覆盖 SQLite 先 DROP INDEX 再 DROP COLUMN 的路径（next_cycle_reset_at 建了索引）。
func TestEnsureDropLegacySubscriptionColumns(t *testing.T) {
	prevDB := DB
	prevType := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	defer func() {
		DB = prevDB
		common.SetMainDatabaseType(prevType)
	}()

	// 模拟旧库：两张订阅表都含 legacy 列 + 展示/动态列。
	require.NoError(t, db.Exec(`CREATE TABLE subscription_plans (
		id integer PRIMARY KEY,
		title varchar(128) NOT NULL,
		total_amount bigint NOT NULL DEFAULT 0,
		quota_reset_period varchar(16) DEFAULT 'never',
		quota_reset_custom_seconds bigint DEFAULT 0,
		reset_amount_limit bigint NOT NULL DEFAULT 0,
		weekly_amount_limit bigint NOT NULL DEFAULT 0,
		monthly_amount_limit bigint NOT NULL DEFAULT 0,
		reset_windows text DEFAULT '')`).Error)
	require.NoError(t, db.Exec(`CREATE TABLE user_subscriptions (
		id integer PRIMARY KEY,
		user_id integer,
		plan_id integer,
		cycle_start_at bigint NOT NULL DEFAULT 0,
		cycle_used bigint NOT NULL DEFAULT 0,
		next_cycle_reset_at bigint NOT NULL DEFAULT 0,
		week_start_at bigint NOT NULL DEFAULT 0,
		week_used bigint NOT NULL DEFAULT 0,
		month_start_at bigint NOT NULL DEFAULT 0,
		month_used bigint NOT NULL DEFAULT 0,
		window_state text DEFAULT '')`).Error)
	require.NoError(t, db.Exec(`CREATE INDEX idx_user_subscriptions_next_cycle_reset_at ON user_subscriptions (next_cycle_reset_at)`).Error)

	require.NoError(t, ensureDropLegacySubscriptionPlanColumns(DB))
	require.NoError(t, ensureDropLegacyUserSubscriptionColumns(DB))

	assertColumns := func(table string, want []string, dontWant []string) {
		var cols []struct {
			Name string `gorm:"column:name"`
		}
		require.NoError(t, db.Raw("PRAGMA table_info(`"+table+"`)").Scan(&cols).Error)
		names := map[string]bool{}
		for _, c := range cols {
			names[c.Name] = true
		}
		for _, c := range want {
			assert.True(t, names[c], "%s.%s 应保留", table, c)
		}
		for _, c := range dontWant {
			assert.False(t, names[c], "%s.%s 应被删除", table, c)
		}
	}
	assertColumns("subscription_plans",
		[]string{"title", "reset_windows"},
		[]string{"total_amount", "quota_reset_period", "quota_reset_custom_seconds", "reset_amount_limit", "weekly_amount_limit", "monthly_amount_limit"})
	assertColumns("user_subscriptions",
		[]string{"user_id", "plan_id", "week_start_at", "week_used", "month_start_at", "month_used", "window_state"},
		[]string{"cycle_start_at", "cycle_used", "next_cycle_reset_at"})

	// 幂等：再次调用为空操作。
	require.NoError(t, ensureDropLegacySubscriptionPlanColumns(DB))
	require.NoError(t, ensureDropLegacyUserSubscriptionColumns(DB))
}
