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
   - 首次启动：建 `schema_migrations`（主键 = 迁移名 `<YYMMDD>-<slug>`）→ `AutoMigrate` 补结构 + 执行未应用的迁移 → 逐条打名称戳 → 日志出现 `database migrated; head migration "…" (YYMMDD) applied`。
   - 失败会 `[FATAL] failed to initialize database` 退出，此时看日志定位。
5. 再次启动：两步校验无待执行 → 日志出现 `schema up to date at migration "…" (YYMMDD), skipping AutoMigrate` → **跳过 AutoMigrate 与迁移**（无 DDL，快速启动）。

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

## Schema 迁移：名称戳（YYMMDD）两步校验

数据库迁移身份 = **迁移名（自带日期前缀，如 `260907-subscription-period-ledger`）**，取代此前的整数版本号。动机：fork 与上游 / 并行分支各自开发会撞整数版本号（两条线都加 v18、内容不同 → 库误判"已最新"跳过 AutoMigrate → 缺列崩溃）。名称戳 + 日期前缀让每条迁移身份天然唯一、可按时间排序，跨分支 merge 无需让号。

**机制**：
- `schema_migrations` 以 `name` 为主键（形如 `<YYMMDD>-<slug>`，日期 = 迁移引入日）。存量旧库启动时自动把整数 version 表一次性重建为 name 主键（旧行按 slug 后缀映射到带日期的名字，改名残留行丢弃）。
- `model.migrations` 每条 `Migration{Name, Up}`，日期从前到后。
- 启动**两步校验**决定待执行迁移：
  1. **先按时间**：只取日期 ≥ 当前已执行最大日期的迁移（只看本 build 的名字；外线高戳不污染）；
  2. **再按名称**：已执行（name 已在 `schema_migrations`）跳过、未执行的执行。
  同日第二条（日期 == 当前最大）经 ① ≥ 通过、② 按名补跑，天然能补上。
- **无待执行** → 日志 `schema up to date at migration "…" (YYMMDD), skipping AutoMigrate` → 跳过 AutoMigrate（SQLite 不再整表重建，启动快）。
- **有待执行**（新装 / 旧库升级 / 检测到外线同号不同内容）→ `AutoMigrate` 补结构 → 依次执行并逐条打名称戳 → 日志 `database migrated; head migration "…" (YYMMDD) applied`。
- **DEBUG=true** → 即使已最新也强制 `AutoMigrate` 校验结构（开发期兜底，生产不启用）。
- 多实例：仅主节点执行迁移（`IsMasterNode`），无并发冲突。

**未来开发流程（改 model 时）**：
1. 修改 `model/` 下的结构体。
2. 在 `model/schema_migration.go` 的 `migrations` 末尾新增 `Migration{Name: "<YYMMDD>-<slug>", Up: ...}`，日期取 ≥ 当前最新（当天即可，同日允许多条）。
3. 结构纯加列/建表的靠 AutoMigrate（升日期路径）或幂等 `ensure*`（已最新库的跳过路径）补齐，多数条目 `Up` 为空占位、只打名称戳；需数据转换/特殊适配的写进 `Up`（用传入的 `db` 执行，自行保证幂等）。
4. **已发布迁移的 Name 不可改名/复用**（否则已打戳库永远见不到 head，破坏性 `Up` 可能重跑）。"改 model 忘加迁移"时 head 名不变仍会走 skip——靠本地 `DEBUG=true` 与每列的幂等 `ensure*` 兜底。
5. 迁移名须以 6 位日期开头、全局唯一、日期非递减，违反时启动 `panic`（`validateMigrations` 兜底）。

**历史痛点已解决**：
- **SQLite 每次启动整表重建**（glebarez 驱动对 `unique;index` 列判断不一致导致）：已最新库跳过 AutoMigrate，不再重建。实测同一 SQLite 库连启两次，第二次 0 条 DDL。
- **同号不同内容误判**：迁移身份从整数版本改为名称戳后，两条线在同一版本号加不同内容不再冲突；库被另一分支迁移过也能自动补列收敛，而非静默跳过。

**历史迁移（整数版 vN 时代，仅作记录；现为带日期的名称戳条目）**：
- **v1 基线**：吸收 AutoMigrate 之外的专项迁移（订阅价格迁移、token `model_limits`→text、认证版本、额度池收敛等），首次升级跑一次。
- **v2 订阅功能重设计（破坏性清空）**：升级清空 `subscription_plans`、`user_subscriptions`、`subscription_orders`、`subscription_pre_consume_records` 四张表（结构由 AutoMigrate 升级）。启动日志含 `[WARN] 订阅功能重设计迁移已执行...`，之后由名称戳防重复。升级后需重新配置套餐，并为受影响用户重新分配等额新套餐（有意的产品决策，不做旧数据兼容）。
- **v16 移除 legacy 订阅配额模型**：动态窗口（`reset_windows`）成为唯一模型，删除 9 个 legacy 列，由幂等 `ensureDropLegacy*` 每次启动自动删（SQLite 先删索引再删列）。**无限额度改由动态窗口表达**：全部窗口 `limit=0` 即无限。
- **v18 订阅账本单期化**：`user_subscriptions.period_used` 取代 `amount_used`（单期语义，续费清零重开），删除恒 0 的 `amount_total`。
