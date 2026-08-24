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

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestEnsureSubscriptionPlanTableSQLiteAddsMissingColumns 保护 SQLite 手工 DDL 的
// 列补齐行为：已存在但缺 priority 等新增列的表，ensureSubscriptionPlanTableSQLite
// 必须补上缺失列（回归：曾因该函数只在 autoMigrateAll 里调用，已到最新 schema 的
// 库走 skip 分支时永远不补 priority 列，导致建套餐报 "no such column: priority"）。
func TestEnsureSubscriptionPlanTableSQLiteAddsMissingColumns(t *testing.T) {
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

	// 模拟升级前旧库：表已存在但缺少 priority（以及部分旧结构）。
	require.NoError(t, db.Exec(`CREATE TABLE subscription_plans (
		id integer PRIMARY KEY,
		title varchar(128) NOT NULL,
		price_amount decimal(10,6) NOT NULL,
		created_at bigint,
		updated_at bigint)`).Error)

	require.NoError(t, ensureSubscriptionPlanTableSQLite())

	var cols []struct {
		Name string `gorm:"column:name"`
	}
	require.NoError(t, db.Raw("PRAGMA table_info(`subscription_plans`)").Scan(&cols).Error)
	names := make(map[string]bool, len(cols))
	for _, c := range cols {
		names[c.Name] = true
	}
	assert.True(t, names["priority"], "必须补上 priority 列")
	assert.True(t, names["reset_windows"], "其他必需列也应补齐")

	// 补列后写入含 priority 的行应成功。
	require.NoError(t, db.Exec("INSERT INTO subscription_plans (title, price_amount, priority, created_at, updated_at) VALUES ('x', 1, 5, 1, 1)").Error)
}
