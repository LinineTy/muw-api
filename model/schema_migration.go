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
	"sort"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// SchemaMigration 记录已应用的 schema 迁移。主键是迁移名（形如 <YYMMDD>-<slug>，自带日期
// 前缀）。迁移身份 = 名称而非共享整数计数器——不同开发分支各自以"日期-slug"命名，天然
// 防重名、可按时间排序，不会再出现两个分支把整数版本号顶到同一个值的"同号不同内容"
// 冲突（曾导致 main 误判已最新而跳过 AutoMigrate，缺列崩溃）。
type SchemaMigration struct {
	Name      string `gorm:"primaryKey;type:varchar(128)"`
	AppliedAt int64  `gorm:"autoCreateTime"`
}

func (SchemaMigration) TableName() string { return "schema_migrations" }

// Migration 是一个可单独应用、记录名称戳的迁移步骤。Name 必须形如 <YYMMDD>-<slug>
// （日期前缀用于"戳后"过滤与从早到晚排序；slug 描述用途）。启动按两步校验应用：
//   - ① 先按时间：只执行日期 ≥ 当前已执行最大日期的迁移（同日新增也 ≥，能补上）；
//   - ② 再按名称：已执行（name 已在 schema_migrations）的跳过，未执行的执行。
//
// 已发布迁移的 Name 不可改名或复用（否则已打戳库永远见不到 head，破坏性 Up 可能重跑）；
// 新增内容必须追加新条目，日期取 ≥ 当前最新迁移的 YYMMDD。
type Migration struct {
	Name string
	Up   func(db *gorm.DB) error
}

// migrationDate 解析迁移名里的 YYMMDD 日期前缀；非法格式返回 0。
func migrationDate(name string) int {
	if len(name) < 8 { // YYMMDD- 后至少还有 1 位 slug
		return 0
	}
	for _, r := range name[:6] {
		if r < '0' || r > '9' {
			return 0
		}
	}
	if name[6] != '-' {
		return 0
	}
	n, err := strconv.Atoi(name[:6])
	if err != nil {
		return 0
	}
	return n
}

// migrationSlug 去掉日期前缀返回 slug 部分；非法格式返回空串。
func migrationSlug(name string) string {
	if migrationDate(name) == 0 {
		return ""
	}
	return name[7:]
}

// validateMigrations 校验迁移列表的程序性错误（migrateDB 启动时调用，违反即 panic）：
// 每条 Name 形如 <YYMMDD>-<slug> 且全局唯一、Up 非空、日期从前到后非递减
// （新迁移取 ≥ 最新日期的 YYMMDD，否则会被"戳后"过滤漏掉）。
func validateMigrations(ms []Migration) error {
	seen := make(map[string]bool, len(ms))
	prevDate := 0
	for _, m := range ms {
		if m.Up == nil {
			return fmt.Errorf("migration %q: Up 不能为 nil", m.Name)
		}
		d := migrationDate(m.Name)
		if d == 0 {
			return fmt.Errorf("migration %q: Name 必须以 <YYMMDD>-<slug> 命名（如 260907-subscription-period-ledger）", m.Name)
		}
		if seen[m.Name] {
			return fmt.Errorf("duplicate migration name %q: 已发布迁移的 Name 不可改名或复用", m.Name)
		}
		seen[m.Name] = true
		if d < prevDate {
			return fmt.Errorf("migration %q: 日期早于前一条（%d < %d），新迁移请取 >= 当前最新日期的 YYMMDD", m.Name, d, prevDate)
		}
		prevDate = d
	}
	return nil
}

// migrations 按日期从早到晚排列。日期前缀取自各迁移引入 commit 的提交日（YYMMDD）；
// 同日多条允许（由 slug 区分，两步校验的 name 步骤能补跑同日的第二条）。
// 历史说明（整数版本时代的 vN → 现日期前缀）：
//   - 早期条目多数只打名称戳：表/列由 AutoMigrate（升日期路径）或幂等 ensure* 创建，
//     空 Up 无需数据转换；日期前缀推进 head，让"戳后无待执行"的快路径成立，
//     避免 SQLite 每次启动整表重建。
//   - 真正做数据转换的条目（baseline / subscription-redesign-wipe / 若干 backfill）有
//     实际 Up，各自保持幂等。
var migrations = []Migration{
	{Name: "260802-baseline-2026-08", Up: migrationBaselineV1},
	{Name: "260802-subscription-redesign-wipe", Up: migrationSubscriptionWipe},
	// users 表 LinuxDO token 三列由 AutoMigrate 添加，只打名称戳，无需数据转换。
	{Name: "260803-linuxdo-token-columns", Up: func(db *gorm.DB) error { return nil }},
	{Name: "260814-image-asset-table-noop", Up: func(db *gorm.DB) error { return nil }},
	{Name: "260814-playground-space-noop", Up: func(db *gorm.DB) error { return nil }},
	{Name: "260814-user-space-purchased-noop", Up: func(db *gorm.DB) error { return nil }},
	// users.space_purchased_bytes / space_capacity：AutoMigrate 加列后存量行 NULL，
	// 累计上限条件 NULL + x 恒假导致拒买，这里统一回填 0。Unscoped 覆盖软删除行。
	// 幂等，跑过名称戳后不再执行。
	{Name: "260814-user-space-purchased-backfill", Up: func(db *gorm.DB) error {
		if err := db.Unscoped().Model(&User{}).Where("space_purchased_bytes IS NULL").Update("space_purchased_bytes", 0).Error; err != nil {
			return err
		}
		return db.Unscoped().Model(&User{}).Where("space_capacity IS NULL").Update("space_capacity", 0).Error
	}},
	// users.credit_score：AutoMigrate 加列（default:650），此处防御性兜底残余 NULL，
	// 并 Unscoped 归一早期 backfill 漏掉的软删除行 space 字段。
	{Name: "260815-user-null-backfill", Up: func(db *gorm.DB) error {
		if err := db.Unscoped().Model(&User{}).Where("space_purchased_bytes IS NULL").Update("space_purchased_bytes", 0).Error; err != nil {
			return err
		}
		if err := db.Unscoped().Model(&User{}).Where("space_capacity IS NULL").Update("space_capacity", 0).Error; err != nil {
			return err
		}
		return db.Unscoped().Model(&User{}).Where("credit_score IS NULL").Update("credit_score", 650).Error
	}},
	// 风控三表上的补列/补表（retried/log_ids/prompt_used 等）：AutoMigrate（升日期路径）
	// 或 ensure*（已最新库的跳过路径）创建，只打名称戳。
	{Name: "260816-credit-marker-analysis-log-retried", Up: func(db *gorm.DB) error { return nil }},
	{Name: "260816-credit-marker-suggestion-log-ids", Up: func(db *gorm.DB) error { return nil }},
	{Name: "260816-credit-marker-analysis-log-prompt-used", Up: func(db *gorm.DB) error { return nil }},
	// credit_score_logs.reverted_at：AutoMigrate 加列后存量 NULL，归零保证 reverted_at=0 语义。
	{Name: "260817-credit-score-log-reverted", Up: func(db *gorm.DB) error {
		return db.Model(&CreditScoreLog{}).Where("reverted_at IS NULL").Update("reverted_at", 0).Error
	}},
	// user_subscriptions.renew_terms：AutoMigrate 加列，存量订阅无快照，只打名称戳。
	{Name: "260819-subscription-renew-terms", Up: func(db *gorm.DB) error { return nil }},
	// redemptions.type/max_uses/used_count + users.activated：AutoMigrate 加列后存量 NULL
	// 归一（type=1/max_uses=1/used_count=0/activated=1），Unscoped 覆盖软删除行。
	{Name: "260820-redemption-type-maxuses-backfill", Up: func(db *gorm.DB) error {
		if err := db.Unscoped().Model(&Redemption{}).Where("type IS NULL").Update("type", common.RedemptionCodeTypeTopup).Error; err != nil {
			return err
		}
		if err := db.Unscoped().Model(&Redemption{}).Where("max_uses IS NULL").Update("max_uses", 1).Error; err != nil {
			return err
		}
		if err := db.Unscoped().Model(&Redemption{}).Where("used_count IS NULL").Update("used_count", 0).Error; err != nil {
			return err
		}
		return db.Unscoped().Model(&User{}).Where("activated IS NULL").Update("activated", 1).Error
	}},
	// subscription_plans.reset_windows / user_subscriptions.window_state：AutoMigrate
	// 或 SQLite 手工 DDL / ensure* 添加，只打名称戳。
	{Name: "260822-subscription-reset-windows", Up: func(db *gorm.DB) error { return nil }},
	// 移除 legacy 订阅配额模型（9 个 legacy 列）：删列由幂等 ensureDropLegacy* 在
	// migrateDB 两条分支每次启动自检执行，本条目只打名称戳。
	{Name: "260824-subscription-remove-legacy-columns", Up: func(db *gorm.DB) error { return nil }},
	// channel_model_settings 表 + models.context_window 列：AutoMigrate 或 ensure* 创建。
	{Name: "260828-channel-model-settings-context-window", Up: func(db *gorm.DB) error { return nil }},
	// accounts 表（凭证与渠道解耦：key/base_url/代理/多key状态/编码套餐/余额）+
	// channels.account_id 列：由 AutoMigrate 或 ensureAccountsTable /
	// ensureChannelAccountIdColumn 创建；存量渠道迁移后自动挂私有账户。只打名称戳。
	// （原 feat/channel-refactor 分支的 v18 整数戳，按日期名戳纪律换算，日期取引入
	// commit de31fe4d3 的提交日 260829。）
	{Name: "260829-accounts-channel-decoupling", Up: func(db *gorm.DB) error { return nil }},
	// 订阅账本单期化：period_used 列由 AutoMigrate/ensure* 添加，删列由
	// ensureDropLegacySubscriptionLedgerColumns 幂等执行，只打名称戳。
	{Name: "260907-subscription-period-ledger", Up: func(db *gorm.DB) error { return nil }},
	// 固定分组（GroupPin）：group_pin_products / group_pins 两表由 AutoMigrate（升日期路径）
	// 或 ensureGroupPinTables（已最新库的跳过路径）创建；subscription_orders 的
	// kind / pin_product_id 列由 AutoMigrate 或 ensureSubscriptionOrderPinColumns 补齐。
	// 均为纯建表/加列，无数据转换，只打名称戳。
	{Name: "260909-group-pin", Up: func(db *gorm.DB) error { return nil }},
	// channel_accounts 表（渠道↔账户 N:N 绑定：一个渠道绑多账户、一个账户被多渠道绑）
	// 由 AutoMigrate（升日期路径）或 ensureChannelAccountsTable（已最新库的跳过路径）
	// 创建；存量绑定（channels.account_id → 一条 order=0 绑定）由 ensureChannelAccountBindings
	// 幂等回填。均为纯建表 + 幂等回填，无破坏性转换，只打名称戳。
	{Name: "260910-account-multibind", Up: func(db *gorm.DB) error { return nil }},
	// oidc_clients / oidc_auth_codes / oidc_refresh_tokens / oidc_consents / oidc_signing_keys
	// （对外提供 OAuth2/OIDC 身份验证）：纯建表、无数据转换，由 AutoMigrate（升日期路径）或
	// ensureOIDCProviderTables（已最新库的跳过路径）创建，只打名称戳。
	{Name: "260926-oidc-provider", Up: func(db *gorm.DB) error { return nil }},
	// oidc_clients.secret_cipher 列（存加密后的客户端密钥，供申请人自己查看；管理员看不到）：
	// 已有表上的新列，存量库走"跳过 AutoMigrate"路径，由 ensureOIDCClientSecretCipherColumn 幂等补齐。
	{Name: "260926-oidc-client-secret-cipher", Up: func(db *gorm.DB) error { return nil }},
	// oidc_clients.homepage_url / icon_url 列 + oidc_usage_stats 表（使用计数）：
	// 纯加列 + 建表，存量库由 ensureOIDCApplicationProfileColumns / ensureOIDCUsageStatTable 补齐。
	{Name: "260926-oidc-app-profile-and-usage", Up: func(db *gorm.DB) error { return nil }},
	// oidc_access_logs 表（OIDC 协议调用的明细，含 IP/UA/结果）：纯建表，
	// 存量库由 EnsureOIDCAccessLogTable 幂等补齐。
	{Name: "260926-oidc-access-log", Up: func(db *gorm.DB) error { return nil }},
}

// ensureSchemaMigrationsTable 用纯 SQL 建 schema_migrations（主键 name，自带日期前缀），
// 避免对版本表自身跑 AutoMigrate。存量旧形状（version 整数主键）一次性升级为 name 主键。
func ensureSchemaMigrationsTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&SchemaMigration{}) {
		// 旧形状带 version 整数列 → 一次性升级为 name 主键。
		if db.Migrator().HasColumn(&SchemaMigration{}, "version") {
			return upgradeSchemaMigrationsTable(db)
		}
		return nil
	}
	return db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		name varchar(128) PRIMARY KEY,
		applied_at bigint)`).Error
}

// upgradeSchemaMigrationsTable 把旧形状 schema_migrations（version integer PRIMARY KEY,
// name, applied_at）重建为 name 主键，旧行按 slug 后缀对到本 build 带日期的迁移名。
// 对不上的旧行（历史改名残留，其结构已由 AutoMigrate 保证）丢弃；已带日期前缀的行仅当
// 本 build 仍声明时保留。幂等可续跑：中途失败后下次启动重来。
func upgradeSchemaMigrationsTable(db *gorm.DB) error {
	type legacyMigration struct {
		Name      string
		AppliedAt int64
	}
	var legacy []legacyMigration
	if err := db.Table("schema_migrations").Order("version asc").Scan(&legacy).Error; err != nil {
		return err
	}
	// 本 build：slug → 带日期名。
	datedBySlug := make(map[string]string, len(migrations))
	codeNames := make(map[string]bool, len(migrations))
	for _, m := range migrations {
		if slug := migrationSlug(m.Name); slug != "" {
			datedBySlug[slug] = m.Name
		}
		codeNames[m.Name] = true
	}
	target := "schema_migrations_name_keyed"
	if err := db.Exec(`CREATE TABLE IF NOT EXISTS ` + target + ` (
		name varchar(128) PRIMARY KEY,
		applied_at bigint)`).Error; err != nil {
		return err
	}
	if err := db.Exec("DELETE FROM " + target).Error; err != nil {
		return err
	}
	seen := make(map[string]bool, len(legacy))
	for _, row := range legacy {
		var newName string
		if migrationDate(row.Name) != 0 {
			if codeNames[row.Name] {
				newName = row.Name
			}
		} else {
			newName = datedBySlug[row.Name]
		}
		if newName == "" || seen[newName] {
			continue
		}
		seen[newName] = true
		appliedAt := row.AppliedAt
		if appliedAt == 0 {
			appliedAt = common.GetTimestamp()
		}
		if err := db.Table(target).Create(map[string]interface{}{"name": newName, "applied_at": appliedAt}).Error; err != nil {
			return err
		}
	}
	// 换名（dialect 差异：MySQL 用 RENAME TABLE，其余用 ALTER TABLE ... RENAME TO）。
	renameToOld := "ALTER TABLE schema_migrations RENAME TO schema_migrations_old"
	renameNew := "ALTER TABLE " + target + " RENAME TO schema_migrations"
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		renameToOld = "RENAME TABLE schema_migrations TO schema_migrations_old"
		renameNew = "RENAME TABLE " + target + " TO schema_migrations"
	}
	if err := db.Exec(renameToOld).Error; err != nil {
		return err
	}
	if err := db.Exec(renameNew).Error; err != nil {
		return err
	}
	return db.Exec("DROP TABLE schema_migrations_old").Error
}

// readAppliedMigrationNames 返回已执行迁移名集合。
func readAppliedMigrationNames(db *gorm.DB) (map[string]bool, error) {
	applied := make(map[string]bool)
	var rows []SchemaMigration
	if err := db.Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		applied[r.Name] = true
	}
	return applied, nil
}

// pendingMigrationList 两步过滤出待执行迁移（早→晚）：
//   - ① 先按时间：只取日期 ≥ 当前已执行最大日期的迁移。当前已执行最大日期只统计属于 ms
//     的名称（外行高戳不污染，避免把本线未跑的迁移滤掉）；
//   - ② 再按名称：剔除已执行的 name。
//
// 同日第二条（日期 == 当前最大）经 ① ≥ 通过、② 按 name 补跑。
func pendingMigrationList(ms []Migration, applied map[string]bool) []Migration {
	names := make(map[string]bool, len(ms))
	for _, m := range ms {
		names[m.Name] = true
	}
	current := 0
	for name := range applied {
		if !names[name] {
			continue
		}
		if d := migrationDate(name); d > current {
			current = d
		}
	}
	pend := make([]Migration, 0, len(ms))
	for _, m := range ms {
		if applied[m.Name] {
			continue
		}
		if migrationDate(m.Name) >= current {
			pend = append(pend, m)
		}
	}
	// 从早到晚；同日保留代码列表内的原始相对顺序（sort 稳定）。
	sort.SliceStable(pend, func(i, j int) bool {
		return migrationDate(pend[i].Name) < migrationDate(pend[j].Name)
	})
	return pend
}

// runMigrations 依次执行待迁移：每条在独立事务中 Up + 打名称戳，Up 失败整体回滚且不写戳，
// 下次启动从该条重跑，杜绝"半迁移 + 已打戳"。注意：MySQL 的 DDL 会隐式提交，事务只保护
// 数据操作（DML）；数据转换类迁移的 Up 内部需自行保证幂等（与旧实现一致）。
func runMigrations(db *gorm.DB, pend []Migration) error {
	for _, m := range pend {
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := m.Up(tx); err != nil {
				return err
			}
			return tx.Create(&SchemaMigration{Name: m.Name}).Error
		})
		if err != nil {
			return fmt.Errorf("schema migration %s: %w", m.Name, err)
		}
		common.SysLog("applied schema migration " + m.Name)
	}
	return nil
}

// applyPendingMigrations 校验并执行待迁移（两步过滤，见 pendingMigrationList）。ms 便于
// 测试注入；生产路径由 migrateDB 传入包级 migrations。
func applyPendingMigrations(db *gorm.DB, ms []Migration) error {
	if err := validateMigrations(ms); err != nil {
		return err
	}
	applied, err := readAppliedMigrationNames(db)
	if err != nil {
		return err
	}
	return runMigrations(db, pendingMigrationList(ms, applied))
}

// migrationBaselineV1 是版本化改造的基线迁移，吸收此前 migrateDB 中 AutoMigrate 之外的
// 全部专项迁移与初始化逻辑。所有子步骤幂等，统一使用传入的 db（由 runMigrations 在事务
// 中执行），不再依赖全局 DB。
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
// AutoMigrate 已先于本迁移执行，表结构已升级到新版；这里 DELETE 清掉旧数据，让用户
// 重新配置套餐并重新分配。一次性执行，之后由名称戳防止重复。
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
