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
	Version   int   `gorm:"primaryKey"`
	Name      string `gorm:"type:varchar(128)"`
	AppliedAt int64 `gorm:"autoCreateTime"`
}

func (SchemaMigration) TableName() string { return "schema_migrations" }

// CurrentSchemaVersion 是当前代码期望的 schema 版本。修改任何 model 结构时
// 必须递增该值；如需数据转换/特殊适配，同时新增对应的 Migration 条目。
// 兜底：DEBUG=true 启动时即使已最新也强制 AutoMigrate 校验结构。
const CurrentSchemaVersion = 1

// Migration 是一个可单独应用、记录版本戳的迁移步骤。Up 按版本升序执行，
// 用于 AutoMigrate 补不了的结构改造（换类型、删列）与数据迁移/特殊适配。
type Migration struct {
	Version int
	Name    string
	Up      func(db *gorm.DB) error
}

// migrations 按版本升序排列。v1 为版本化改造的基线：吸收此前 migrateDB 中
// AutoMigrate 之外的全部专项迁移与初始化逻辑（见 migrationBaselineV1）。
var migrations = []Migration{
	{Version: 1, Name: "baseline-2026-08", Up: migrationBaselineV1},
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
// ms 参数便于测试注入；生产路径传入包级 migrations。
func applyPendingMigrations(db *gorm.DB, applied int, ms []Migration) error {
	for _, m := range ms {
		if m.Version <= applied {
			continue
		}
		if err := m.Up(db); err != nil {
			return fmt.Errorf("schema migration %d (%s): %w", m.Version, m.Name, err)
		}
		if err := db.Create(&SchemaMigration{Version: m.Version, Name: m.Name}).Error; err != nil {
			return err
		}
		common.SysLog(fmt.Sprintf("applied schema migration %d (%s)", m.Version, m.Name))
	}
	return nil
}

// migrationBaselineV1 是版本化改造的基线迁移，吸收此前 migrateDB 中 AutoMigrate
// 之外的全部专项迁移与初始化逻辑。它们历史依赖全局 DB（model.DB），保持原样；
// db 参数在此版迁移中不直接使用，新迁移应优先使用传入的 db。
func migrationBaselineV1(db *gorm.DB) error {
	migrateSubscriptionPlanPriceAmount()
	if err := migrateTokenModelLimitsToText(); err != nil {
		return err
	}
	if err := InitializeUserAuthVersions(); err != nil {
		return err
	}
	if err := InitializeExternalIdentityClaims(); err != nil {
		return err
	}
	if err := ensureQuotaClaimRecordsClean(); err != nil {
		return err
	}
	if err := ensureQuotaClaimLockSeeded(); err != nil {
		return err
	}
	return ensureSubscriptionPlanRecommendedBackfill()
}
