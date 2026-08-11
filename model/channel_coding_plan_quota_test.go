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
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openCodingPlanQuotaUpToDateDB 模拟"已到最新 schema 版本"的库:schema_migrations
// 已打上 CurrentSchemaVersion 的戳,版本门控会跳过 autoMigrateAll,新增列只能靠
// 幂等 ensure 补上。
func openCodingPlanQuotaUpToDateDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, ensureSchemaMigrationsTable(db))
	require.NoError(t, db.Create(&SchemaMigration{Version: CurrentSchemaVersion, Name: "current"}).Error)
	return db
}

// TestEnsureChannelCodingPlanQuotaColumnsOnUpToDateDB 回归:channels.coding_plan_provider /
// coding_plan_key 是已有表上的新列,已到最新 schema 版本(跳过 autoMigrateAll)的库
// 只能靠幂等 ensure 补列——否则渠道启用编码套餐余量监控时报列不存在。
func TestEnsureChannelCodingPlanQuotaColumnsOnUpToDateDB(t *testing.T) {
	db := openCodingPlanQuotaUpToDateDB(t)

	// 前置:手工建一张不含新列的 channels 表(模拟旧库)。
	require.NoError(t, db.Exec(`CREATE TABLE channels (
		id integer PRIMARY KEY AUTOINCREMENT,
		name text NOT NULL,
		type integer DEFAULT 0,
		key text NOT NULL,
		status integer DEFAULT 1
	)`).Error)
	assert.False(t, db.Migrator().HasColumn(&Channel{}, "coding_plan_provider"))
	assert.False(t, db.Migrator().HasColumn(&Channel{}, "coding_plan_key"))

	require.NoError(t, ensureChannelCodingPlanQuotaColumns(db))
	assert.True(t, db.Migrator().HasColumn(&Channel{}, "coding_plan_provider"))
	assert.True(t, db.Migrator().HasColumn(&Channel{}, "coding_plan_key"))

	// 幂等:再次调用不报错、不加重复列。
	require.NoError(t, ensureChannelCodingPlanQuotaColumns(db))

	// 全新安装路径:channels 表尚不存在时,ensure 应为无操作(返回 nil),
	// 不应对不存在的表执行 ALTER TABLE。
	fresh := openCodingPlanQuotaUpToDateDB(t)
	require.NoError(t, ensureChannelCodingPlanQuotaColumns(fresh))
	assert.False(t, fresh.Migrator().HasTable(&Channel{}))
}
