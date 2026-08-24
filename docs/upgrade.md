# 数据库升级指南

本文档说明从旧版本代码的存量数据库升级到当前版本的步骤与注意事项。升级路径已用 MySQL 8.4 的真实数据备份实测验证。

## 升级前准备

1. **备份**（必须）
   - MySQL：`mysqldump --single-transaction -u<user> -p <db> > backup.sql`，或用面板完整备份。
   - SQLite：直接复制 `.db` 文件。
   - 备份要能用于回滚。

2. **确认数据库版本**：MySQL ≥ 5.7.8，PostgreSQL ≥ 9.6，或 SQLite。生产 MySQL 8.x 均可。

3. **确认字符集**：应用启动时会执行 `checkMySQLChineseSupport`，若库/表默认字符集不支持中文（如 `latin1`）会直接 panic。升级前确认所有表为 `utf8mb4` 及以上：
   ```sql
   SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
   FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '<db>';
   ```

4. **磁盘空间**：迁移会为新表/新列建索引，预留足够空间。

## 升级步骤

1. 停掉旧版服务。
2. 用备份确认旧库可读。
3. 部署新版二进制（或替换代码后重新编译）。
4. 启动新版，**自动执行迁移**（`migrateDB`）：
   - 首次启动：建 `schema_migrations` 版本表 → `AutoMigrate` 补结构 + 执行版本迁移 → 打版本戳 → 日志出现 `database migrated to schema version N`。
   - 失败会 `[FATAL] failed to initialize database` 退出，此时看日志定位。
5. 再次启动：读到版本戳已是最新 → 日志出现 `schema already at version N, skipping migration` → **跳过 AutoMigrate 与迁移**（无 DDL，快速启动）。

## 升级后验证

1. **新表存在**：
   ```sql
   SHOW TABLES LIKE 'quota_claim_records';
   SHOW TABLES LIKE 'quota_claim_locks';
   SHOW TABLES LIKE 'channel_test_records';
   ```
2. **数据保留**：抽查关键表行数与升级前一致（`users`、`channels`、`subscription_plans` 等）。
3. **新列就位**：以 `users` 为例应含 `linux_do_trust_level`、`group_auto`、`avatar`、`avatar_custom`；`subscription_plans` 应含 `is_recommended`、`reset_amount_limit` 等。
4. **功能冒烟**：登录、额度池领取/打卡、订阅、充值各跑一遍。

## 已知注意事项

- **孤儿表 / 残留列（升级保留，可手动清理）**：`checkins`、`_bak_*` 等旧备份表，以及 `users.stripe_customer`、`subscription_plans.stripe_price_id/creem_product_id/waffo_pancake_product_id` 等旧列，升级后原样保留、不影响运行。代码不自动清理（`ensureDropLegacySubscriptionPlanColumns` 仅覆盖旧配额列，不含上述支付列），需手动 DROP；2026-08-25 新库升级遇同类残留可先 dump 备份再删除。
- **额度池从零开始**：额度池已收敛为单池（`quota_claim_records` + `options` 配置），旧 `quota_pools`/`checkins` 的历史领取/打卡数据不会回迁，升级后需在管理端重新配置额度池规则。
- **MySQL 1101（TEXT 默认值）已修复**：`subscription_plans.allowed_groups` 曾因 `text DEFAULT ''` 导致 MySQL 迁移报错 `Error 1101`，当前版本已移除该默认值。
- **反复 ALTER 已消除**：`subscription_plans.enabled/is_recommended`、`custom_oauth_providers.enabled` 的 `gorm:"default:true/false"` 及 `price_amount` 的 `default:0` 已按项目规范移除，避免 MySQL/PostgreSQL 每次启动重复执行 `ALTER TABLE`。

## 三种数据库

- **SQLite**：`subscription_plans` 由手工 DDL 管理（`ensureSubscriptionPlanTableSQLite`），其余表走 AutoMigrate。迁移为纯加列/建表，无类型变更，SQLite 不支持的 `ALTER COLUMN` 已全部避开。
- **MySQL / PostgreSQL**：AutoMigrate 加列 + 两个专项类型迁移（`model_limits` varchar→text、`price_amount` →decimal）已幂等兜底。

## Schema 版本化迁移

从本版本起，数据库迁移改为**版本戳驱动**，解决此前 SQLite 每次启动整表重建、升级路径不明确的问题。

**机制**：
- 新建 `schema_migrations` 表（version / name / applied_at），记录已应用的迁移版本。
- 常量 `model.CurrentSchemaVersion` 表示当前代码期望的 schema 版本。
- 启动时读取已应用版本：
  - **已到最新** → 日志 `schema already at version N, skipping migration`，跳过 AutoMigrate 与迁移（SQLite 不再整表重建，启动更快）。
  - **未到最新 / 无戳（新装或旧库升级）** → `AutoMigrate` 补结构到最新 → 依次执行缺失的版本迁移（`model.migrations`，处理换类型/删列/数据转换等 AutoMigrate 做不到的适配）→ 逐个打戳。
  - **DEBUG=true** → 即使已最新也强制 `AutoMigrate` 校验结构（开发期兜底，生产不启用）。
- 多实例：仅主节点执行迁移（`IsMasterNode`），无并发冲突。

**未来开发流程（改 model 时）**：
1. 修改 `model/` 下的结构体。
2. **递增 `CurrentSchemaVersion`**（必须，否则生产已最新库会跳过、新列不建）。
3. 如需数据转换/特殊适配（AutoMigrate 做不了的结构改造、存量数据回填等），在 `model/schema_migration.go` 的 `migrations` 里新增一条 `Migration{Version: N, Name: "...", Up: ...}`，`Up` 里用传入的 `db` 执行。
4. 忘了递增的兜底：本地 `DEBUG=true` 启动会强制 AutoMigrate 并暴露结构差异。

**历史痛点已解决**：
- **SQLite 每次启动整表重建**（glebarez 驱动对 `unique;index` 列判断不一致导致）：已最新库跳过 AutoMigrate，不再重建。实测同一 SQLite 库连启两次，第二次 0 条 DDL。
- **升级路径不明确**：旧库首次跑新代码走「AutoMigrate 补结构 + v1 基线迁移（吸收此前全部专项迁移）→ 打 v1 戳」，之后即跳过。

### ⚠️ v2 迁移：订阅功能重设计（破坏性清空）

从 v2 起订阅模型重构（独立额度计数器 + 套餐档位 Priority + 功能开关）。**升级到 v2 会一次性清空全部订阅数据**：`subscription_plans`、`user_subscriptions`、`subscription_orders`、`subscription_pre_consume_records` 四张表的数据全部删除（表结构由 AutoMigrate 升级为新版）。

- 升级后需**重新配置套餐**，并为受影响用户**重新分配等额新套餐**（此为有意的产品决策，不做旧数据兼容）。
- 迁移在启动时自动执行一次（日志含 `[WARN] 订阅功能重设计迁移已执行...`），之后由 v2 版本戳防止重复。
- `user_subscriptions` 新增 `cycle_start_at`/`cycle_used`/`next_cycle_reset_at`/`week_used`/`month_used`/`tier_priority`；旧的 `cycle_start_used`/`week_start_used`/`month_start_used`/`last_reset_time` 等列保留为孤儿列，不参与运行。

**v16：移除 legacy 订阅配额模型。** 动态窗口（`reset_windows`）成为唯一模型，删除：
`subscription_plans` 的 `total_amount`/`quota_reset_period`/`quota_reset_custom_seconds`/
`reset_amount_limit`/`weekly_amount_limit`/`monthly_amount_limit`，以及 `user_subscriptions`
的 `cycle_start_at`/`cycle_used`/`next_cycle_reset_at`。删列由幂等 `ensureDropLegacy*` 在每次
启动自动执行（SQLite 先删索引再删列），v16 版本戳记录该变更。**无限额度改由动态窗口表达**：
全部窗口 `limit=0` 即无限（不再有 `total_amount=0` 的 legacy 出口）。

**未来开发流程（改 model 时）**：
1. 修改 `model/` 下的结构体。
2. **递增 `CurrentSchemaVersion`**（必须，否则生产已最新库会跳过、新列不建）。
3. 如需数据转换/特殊适配（AutoMigrate 做不了的结构改造、存量数据回填等），在 `model/schema_migration.go` 的 `migrations` 里新增一条 `Migration{Version: N, Name: "...", Up: ...}`，`Up` 里用传入的 `db` 执行。
4. 忘了递增的兜底：本地 `DEBUG=true` 启动会强制 AutoMigrate 并暴露结构差异。
