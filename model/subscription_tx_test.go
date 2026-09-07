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
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func openSubscriptionDeltaTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// 多连接模拟真实连接池：若实现错误地对全局 DB 另开嵌套事务，能快速暴露
	// 非原子（而非在单连接下死锁），从而快速失败而不是挂起测试。
	sqlDB.SetMaxOpenConns(4)
	return db
}

// TestPostConsumeUserSubscriptionDeltaJoinsCallerTransaction 验证传入的 db（调用方
// 事务）被用于执行 delta 更新：外层事务回滚时，delta 一并回滚。回归场景：Refund
// 流程曾在 DB.Transaction 内对全局 DB 另开独立事务，导致 SQLite+WAL 下读快照过期
// 报 SQLITE_BUSY_SNAPSHOT，且 MySQL 下破坏外层事务原子性（外层回滚后 delta 仍生效）。
func TestPostConsumeUserSubscriptionDeltaJoinsCallerTransaction(t *testing.T) {
	prevType := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	defer func() { common.SetMainDatabaseType(prevType) }()

	db := openSubscriptionDeltaTestDB(t)
	require.NoError(t, db.AutoMigrate(&UserSubscription{}))

	sub := &UserSubscription{UserId: 1, PeriodUsed: 100, Status: "active"}
	require.NoError(t, db.Create(sub).Error)

	rollbackErr := errors.New("force rollback")
	err := db.Transaction(func(tx *gorm.DB) error {
		require.NoError(t, PostConsumeUserSubscriptionDelta(tx, sub.Id, -10))
		return rollbackErr
	})
	require.Equal(t, rollbackErr, err)

	var after UserSubscription
	require.NoError(t, db.First(&after, sub.Id).Error)
	assert.Equal(t, int64(100), after.PeriodUsed, "delta 必须随外层事务一起回滚")
}

// TestPostConsumeUserSubscriptionDeltaDefaultUsesGlobalDB 验证 nil 时走全局 DB，
// 保持顶层调用（无外层事务）语义不变。
func TestPostConsumeUserSubscriptionDeltaDefaultUsesGlobalDB(t *testing.T) {
	prevType := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	defer func() { common.SetMainDatabaseType(prevType) }()

	db := openSubscriptionDeltaTestDB(t)
	require.NoError(t, db.AutoMigrate(&UserSubscription{}))

	sub := &UserSubscription{UserId: 1, PeriodUsed: 100, Status: "active"}
	require.NoError(t, db.Create(sub).Error)

	prevDB := DB
	DB = db
	defer func() { DB = prevDB }()

	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, sub.Id, -10))

	var after UserSubscription
	require.NoError(t, db.First(&after, sub.Id).Error)
	assert.Equal(t, int64(90), after.PeriodUsed)
}
