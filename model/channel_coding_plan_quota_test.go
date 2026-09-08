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

// openCodingPlanQuotaUpToDateDB 模拟"已到最新 schema"的库:schema_migrations 已打上
// 最新 head 迁移(名称戳),两步校验会跳过 autoMigrateAll,新增列只能靠幂等 ensure 补上。
func openCodingPlanQuotaUpToDateDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, ensureSchemaMigrationsTable(db))
	require.NoError(t, db.Create(&SchemaMigration{Name: migrations[len(migrations)-1].Name}).Error)
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

// TestEnsureChannelCodingPlanAutoControlColumnsOnUpToDateDB 回归:channels 的
// coding_plan_auto_control / *_threshold 是已有表上的新列,已到最新 schema 版本的库
// 只能靠幂等 ensure 补列——否则自动启停任务查询这些列时报列不存在。
func TestEnsureChannelCodingPlanAutoControlColumnsOnUpToDateDB(t *testing.T) {
	db := openCodingPlanQuotaUpToDateDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE channels (
		id integer PRIMARY KEY AUTOINCREMENT,
		name text NOT NULL,
		type integer DEFAULT 0,
		key text NOT NULL,
		status integer DEFAULT 1
	)`).Error)
	for _, column := range []string{
		"coding_plan_auto_control",
		"coding_plan_disable_threshold",
		"coding_plan_enable_threshold",
	} {
		assert.False(t, db.Migrator().HasColumn(&Channel{}, column))
	}

	require.NoError(t, ensureChannelCodingPlanAutoControlColumns(db))
	for _, column := range []string{
		"coding_plan_auto_control",
		"coding_plan_disable_threshold",
		"coding_plan_enable_threshold",
	} {
		assert.True(t, db.Migrator().HasColumn(&Channel{}, column))
	}

	// 幂等:再次调用不报错、不加重复列。
	require.NoError(t, ensureChannelCodingPlanAutoControlColumns(db))

	// 全新安装路径:channels 表尚不存在时 ensure 为无操作。
	fresh := openCodingPlanQuotaUpToDateDB(t)
	require.NoError(t, ensureChannelCodingPlanAutoControlColumns(fresh))
	assert.False(t, fresh.Migrator().HasTable(&Channel{}))
}
