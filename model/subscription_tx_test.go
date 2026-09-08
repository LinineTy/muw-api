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
	"fmt"
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
		require.NoError(t, PostConsumeUserSubscriptionDelta(tx, sub.UserId, sub.Id, -10))
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

	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, sub.UserId, sub.Id, -10))

	var after UserSubscription
	require.NoError(t, db.First(&after, sub.Id).Error)
	assert.Equal(t, int64(90), after.PeriodUsed)
}

// TestPostConsumeDeltaOnDeadSubscriptionRoutesToWallet 预扣发生在请求开始，结算可能晚于
// 订阅切换/取消/过期甚至被管理端物理删除。死订阅的窗口与账本已冻结，delta 继续写入死行
// 会让补扣（正 delta）静默蒸发（平台少收）、退款（负 delta）退进死订阅拿不回来——
// 因此非 active 订阅与已删除订阅的 delta 一律转钱包结算；active 订阅仍走订阅回填（回归）。
func TestPostConsumeDeltaOnDeadSubscriptionRoutesToWallet(t *testing.T) {
	prevType := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	defer func() { common.SetMainDatabaseType(prevType) }()

	db := openSubscriptionDeltaTestDB(t)
	require.NoError(t, db.AutoMigrate(&User{}, &UserSubscription{}, &SubscriptionPlan{}, &SubscriptionPreConsumeRecord{}))
	prevDB := DB
	DB = db
	defer func() { DB = prevDB }()

	seedQuotaPlan(t, 7901, &SubscriptionPlan{
		Title: "dead-a", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		ResetWindowsRaw: `[{"unit":"hour","value":5,"limit":100}]`,
	})
	now := GetDBTimestamp()
	// 9001: cancelled；9002: expired；9003: active（回归对照）；钱包用户 901/902/903。
	for i, status := range []string{"cancelled", "expired", "active"} {
		userId := 901 + i
		require.NoError(t, db.Create(&User{Id: userId, Username: fmt.Sprintf("dead-user-%d", userId), AffCode: fmt.Sprintf("dead%d", userId), Quota: 1_000_000}).Error)
		require.NoError(t, db.Create(&UserSubscription{
			Id: 9001 + i, UserId: userId, PlanId: 7901, Status: status,
			PeriodUsed: 500, StartTime: now, EndTime: now + 30*86400,
			WindowState: windowStateJSON(windowEntry(0, 100, now, now+5*3600)),
		}).Error)
	}

	// a) cancelled 订阅 + 补扣 300 → 钱包扣 300，订阅行冻结不动。
	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, 901, 9001, 300))
	getUser := func(id int) User {
		t.Helper()
		var u User
		require.NoError(t, db.Session(&gorm.Session{NewDB: true}).Where("id = ?", id).First(&u).Error)
		return u
	}
	assert.EqualValues(t, 1_000_000-300, getUser(901).Quota, "补扣转钱包：用户实际消耗必须付到钱包")
	dead := getSubByID(t, 9001)
	assert.EqualValues(t, 500, dead.PeriodUsed, "死订阅账本冻结，不得写入")

	// b) expired 订阅 + 退款 -200 → 钱包加 200，订阅行冻结不动。
	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, 902, 9002, -200))
	assert.EqualValues(t, 1_000_000+200, getUser(902).Quota, "退款转钱包：超额预扣必须退回钱包")
	dead = getSubByID(t, 9002)
	assert.EqualValues(t, 500, dead.PeriodUsed, "死订阅账本冻结，不得写入")

	// c) 订阅行被物理删除（管理端删除场景）→ 转钱包，不报错。
	require.NoError(t, db.Delete(&UserSubscription{}, 9001).Error)
	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, 901, 9001, 100))
	assert.EqualValues(t, 1_000_000-400, getUser(901).Quota, "行已删除仍转钱包，资金不蒸发")

	// d) active 订阅 → 正常走订阅回填，钱包不动（回归）。
	require.NoError(t, PostConsumeUserSubscriptionDelta(nil, 903, 9003, 300))
	live := getSubByID(t, 9003)
	assert.EqualValues(t, 800, live.PeriodUsed, "active 订阅走订阅账本")
	assert.EqualValues(t, 1_000_000, getUser(903).Quota, "active 订阅不触碰钱包")
}
