package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// 回归:SQLite 不允许 DROP COLUMN 时列仍被索引引用。旧开发库/旧部署的 legacy 列上留着
// 旧版 GORM 建的索引,删列前不先删索引,启动期 ensure* 直接 FATAL——2026-09-10 开发库
// 就是因为 next_reset_time 上的旧索引起不来,而 MySQL 会随列自动删索引,演练没暴露。
func TestDropLegacySubscriptionColumnsRemovesReferencingIndexes(t *testing.T) {
	db := openLegacyUpgradeDB(t)

	require.NoError(t, db.Exec(
		"CREATE TABLE user_subscriptions (id integer primary key, next_reset_time integer, plain_legacy integer)",
	).Error)
	require.NoError(t, db.Exec(
		"CREATE INDEX idx_user_subscriptions_next_reset_time ON user_subscriptions(next_reset_time)",
	).Error)

	require.NoError(t, dropLegacySubscriptionColumns(db, "user_subscriptions",
		[]string{"next_reset_time", "plain_legacy"}))

	var columns []string
	require.NoError(t, db.Raw("SELECT name FROM pragma_table_info('user_subscriptions')").Scan(&columns).Error)
	require.NotContains(t, columns, "next_reset_time")
	require.NotContains(t, columns, "plain_legacy")

	var indexes []string
	require.NoError(t, db.Raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_subscriptions'").Scan(&indexes).Error)
	require.NotContains(t, indexes, "idx_user_subscriptions_next_reset_time")
}
