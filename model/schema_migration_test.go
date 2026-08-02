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

func openSchemaMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	return db
}

func TestAppliedSchemaVersionEmpty(t *testing.T) {
	db := openSchemaMigrationTestDB(t)
	require.NoError(t, ensureSchemaMigrationsTable(db))

	applied, err := appliedSchemaVersion(db)
	require.NoError(t, err)
	assert.Zero(t, applied)
}

func TestAppliedSchemaVersionReturnsMax(t *testing.T) {
	db := openSchemaMigrationTestDB(t)
	require.NoError(t, ensureSchemaMigrationsTable(db))
	require.NoError(t, db.Create(&SchemaMigration{Version: 1, Name: "a"}).Error)
	require.NoError(t, db.Create(&SchemaMigration{Version: 3, Name: "c"}).Error)
	require.NoError(t, db.Create(&SchemaMigration{Version: 2, Name: "b"}).Error)

	applied, err := appliedSchemaVersion(db)
	require.NoError(t, err)
	assert.Equal(t, 3, applied)
}

func TestShouldSkipMigration(t *testing.T) {
	prevDebug := common.DebugEnabled
	common.DebugEnabled = false
	defer func() { common.DebugEnabled = prevDebug }()

	// 非 DEBUG：已到最新版本则跳过；低于最新则不跳过。
	assert.True(t, shouldSkipMigration(CurrentSchemaVersion))
	assert.True(t, shouldSkipMigration(CurrentSchemaVersion+1))
	assert.False(t, shouldSkipMigration(CurrentSchemaVersion-1))
	assert.False(t, shouldSkipMigration(0))
}

func TestShouldSkipMigrationDisabledInDebug(t *testing.T) {
	prevDebug := common.DebugEnabled
	common.DebugEnabled = true
	defer func() { common.DebugEnabled = prevDebug }()

	// DEBUG：即使已最新也不跳过（强制 AutoMigrate 校验结构）。
	assert.False(t, shouldSkipMigration(CurrentSchemaVersion))
}

func TestApplyPendingMigrationsStampsAndSkipsApplied(t *testing.T) {
	db := openSchemaMigrationTestDB(t)
	require.NoError(t, ensureSchemaMigrationsTable(db))

	ran := map[int]bool{}
	ms := []Migration{
		{Version: 1, Name: "one", Up: func(_ *gorm.DB) error { ran[1] = true; return nil }},
		{Version: 2, Name: "two", Up: func(_ *gorm.DB) error { ran[2] = true; return nil }},
	}

	// 已应用过版本 1：只执行版本 2，并补打版本 2 的戳。
	require.NoError(t, applyPendingMigrations(db, 1, ms))
	assert.False(t, ran[1])
	assert.True(t, ran[2])

	applied, err := appliedSchemaVersion(db)
	require.NoError(t, err)
	assert.Equal(t, 2, applied)

	var rec SchemaMigration
	require.NoError(t, db.Where("version = ?", 2).First(&rec).Error)
	assert.Equal(t, "two", rec.Name)
	assert.NotZero(t, rec.AppliedAt)
}

// TestMigrationSubscriptionWipe 保护订阅重设计的破坏性迁移：清空四张订阅表。
func TestMigrationSubscriptionWipe(t *testing.T) {
	db := openSchemaMigrationTestDB(t)
	require.NoError(t, db.AutoMigrate(&SubscriptionPlan{}, &SubscriptionOrder{}, &UserSubscription{}, &SubscriptionPreConsumeRecord{}))
	require.NoError(t, db.Create(&SubscriptionPlan{Id: 1, Title: "p", PriceAmount: 1, DurationUnit: "month", DurationValue: 1}).Error)
	require.NoError(t, db.Create(&UserSubscription{Id: 1, UserId: 1, PlanId: 1, Status: "active", EndTime: 100}).Error)
	require.NoError(t, db.Create(&SubscriptionOrder{Id: 1, UserId: 1, PlanId: 1, TradeNo: "TN1", Status: "pending"}).Error)
	require.NoError(t, db.Create(&SubscriptionPreConsumeRecord{Id: 1, RequestId: "R1", UserId: 1, PreConsumed: 1, Status: "consumed"}).Error)

	require.NoError(t, migrationSubscriptionWipe(db))

	var planCount, subCount, orderCount, recCount int64
	require.NoError(t, db.Model(&SubscriptionPlan{}).Count(&planCount).Error)
	require.NoError(t, db.Model(&UserSubscription{}).Count(&subCount).Error)
	require.NoError(t, db.Model(&SubscriptionOrder{}).Count(&orderCount).Error)
	require.NoError(t, db.Model(&SubscriptionPreConsumeRecord{}).Count(&recCount).Error)
	assert.Zero(t, planCount)
	assert.Zero(t, subCount)
	assert.Zero(t, orderCount)
	assert.Zero(t, recCount)
}
