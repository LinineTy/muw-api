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
	"fmt"
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

func TestMigrationDateAndSlug(t *testing.T) {
	assert.Equal(t, 260907, migrationDate("260907-subscription-period-ledger"))
	assert.Equal(t, 0, migrationDate("subscription-period-ledger")) // 无日期前缀
	assert.Equal(t, 0, migrationDate("26a907-x"))                   // 前 6 位非数字
	assert.Equal(t, 0, migrationDate("260906"))                     // 无 slug
	assert.Equal(t, "subscription-period-ledger", migrationSlug("260907-subscription-period-ledger"))
	assert.Equal(t, "", migrationSlug("bad-name"))
}

func TestValidateMigrations(t *testing.T) {
	noop := func(_ *gorm.DB) error { return nil }
	ok := []Migration{
		{Name: "260801-a", Up: noop},
		{Name: "260801-b", Up: noop}, // 同日多条允许（slug 区分）
		{Name: "260802-c", Up: noop},
	}
	require.NoError(t, validateMigrations(ok))

	cases := []struct {
		name string
		ms   []Migration
	}{
		{"重复名", []Migration{{Name: "260801-a", Up: noop}, {Name: "260801-a", Up: noop}}},
		{"无日期前缀", []Migration{{Name: "subscription-wipe", Up: noop}}},
		{"无 slug", []Migration{{Name: "260801", Up: noop}}},
		{"日期回退", []Migration{{Name: "260802-b", Up: noop}, {Name: "260801-a", Up: noop}}},
		{"Up 为 nil", []Migration{{Name: "260801-a"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			require.Error(t, validateMigrations(c.ms))
		})
	}
}

// TestPendingMigrationListTwoStep 覆盖两步过滤：① 只取日期 >= 当前已执行最大日期的迁移
// （只统计属于 ms 的名称，外行高戳不污染）；② 剔除已执行的 name；从早到晚排序。
func TestPendingMigrationListTwoStep(t *testing.T) {
	noop := func(_ *gorm.DB) error { return nil }

	t.Run("无已执行则全跑且按日期早到晚", func(t *testing.T) {
		ms := []Migration{
			{Name: "260803-b", Up: noop},
			{Name: "260801-a", Up: noop},
			{Name: "260802-c", Up: noop},
		}
		got := pendingMigrationList(ms, map[string]bool{})
		var names []string
		for _, m := range got {
			names = append(names, m.Name)
		}
		assert.Equal(t, []string{"260801-a", "260802-c", "260803-b"}, names)
	})

	t.Run("当前到 260801:只跑其后未执行的", func(t *testing.T) {
		ms := []Migration{
			{Name: "260801-a", Up: noop},
			{Name: "260802-b", Up: noop},
			{Name: "260803-c", Up: noop},
		}
		got := pendingMigrationList(ms, map[string]bool{"260801-a": true})
		var names []string
		for _, m := range got {
			names = append(names, m.Name)
		}
		assert.Equal(t, []string{"260802-b", "260803-c"}, names)
	})

	t.Run("同日第二条可补跑", func(t *testing.T) {
		ms := []Migration{
			{Name: "260906-a", Up: noop},
			{Name: "260906-b", Up: noop},
		}
		got := pendingMigrationList(ms, map[string]bool{"260906-a": true})
		require.Len(t, got, 1)
		assert.Equal(t, "260906-b", got[0].Name)
	})

	t.Run("早于当前已执行日期的代码迁移被时间步滤掉", func(t *testing.T) {
		ms := []Migration{
			{Name: "260805-old", Up: noop},
			{Name: "260906-head", Up: noop},
		}
		got := pendingMigrationList(ms, map[string]bool{"260906-head": true})
		assert.Empty(t, got)
	})

	t.Run("外行高戳不污染当前日期", func(t *testing.T) {
		// DB 里有一条不属于本 build 的高日期行(270101-foreign)，不得抬高当前戳、
		// 滤掉本线 260907 的新迁移。
		ms := []Migration{{Name: "260907-head", Up: noop}}
		applied := map[string]bool{
			"260906-base":    true,
			"270101-foreign": true,
		}
		got := pendingMigrationList(ms, applied)
		require.Len(t, got, 1)
		assert.Equal(t, "260907-head", got[0].Name)
	})
}

func TestReadAppliedMigrationNames(t *testing.T) {
	db := openSchemaMigrationTestDB(t)
	require.NoError(t, ensureSchemaMigrationsTable(db))

	applied, err := readAppliedMigrationNames(db)
	require.NoError(t, err)
	assert.Empty(t, applied)

	require.NoError(t, db.Create(&SchemaMigration{Name: "260801-a"}).Error)
	require.NoError(t, db.Create(&SchemaMigration{Name: "260907-head"}).Error)

	applied, err = readAppliedMigrationNames(db)
	require.NoError(t, err)
	assert.True(t, applied["260801-a"])
	assert.True(t, applied["260907-head"])
}

func TestApplyPendingMigrationsStampsAndSkipsApplied(t *testing.T) {
	db := openSchemaMigrationTestDB(t)
	require.NoError(t, ensureSchemaMigrationsTable(db))

	ran := map[string]bool{}
	ms := []Migration{
		{Name: "260801-one", Up: func(_ *gorm.DB) error { ran["one"] = true; return nil }},
		{Name: "260802-two", Up: func(_ *gorm.DB) error { ran["two"] = true; return nil }},
	}
	// 已应用过 260801-one：只执行日期在其后的 260802-two，并补打其名称戳。
	require.NoError(t, db.Create(&SchemaMigration{Name: "260801-one"}).Error)
	require.NoError(t, applyPendingMigrations(db, ms))
	assert.False(t, ran["one"])
	assert.True(t, ran["two"])

	var rec SchemaMigration
	require.NoError(t, db.Where("name = ?", "260802-two").First(&rec).Error)
	assert.NotZero(t, rec.AppliedAt)
}

// TestApplyPendingMigrationsRollsBackOnUpFailure 保护事务包裹:Up 中途失败时,事务内已写入
// 的数据与名称戳一起回滚,不产生"半迁移 + 已打戳"的不完整状态,下次启动会重新执行。
func TestApplyPendingMigrationsRollsBackOnUpFailure(t *testing.T) {
	db := openSchemaMigrationTestDB(t)
	require.NoError(t, ensureSchemaMigrationsTable(db))
	require.NoError(t, db.AutoMigrate(&Option{}))

	ms := []Migration{
		{Name: "260801-fail", Up: func(tx *gorm.DB) error {
			// 先写入一行数据,随后返回错误:整笔事务应回滚
			if err := tx.Create(&Option{Key: "rollback-probe", Value: "x"}).Error; err != nil {
				return err
			}
			return fmt.Errorf("boom")
		}},
	}

	err := applyPendingMigrations(db, ms)
	require.Error(t, err)

	// 数据回滚:Option 无残留
	var count int64
	require.NoError(t, db.Model(&Option{}).Where("key = ?", "rollback-probe").Count(&count).Error)
	assert.Zero(t, count)

	// 未打戳:下次启动会重新执行
	applied, err := readAppliedMigrationNames(db)
	require.NoError(t, err)
	assert.Empty(t, applied)
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

// TestUpgradeSchemaMigrationsTableToNameKey 覆盖旧形状（version 整数主键）→ name 主键的
// 一次性升级：旧行按 slug 后缀对到本 build 带日期的名字（applied_at 保留），
// 改名残留/外行行丢弃，幂等可续跑。
func TestUpgradeSchemaMigrationsTableToNameKey(t *testing.T) {
	db := openSchemaMigrationTestDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE schema_migrations (
		version integer PRIMARY KEY,
		name varchar(128),
		applied_at bigint)`).Error)
	// 旧行：v1/v13/v18 用本 build 现存 slug；v8 用改名前的旧名；999 为外行残留。
	seed := []struct {
		version   int
		name      string
		appliedAt int64
	}{
		{1, "baseline-2026-08", 100},
		{13, "subscription-renew-terms", 200},
		{18, "subscription-period-ledger", 300},
		{8, "credit-score-backfill", 400}, // 代码里已改名 user-null-backfill → 丢弃
		{999, "foreign-whatever", 500},    // 本 build 无此迁移 → 丢弃
	}
	for _, s := range seed {
		require.NoError(t, db.Exec("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
			s.version, s.name, s.appliedAt).Error)
	}

	require.NoError(t, ensureSchemaMigrationsTable(db))

	// 已升级：不再有 version 列。
	assert.False(t, db.Migrator().HasColumn(&SchemaMigration{}, "version"))

	applied, err := readAppliedMigrationNames(db)
	require.NoError(t, err)
	assert.True(t, applied["260802-baseline-2026-08"])
	assert.True(t, applied["260819-subscription-renew-terms"])
	assert.True(t, applied["260907-subscription-period-ledger"])
	assert.False(t, applied["260815-user-null-backfill"]) // 改名残留被丢弃，视为未跑（AutoMigrate 已保证结构）
	assert.False(t, applied["foreign-whatever"])

	// 幂等：二次调用为空操作。
	require.NoError(t, ensureSchemaMigrationsTable(db))
	applied2, err := readAppliedMigrationNames(db)
	require.NoError(t, err)
	assert.Equal(t, applied, applied2)
}

// TestMigrateDBAdoptsForeignHeadEndToEnd 复现原始事故：库被另一分支(accounts)以
// 同号不同内容迁移戳到 v18。main 启动不应误判"已最新"，而应升级表、AutoMigrate
// 补上 period_used、接管 head；二次启动收敛走 skip。
func TestMigrateDBAdoptsForeignHeadEndToEnd(t *testing.T) {
	prevDB := DB
	prevType := common.MainDatabaseType()
	prevDebug := common.DebugEnabled
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.DebugEnabled = false
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	defer func() {
		DB = prevDB
		common.SetMainDatabaseType(prevType)
		common.DebugEnabled = prevDebug
	}()

	// 种旧形状表：v1..v17 是本 build 现存 slug（共享基线），v18 槽被 accounts 分支
	// 的 "accounts-channel-decoupling" 占住（同号不同内容）。
	require.NoError(t, db.Exec(`CREATE TABLE schema_migrations (
		version integer PRIMARY KEY,
		name varchar(128),
		applied_at bigint)`).Error)
	foreign := "accounts-channel-decoupling"
	for i, m := range migrations {
		if i == len(migrations)-1 {
			require.NoError(t, db.Exec("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
				i+1, foreign, common.GetTimestamp()).Error)
		} else {
			require.NoError(t, db.Exec("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
				i+1, migrationSlug(m.Name), common.GetTimestamp()).Error)
		}
	}

	require.NoError(t, migrateDB())

	// 全量路径跑过：period_used 列建成；head 名称戳接管。
	assert.True(t, db.Migrator().HasColumn(&UserSubscription{}, "period_used"))
	var headCount int64
	require.NoError(t, db.Model(&SchemaMigration{}).Where("name = ?", migrations[len(migrations)-1].Name).Count(&headCount).Error)
	assert.EqualValues(t, 1, headCount)
	// 升级后表为 name 主键（version 列已消失）。
	assert.False(t, db.Migrator().HasColumn(&SchemaMigration{}, "version"))

	// 二次启动收敛：无待执行 → skip 快路径，返回 nil。
	require.NoError(t, migrateDB())
}

// TestValidateMigrationsAcceptsRealList 保护生产迁移列表本身合法（日期非递减、名字唯一）。
func TestValidateMigrationsAcceptsRealList(t *testing.T) {
	require.NoError(t, validateMigrations(migrations))
}
