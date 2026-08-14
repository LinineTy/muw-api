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

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// SchemaMigration 记录已应用的 schema 迁移版本。启动时若已应用版本达到
// CurrentSchemaVersion 就跳过 AutoMigrate 与迁移，避免 SQLite（glebarez 驱动）
// 每次启动整表重建，也为旧库升级提供按版本的特殊适配通道。
type SchemaMigration struct {
	Version   int    `gorm:"primaryKey"`
	Name      string `gorm:"type:varchar(128)"`
	AppliedAt int64  `gorm:"autoCreateTime"`
}

func (SchemaMigration) TableName() string { return "schema_migrations" }

// CurrentSchemaVersion 是当前代码期望的 schema 版本。修改任何 model 结构时
// 必须递增该值；如需数据转换/特殊适配，同时新增对应的 Migration 条目。
// 兜底：DEBUG=true 启动时即使已最新也强制 AutoMigrate 校验结构。
// v5：users 表新增 space_capacity 列 + 新增 playground_conversations 表。
// v6：users 表新增 space_purchased_bytes 列（累计购买量）。
const CurrentSchemaVersion = 6

// Migration 是一个可单独应用、记录版本戳的迁移步骤。Up 按版本升序执行，
// 用于 AutoMigrate 补不了的结构改造（换类型、删列）与数据迁移/特殊适配。
type Migration struct {
	Version int
	Name    string
	Up      func(db *gorm.DB) error
}

// migrations 按版本升序排列。v1 为版本化改造的基线：吸收此前 migrateDB 中
// AutoMigrate 之外的全部专项迁移与初始化逻辑（见 migrationBaselineV1）。
// v2 为订阅功能重设计：清空四张订阅表（AutoMigrate 已先把表结构升级到新版），
// 一次性破坏性操作，之后不再执行。
var migrations = []Migration{
	{Version: 1, Name: "baseline-2026-08", Up: migrationBaselineV1},
	{Version: 2, Name: "subscription-redesign-wipe", Up: migrationSubscriptionWipe},
	// v3: users 表新增 LinuxDO token 三列。列本身由 AutoMigrate 添加（本迁移在其后
	// 执行），此条目只打版本戳，避免每次启动 SQLite 整表重建。空 Up 表明无需数据
	// 转换：旧用户无 token，下次 LinuxDO 登录时写入。
	{Version: 3, Name: "linuxdo-token-columns", Up: func(db *gorm.DB) error { return nil }},
	// v4（图床表）/v5（users.space_capacity + playground 表/列）/v6（users.space_purchased_bytes）
	// 同理只打版本戳：表/列由 AutoMigrate 创建，无需数据转换；把版本推进到
	// CurrentSchemaVersion 让 shouldSkipMigration 生效，避免每次启动重复全量 AutoMigrate
	//（SQLite 整表重建风险）。
	{Version: 4, Name: "image-asset-table-noop", Up: func(db *gorm.DB) error { return nil }},
	{Version: 5, Name: "playground-space-noop", Up: func(db *gorm.DB) error { return nil }},
	{Version: 6, Name: "user-space-purchased-noop", Up: func(db *gorm.DB) error { return nil }},
}

// ensureSchemaMigrationsTable 用纯 SQL 建版本表，避免对版本表自身跑 AutoMigrate。
func ensureSchemaMigrationsTable(db *gorm.DB) error {
	return db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version integer PRIMARY KEY,
		name varchar(128),
		applied_at bigint)`).Error
}

// appliedSchemaVersion 返回已应用的最大迁移版本，无记录时返回 0。
func appliedSchemaVersion(db *gorm.DB) (int, error) {
	var version int
	err := db.Model(&SchemaMigration{}).
		Select("COALESCE(MAX(version), 0)").
		Scan(&version).Error
	return version, err
}

// shouldSkipMigration 判断是否可跳过迁移：已到最新版本且非 DEBUG。
// DEBUG 模式不跳过，强制 AutoMigrate 校验结构，防止改 model 忘递增版本戳
// 导致生产结构不同步（DEBUG 主要用于开发环境）。
func shouldSkipMigration(applied int) bool {
	return applied >= CurrentSchemaVersion && !common.DebugEnabled
}

// applyPendingMigrations 依次执行 applied 之后的所有迁移并逐个打版本戳。
// 每个迁移在独立事务中执行:Up 与打戳同事务,Up 失败则整体回滚且不写戳,
// 下次启动会从该版本重新执行,杜绝"半迁移 + 已打戳"的不完整状态。
// 注意:MySQL 的 DDL 会隐式提交,事务只能保护数据操作(DML);SQLite 与
// PostgreSQL 支持事务性 DDL,回滚更彻底。数据转换类迁移仍应在 Up 内部
// 自行保证幂等。ms 参数便于测试注入;生产路径传入包级 migrations。
func applyPendingMigrations(db *gorm.DB, applied int, ms []Migration) error {
	for _, m := range ms {
		if m.Version <= applied {
			continue
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := m.Up(tx); err != nil {
				return err
			}
			return tx.Create(&SchemaMigration{Version: m.Version, Name: m.Name}).Error
		})
		if err != nil {
			return fmt.Errorf("schema migration %d (%s): %w", m.Version, m.Name, err)
		}
		common.SysLog(fmt.Sprintf("applied schema migration %d (%s)", m.Version, m.Name))
	}
	return nil
}

// migrationBaselineV1 是版本化改造的基线迁移，吸收此前 migrateDB 中 AutoMigrate
// 之外的全部专项迁移与初始化逻辑。所有子步骤幂等,统一使用传入的 db
// (由 applyPendingMigrations 在事务中执行),不再依赖全局 DB。
func migrationBaselineV1(db *gorm.DB) error {
	if err := migrateSubscriptionPlanPriceAmount(db); err != nil {
		return err
	}
	if err := migrateTokenModelLimitsToText(db); err != nil {
		return err
	}
	if err := InitializeUserAuthVersions(db); err != nil {
		return err
	}
	if err := InitializeExternalIdentityClaims(db); err != nil {
		return err
	}
	if err := ensureQuotaClaimRecordsClean(db); err != nil {
		return err
	}
	if err := ensureQuotaClaimLockSeeded(db); err != nil {
		return err
	}
	return ensureSubscriptionPlanRecommendedBackfill(db)
}

// migrationSubscriptionWipe 是订阅功能重设计的破坏性迁移：清空四张订阅表。
// AutoMigrate 已先于本迁移执行，表结构已升级到新版；这里 DELETE 清掉旧数据，
// 让用户重新配置套餐并重新分配。一次性执行，之后由 v2 版本戳防止重复。
func migrationSubscriptionWipe(db *gorm.DB) error {
	tables := []string{
		"subscription_pre_consume_records",
		"subscription_orders",
		"user_subscriptions",
		"subscription_plans",
	}
	for _, table := range tables {
		if err := db.Exec("DELETE FROM " + table).Error; err != nil {
			return fmt.Errorf("subscription redesign wipe %s: %w", table, err)
		}
	}
	common.SysLog("[WARN] 订阅功能重设计迁移已执行：清空了 subscription_plans / user_subscriptions / subscription_orders / subscription_pre_consume_records，请重新配置套餐并为用户分配")
	return nil
}
