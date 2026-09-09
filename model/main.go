package model

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/clickhouse"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var commonGroupCol string
var commonKeyCol string
var commonTrueVal string
var commonFalseVal string

var logKeyCol string
var logGroupCol string

// jsonScanBytes 归一化 json 列的驱动返回值:不同驱动/协议模式下同一列可能
// 以 []byte 或 string 返回,静默丢弃 string 会导致字段被清零而不报错。
func jsonScanBytes(value any) []byte {
	switch v := value.(type) {
	case []byte:
		return v
	case string:
		return []byte(v)
	default:
		return nil
	}
}

func initCol() {
	// init common column names
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		commonGroupCol = `"group"`
		commonKeyCol = `"key"`
		commonTrueVal = "true"
		commonFalseVal = "false"
	} else {
		commonGroupCol = "`group`"
		commonKeyCol = "`key`"
		commonTrueVal = "1"
		commonFalseVal = "0"
	}
	switch common.LogDatabaseType() {
	case common.DatabaseTypePostgreSQL:
		logGroupCol = `"group"`
		logKeyCol = `"key"`
	default:
		logGroupCol = "`group`"
		logKeyCol = "`key`"
	}
}

var DB *gorm.DB

var LOG_DB *gorm.DB

func createRootAccountIfNeed() error {
	var user User
	//if user.Status != common.UserStatusEnabled {
	if err := DB.First(&user).Error; err != nil {
		common.SysLog("no user exists, create a root user for you: username is root, password is 123456")
		hashedPassword, err := common.Password2Hash("123456")
		if err != nil {
			return err
		}
		rootUser := User{
			Username:    "root",
			Password:    hashedPassword,
			Role:        common.RoleRootUser,
			Status:      common.UserStatusEnabled,
			DisplayName: "Root User",
			AccessToken: nil,
			Quota:       100000000,
		}
		DB.Create(&rootUser)
	}
	return nil
}

func CheckSetup() {
	setup := GetSetup()
	if setup == nil {
		// No setup record exists, check if we have a root user
		if RootUserExists() {
			common.SysLog("system is not initialized, but root user exists")
			// Create setup record
			newSetup := Setup{
				Version:       common.Version,
				InitializedAt: time.Now().Unix(),
			}
			err := DB.Create(&newSetup).Error
			if err != nil {
				common.SysLog("failed to create setup record: " + err.Error())
			}
			constant.Setup = true
		} else {
			common.SysLog("system is not initialized and no root user exists")
			constant.Setup = false
		}
	} else {
		// Setup record exists, system is initialized
		common.SysLog("system is already initialized at: " + time.Unix(setup.InitializedAt, 0).String())
		constant.Setup = true
	}
}

func isClickHouseDSN(dsn string) bool {
	return strings.HasPrefix(dsn, "clickhouse://") ||
		strings.HasPrefix(dsn, "tcp://") ||
		strings.HasPrefix(dsn, "http://") ||
		strings.HasPrefix(dsn, "https://")
}

func normalizeClickHouseDSN(dsn string) string {
	parsed, err := url.Parse(dsn)
	if err != nil || parsed.Scheme != "https" {
		return dsn
	}
	query := parsed.Query()
	if _, ok := query["secure"]; !ok {
		query.Set("secure", "true")
		parsed.RawQuery = query.Encode()
	}
	return parsed.String()
}

func chooseDB(envName string, isLog bool) (*gorm.DB, common.DatabaseType, error) {
	dsn := os.Getenv(envName)
	if dsn != "" {
		if isClickHouseDSN(dsn) {
			if !isLog {
				return nil, "", fmt.Errorf("%s does not support ClickHouse; use SQLite, MySQL, or PostgreSQL for the primary database and LOG_SQL_DSN for ClickHouse logs", envName)
			}
			common.SysLog("using ClickHouse as log database")
			db, err := gorm.Open(clickhouse.Open(normalizeClickHouseDSN(dsn)), newGormConfig(false))
			return db, common.DatabaseTypeClickHouse, err
		}
		if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
			// Use PostgreSQL
			common.SysLog("using PostgreSQL as database")
			// 同时关闭 pgx 隐式与 GORM 显式预处理语句:命名 prepared statement 与
			// 事务池代理(PgBouncer/Neon/Supabase)不兼容,会触发 FATAL 08P01/42P05。
			db, err := gorm.Open(postgresMigrationDialector{postgres.Dialector{Config: &postgres.Config{
				DSN:                  dsn,
				PreferSimpleProtocol: true,
			}}}, newGormConfig(false))
			return db, common.DatabaseTypePostgreSQL, err
		}
		if strings.HasPrefix(dsn, "local") {
			common.SysLog("SQL_DSN not set, using SQLite as database")
			db, err := gorm.Open(sqlite.Open(common.SQLitePath), newGormConfig(true))
			return db, common.DatabaseTypeSQLite, err
		}
		// Use MySQL
		common.SysLog("using MySQL as database")
		// check parseTime
		if !strings.Contains(dsn, "parseTime") {
			if strings.Contains(dsn, "?") {
				dsn += "&parseTime=true"
			} else {
				dsn += "?parseTime=true"
			}
		}
		db, err := gorm.Open(mysqlMigrationDialector{mysql.Dialector{Config: &mysql.Config{DSN: dsn}}}, newGormConfig(true))
		return db, common.DatabaseTypeMySQL, err
	}
	// Use SQLite
	common.SysLog("SQL_DSN not set, using SQLite as database")
	db, err := gorm.Open(sqlite.Open(common.SQLitePath), newGormConfig(true))
	return db, common.DatabaseTypeSQLite, err
}

func InitDB() (err error) {
	db, dbType, err := chooseDB("SQL_DSN", false)
	if err == nil {
		common.SetMainDatabaseType(dbType)
		if os.Getenv("LOG_SQL_DSN") == "" {
			common.SetLogDatabaseType(dbType)
		}
		initCol()
		if common.DebugEnabled {
			db = db.Debug()
		}
		DB = db
		// MySQL charset/collation startup check: ensure Chinese-capable charset
		if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
			if err := checkMySQLChineseSupport(DB); err != nil {
				panic(err)
			}
		}
		if err := ensureUserQuotaColumns(DB, common.MainDatabaseType()); err != nil {
			return err
		}
		sqlDB, err := DB.DB()
		if err != nil {
			return err
		}
		sqlDB.SetMaxIdleConns(common.GetEnvOrDefault("SQL_MAX_IDLE_CONNS", 100))
		sqlDB.SetMaxOpenConns(common.GetEnvOrDefault("SQL_MAX_OPEN_CONNS", 1000))
		sqlDB.SetConnMaxLifetime(time.Second * time.Duration(common.GetEnvOrDefault("SQL_MAX_LIFETIME", 60)))

		if !common.IsMasterNode {
			return nil
		}
		if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
			//_, _ = sqlDB.Exec("ALTER TABLE channels MODIFY model_mapping TEXT;") // TODO: delete this line when most users have upgraded
		}
		common.SysLog("database migration started")
		err = migrateDB()
		return err
	} else {
		common.FatalLog(err)
	}
	return err
}

func InitLogDB() (err error) {
	if os.Getenv("LOG_SQL_DSN") == "" {
		LOG_DB = DB
		common.SetLogDatabaseType(common.MainDatabaseType())
		initCol()
		if common.IsMasterNode {
			return MigrateAuditLogs()
		}
		return
	}
	db, dbType, err := chooseDB("LOG_SQL_DSN", true)
	if err == nil {
		common.SetLogDatabaseType(dbType)
		initCol()
		if common.DebugEnabled {
			db = db.Debug()
		}
		LOG_DB = db
		// If log DB is MySQL, also ensure Chinese-capable charset
		if common.UsingLogDatabase(common.DatabaseTypeMySQL) {
			if err := checkMySQLChineseSupport(LOG_DB); err != nil {
				panic(err)
			}
		}
		sqlDB, err := LOG_DB.DB()
		if err != nil {
			return err
		}
		sqlDB.SetMaxIdleConns(common.GetEnvOrDefault("SQL_MAX_IDLE_CONNS", 100))
		sqlDB.SetMaxOpenConns(common.GetEnvOrDefault("SQL_MAX_OPEN_CONNS", 1000))
		sqlDB.SetConnMaxLifetime(time.Second * time.Duration(common.GetEnvOrDefault("SQL_MAX_LIFETIME", 60)))

		if !common.IsMasterNode {
			return nil
		}
		common.SysLog("database migration started")
		err = migrateLOGDB()
		return err
	} else {
		common.FatalLog(err)
	}
	return err
}

var userQuotaColumns = []string{"quota", "used_quota", "aff_quota", "aff_history"}

// ensureUserQuotaColumns rejects a legacy 32-bit wallet schema before any
// migrations run. The 64-bit-only build intentionally does not auto-upgrade
// an existing wallet; operators must migrate it explicitly before starting.
func ensureUserQuotaColumns(db *gorm.DB, dbType common.DatabaseType) error {
	if common.GetEnvOrDefaultBool("SKIP_64BIT_QUOTA_SCHEMA_CHECK", false) {
		common.SysLog("SKIP_64BIT_QUOTA_SCHEMA_CHECK=true; skipping user quota schema check")
		return nil
	}
	if db == nil || dbType == common.DatabaseTypeSQLite {
		return nil
	}
	if !db.Migrator().HasTable(&User{}) {
		return nil
	}
	columnTypes, err := db.Migrator().ColumnTypes(&User{})
	if err != nil {
		return fmt.Errorf("failed to inspect users schema: %w", err)
	}
	for _, expected := range userQuotaColumns {
		for _, actual := range columnTypes {
			if !strings.EqualFold(actual.Name(), expected) {
				continue
			}
			dataType := actual.DatabaseTypeName()
			if !is64BitIntegerType(dbType, dataType) {
				return fmt.Errorf("users.%s uses %s; 32-bit is not supported", expected, dataType)
			}
		}
	}
	return nil
}

func is64BitIntegerType(dbType common.DatabaseType, dataType string) bool {
	normalized := strings.ToLower(strings.TrimSpace(dataType))
	switch dbType {
	case common.DatabaseTypeMySQL:
		return normalized == "bigint" || normalized == "unsigned bigint" || normalized == "bigint unsigned"
	case common.DatabaseTypePostgreSQL:
		return normalized == "bigint" || normalized == "int8"
	default:
		return false
	}
}

func migrateDB() error {
	// 上游新增：旧库遗留的 PostgreSQL 唯一约束 / options 主键修复。三者都幂等，
	// 且必须在 AutoMigrate 之前执行（AutoMigrate 会按当前 model 检查列与索引现状），
	// 故放在最前面，跳过路径与完整路径都会跑。
	if err := migrateTokenKeyUniqueness(DB); err != nil {
		return err
	}
	if err := migratePrefillGroupUniqueness(DB); err != nil {
		return err
	}
	if err := migrateOptionPrimaryKey(DB); err != nil {
		common.SysError("failed to migrate options primary key: " + err.Error())
	}
	// 迁移身份 = 名称（YYMMDD-slug），启动按两步校验决定跑哪些：
	// ① 先按时间：只执行日期 >= 当前已执行最大日期的迁移；
	// ② 再按名称：已执行（name 已在 schema_migrations）的跳过、未执行的执行。
	// 无待执行即"已最新"，跳过 AutoMigrate，避免 SQLite 每次启动整表重建。
	if err := validateMigrations(migrations); err != nil {
		panic("invalid schema migration list: " + err.Error())
	}
	if err := ensureSchemaMigrationsTable(DB); err != nil {
		return err
	}
	// SQLite 的 subscription_plans 走手工 DDL（AutoMigrate 不管理它），且列补齐是
	// 幂等的：每次启动都必须执行，不能放在会被 skip 跳过的 autoMigrateAll 里——
	// 否则已到最新版本的库永远不会补上新增列（如 priority）。
	if err := ensureSubscriptionPlanTableSQLite(); err != nil {
		return err
	}
	// 用户配额全局锁行:幂等,每次启动执行,保证新装与已迁移库都有该行
	if err := ensureUserCountLockSeeded(DB); err != nil {
		return err
	}
	// channels.coding_plan_provider / coding_plan_key 列:幂等加列,已最新版本库也补上。
	if err := ensureChannelCodingPlanQuotaColumns(DB); err != nil {
		return err
	}
	// channels.coding_plan_auto_control / *_threshold 列:幂等加列,理由同上面。
	if err := ensureChannelCodingPlanAutoControlColumns(DB); err != nil {
		return err
	}
	// channel_model_settings 表 + models.context_window 列:幂等,每次启动执行,
	// 新装(升版本路径走 AutoMigrate)与已最新版本库(跳过路径)都补齐。
	if err := ensureChannelModelSettingsTable(DB); err != nil {
		return err
	}
	if err := ensureModelsContextWindowColumn(DB); err != nil {
		return err
	}
	// 上游同步新增的 schema(task_plugins / login_encryption_keys 表、
	// users.access_token_created_at 列):已到最新迁移戳的库走"跳过 AutoMigrate"
	// 路径,必须在这里幂等补齐,否则升级库启动即报 no such table。
	if err := ensureUpstreamSyncSchema(DB); err != nil {
		return err
	}
	// accounts 表 + channels.account_id 列 + 存量 backfill:幂等,每次启动执行。
	if err := ensureAccountsTable(DB); err != nil {
		return err
	}
	if err := ensureChannelAccountIdColumn(DB); err != nil {
		return err
	}
	if err := ensureChannelAccountBackfill(DB); err != nil {
		return err
	}
	applied, err := readAppliedMigrationNames(DB)
	if err != nil {
		return err
	}
	head := migrations[len(migrations)-1]
	pending := pendingMigrationList(migrations, applied)
	if len(pending) == 0 && !common.DebugEnabled {
		// 已最新：表已存在，仍需补幂等 DDL（LONGTEXT 升级），否则经中间版本
		// 发布的库升级后永远补不上，&gt;64KB 消息会在 MySQL 写入失败。
		if err := ensurePlaygroundConversationMessagesLongText(DB); err != nil {
			return err
		}
		if err := ensurePlaygroundConversationMessagesBytes(DB); err != nil {
			return err
		}
		if err := ensureConversationRecordLongText(DB); err != nil {
			return err
		}
		if err := ensureConversationRecordSizeBytes(DB); err != nil {
			return err
		}
		if err := ensureUserCreditScoreIndex(DB); err != nil {
			return err
		}
		if err := ensureCreditMarkerAnalyzedLogTable(DB); err != nil {
			return err
		}
		if err := ensureRedemptionUsesTable(DB); err != nil {
			return err
		}
		if err := ensureUserActivatedColumn(DB); err != nil {
			return err
		}
		if err := ensureCreditMarkerAnalysisLogRetried(DB); err != nil {
			return err
		}
		if err := ensureCreditMarkerSuggestionLogIds(DB); err != nil {
			return err
		}
		if err := ensureCreditMarkerAnalysisLogPromptUsed(DB); err != nil {
			return err
		}
		if err := ensureCreditScoreLogReverted(DB); err != nil {
			return err
		}
		if err := ensureSubscriptionPlanResetWindows(DB); err != nil {
			return err
		}
		if err := ensureUserSubscriptionWindowState(DB); err != nil {
			return err
		}
		if err := ensureUserSubscriptionPeriodUsedColumn(DB); err != nil {
			return err
		}
		if err := ensureUserSubscriptionRenewTermsColumn(DB); err != nil {
			return err
		}
		if err := ensureGroupPinTables(DB); err != nil {
			return err
		}
		if err := ensureSubscriptionOrderPinColumns(DB); err != nil {
			return err
		}
		if err := ensureDropLegacySubscriptionPlanColumns(DB); err != nil {
			return err
		}
		if err := ensureDropLegacyUserSubscriptionColumns(DB); err != nil {
			return err
		}
		if err := ensureDropLegacySubscriptionLedgerColumns(DB); err != nil {
			return err
		}
		if err := ensureDropLegacyBackupTables(DB); err != nil {
			return err
		}
		common.SysLog(fmt.Sprintf("schema up to date at migration %q (%d), skipping AutoMigrate", head.Name, migrationDate(head.Name)))
		return nil
	}
	if err := autoMigrateAll(); err != nil {
		return err
	}
	// MySQL 的 TEXT 列上限 64KB，装不下对话消息（消息体上限 2MB）；SQLite/PostgreSQL
	// 的 text 无此限制。把 messages 列升级为 LONGTEXT（幂等，AutoMigrate 不会改已存在
	// 列类型）。表由上方 autoMigrateAll 刚建或已存在。
	if err := ensurePlaygroundConversationMessagesLongText(DB); err != nil {
		return err
	}
	if err := ensurePlaygroundConversationMessagesBytes(DB); err != nil {
		return err
	}
	if err := ensureConversationRecordLongText(DB); err != nil {
		return err
	}
	if err := ensureConversationRecordSizeBytes(DB); err != nil {
		return err
	}
	if err := ensureUserCreditScoreIndex(DB); err != nil {
		return err
	}
	if err := ensureCreditMarkerAnalysisLogRetried(DB); err != nil {
		return err
	}
	if err := ensureCreditMarkerSuggestionLogIds(DB); err != nil {
		return err
	}
	if err := ensureCreditMarkerAnalysisLogPromptUsed(DB); err != nil {
		return err
	}
	if err := ensureCreditScoreLogReverted(DB); err != nil {
		return err
	}
	if err := ensureUserActivatedColumn(DB); err != nil {
		return err
	}
	if err := ensureSubscriptionPlanResetWindows(DB); err != nil {
		return err
	}
	if err := ensureUserSubscriptionWindowState(DB); err != nil {
		return err
	}
	if err := ensureUserSubscriptionPeriodUsedColumn(DB); err != nil {
		return err
	}
	if err := ensureUserSubscriptionRenewTermsColumn(DB); err != nil {
		return err
	}
	if err := ensureGroupPinTables(DB); err != nil {
		return err
	}
	if err := ensureSubscriptionOrderPinColumns(DB); err != nil {
		return err
	}
	if err := ensureDropLegacySubscriptionPlanColumns(DB); err != nil {
		return err
	}
	if err := ensureDropLegacyUserSubscriptionColumns(DB); err != nil {
		return err
	}
	if err := ensureDropLegacySubscriptionLedgerColumns(DB); err != nil {
		return err
	}
	if err := ensureDropLegacyBackupTables(DB); err != nil {
		return err
	}
	if err := runMigrations(DB, pending); err != nil {
		return err
	}
	common.SysLog(fmt.Sprintf("database migrated; head migration %q (%d) applied", head.Name, migrationDate(head.Name)))
	return nil
}

// autoMigrateAll 把全部业务模型 AutoMigrate 到当前 model 定义，并处理
// SubscriptionPlan 的 SQLite 手工 DDL 分支。
func autoMigrateAll() error {
	err := DB.AutoMigrate(
		&Channel{},
		&Account{},
		&Token{},
		&User{},
		&ChannelModelSetting{},
		&UserSession{},
		&AuthFlow{},
		&ExternalIdentityClaim{},
		&PasskeyCredential{},
		&Option{},
		&LoginEncryptionKey{},
		&Redemption{},
		&RedemptionUse{},
		&Ability{},
		&Log{},
		&Midjourney{},
		&TopUp{},
		&QuotaData{},
		&Task{},
		&TaskPlugin{},
		&Model{},
		&Vendor{},
		&PrefillGroup{},
		&ImageAsset{},
		&PlaygroundImage{},
		&PlaygroundConversation{},
		&PlaygroundSpaceOrder{},
		&Setup{},
		&TwoFA{},
		&TwoFABackupCode{},
		&QuotaClaimRecord{},
		&QuotaClaimLock{},
		&UserCountLock{},
		&SubscriptionOrder{},
		&UserSubscription{},
		&SubscriptionPreConsumeRecord{},
		&GroupPinProduct{},
		&GroupPin{},
		&CustomOAuthProvider{},
		&UserOAuthBinding{},
		&PerfMetric{},
		&SystemInstance{},
		&SystemTask{},
		&SystemTaskLock{},
		&ChannelTestRecord{},
		&CasbinRule{},
		&AuthzRole{},
		&CreditScoreLog{},
		&ConversationRecord{},
		&CreditMarkerSuggestion{},
		&CreditMarkerAnalysisLog{},
		&CreditMarkerAnalyzedLog{},
	)
	if err != nil {
		return err
	}
	// 注意：subscription_plans 的 SQLite 手工 DDL 在 migrateDB 每次启动时执行
	// （见 migrateDB），此处不再重复。非 SQLite 走 AutoMigrate 管理该表。
	if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		if err := DB.AutoMigrate(&SubscriptionPlan{}); err != nil {
			return err
		}
	}
	return nil
}

// ensurePlaygroundConversationMessagesLongText 把 playground_conversations.messages
// 列升级为 LONGTEXT（幂等，MySQL 专属；SQLite/PostgreSQL 的 text 无 64KB 上限，跳过）。
// MySQL TEXT 上限 64KB，装不下消息体上限 2MB。AutoMigrate 不会改已存在列类型，必须
// 显式 ALTER。表由 autoMigrateAll 或历史迁移保证存在，故只能在表建好后调用。
func ensurePlaygroundConversationMessagesLongText(db *gorm.DB) error {
	if !common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return nil
	}
	return db.Exec("ALTER TABLE playground_conversations MODIFY COLUMN messages LONGTEXT").Error
}

// ensurePlaygroundConversationMessagesBytes 幂等补 playground_conversations.messages_bytes
// 列（对话占用云空间容量核算用）并回填存量行。AutoMigrate 只在 schema 版本变化时执行，
// 存量库（已最新版本）走"跳过迁移"路径，需在这里显式补列；回填按批次处理，幂等可重跑。
// 注意：WHERE 必须排除 messages 为空的行——空消息的字节数本来就该是 0，若包含它们，
// 更新后仍匹配条件会被反复选中，回填循环永不终止（服务卡死在启动）。
func ensurePlaygroundConversationMessagesBytes(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&PlaygroundConversation{}, "messages_bytes") {
		if err := db.Migrator().AddColumn(&PlaygroundConversation{}, "messages_bytes"); err != nil {
			return err
		}
	}
	for {
		var rows []PlaygroundConversation
		if err := db.Where("(messages_bytes IS NULL OR messages_bytes = 0) AND messages != ''").
			Limit(1000).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		for _, r := range rows {
			if err := db.Model(&PlaygroundConversation{}).Where("id = ?", r.Id).
				Update("messages_bytes", len(r.Messages)).Error; err != nil {
				return err
			}
		}
	}
}

// conversationColumnIsLongText 检查 conversation_records 某列是否已是 LONGTEXT。
// MySQL 的 ALTER TABLE ... MODIFY 即使类型不变也会整表 COPY 重建，表按设计会涨到
// GB 级，每次启动盲目执行代价很高，故先探测列类型、已是 LONGTEXT 则跳过。
func conversationColumnIsLongText(db *gorm.DB, column string) bool {
	types, err := db.Migrator().ColumnTypes(&ConversationRecord{})
	if err != nil {
		return false
	}
	for _, t := range types {
		if t.Name() == column {
			return strings.EqualFold(t.DatabaseTypeName(), "longtext")
		}
	}
	return false
}

// ensureConversationRecordLongText 把 conversation_records.request/response 列升级为
// LONGTEXT（幂等，MySQL 专属；SQLite/PostgreSQL 的 text 无 64KB 上限，跳过）。
// MySQL TEXT 上限 64KB，装不下响应体（SSE 流截断上限 64KB+）。照
// ensurePlaygroundConversationMessagesLongText 的模式。
func ensureConversationRecordLongText(db *gorm.DB) error {
	if !common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return nil
	}
	if conversationColumnIsLongText(db, "request") && conversationColumnIsLongText(db, "response") {
		return nil
	}
	if err := db.Exec("ALTER TABLE conversation_records MODIFY COLUMN request LONGTEXT").Error; err != nil {
		return err
	}
	return db.Exec("ALTER TABLE conversation_records MODIFY COLUMN response LONGTEXT").Error
}

// ensureUserCreditScoreIndex 幂等补 users.credit_score 索引。低分用户列表、风控
// 概览计数、被动恢复的关联查询都按 credit_score 过滤；AutoMigrate 只在新装/升版本时
// 建索引，存量已最新库走 skip 路径不会重跑，需显式补。
func ensureUserCreditScoreIndex(db *gorm.DB) error {
	if db.Migrator().HasIndex(&User{}, "idx_credit_score") {
		return nil
	}
	return db.Migrator().CreateIndex(&User{}, "idx_credit_score")
}

// ensureCreditMarkerAnalyzedLogTable 幂等建 credit_marker_analyzed_logs 表。该表在
// autoMigrateAll 的 AutoMigrate 列表里，但 AutoMigrate 只在 schema 版本变化时执行；存量库
// （已是最新版本）走"跳过迁移"路径不会重跑 AutoMigrate，需在这里显式建表。
func ensureCreditMarkerAnalyzedLogTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&CreditMarkerAnalyzedLog{}) {
		return nil
	}
	return db.Migrator().CreateTable(&CreditMarkerAnalyzedLog{})
}

// ensureRedemptionUsesTable 幂等建 redemption_uses 关联表（每用户每码一次的去重
// 记录）。AutoMigrate 只在 schema 版本变化时执行；已最新版本库走"跳过迁移"路径
// 不会重跑，需在这里显式建表，否则 used_count 去重逻辑引用该表会报表不存在。
func ensureRedemptionUsesTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&RedemptionUse{}) {
		return nil
	}
	return db.Migrator().CreateTable(&RedemptionUse{})
}

// ensureUserActivatedColumn 幂等补 users.activated 列（激活制：1=正式 / 0=待激活）
// 并把存量行归一为已激活。AutoMigrate 只在 schema 版本变化时执行；已最新版本库走
// "跳过迁移"路径不会重跑，需在这里显式补列，否则激活检查引用该列会报表不存在。
func ensureUserActivatedColumn(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&User{}, "activated") {
		if err := db.Migrator().AddColumn(&User{}, "activated"); err != nil {
			return err
		}
	}
	return db.Model(&User{}).Where("activated IS NULL").Update("activated", 1).Error
}

// ensureCreditMarkerAnalysisLogRetried 幂等补 credit_marker_analysis_logs.retried 列
// （分析遇 429/5xx 自动重试次数审计）。AutoMigrate 只在 schema 版本变化时执行；已最新版本
// 库走"跳过迁移"路径不会重跑，需在这里显式补列。
func ensureCreditMarkerAnalysisLogRetried(db *gorm.DB) error {
	if db.Migrator().HasColumn(&CreditMarkerAnalysisLog{}, "retried") {
		return nil
	}
	return db.Migrator().AddColumn(&CreditMarkerAnalysisLog{}, "retried")
}

// ensureCreditMarkerSuggestionLogIds 幂等补 credit_marker_suggestions.log_ids 列（AI 建议
// 关联的来源错误日志 id）。理由同 ensureCreditMarkerAnalysisLogRetried。
func ensureCreditMarkerSuggestionLogIds(db *gorm.DB) error {
	if db.Migrator().HasColumn(&CreditMarkerSuggestion{}, "log_ids") {
		return nil
	}
	return db.Migrator().AddColumn(&CreditMarkerSuggestion{}, "log_ids")
}

// ensureCreditMarkerAnalysisLogPromptUsed 幂等补 credit_marker_analysis_logs.prompt_used 列
// （本次分析用的默认/自定义提示词标识）。理由同 ensureCreditMarkerAnalysisLogRetried。
func ensureCreditMarkerAnalysisLogPromptUsed(db *gorm.DB) error {
	if db.Migrator().HasColumn(&CreditMarkerAnalysisLog{}, "prompt_used") {
		return nil
	}
	return db.Migrator().AddColumn(&CreditMarkerAnalysisLog{}, "prompt_used")
}

// ensureCreditScoreLogReverted 幂等补 credit_score_logs.reverted_at 列（管理端打回误判扣分
// 的标记）。理由同 ensureCreditMarkerAnalysisLogRetried：存量库（已是最新版本）走"跳过迁移"
// 路径不会重跑 AutoMigrate，需显式补列，否则打回/扣分查询引用 reverted_at 会报列不存在。
// 补列后把存量 NULL 归零（AddColumn 无默认值），保证 reverted_at = 0 语义。
func ensureCreditScoreLogReverted(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&CreditScoreLog{}, "reverted_at") {
		if err := db.Migrator().AddColumn(&CreditScoreLog{}, "reverted_at"); err != nil {
			return err
		}
	}
	return db.Model(&CreditScoreLog{}).Where("reverted_at IS NULL").Update("reverted_at", 0).Error
}

// ensureConversationRecordSizeBytes 幂等补 conversation_records.size_bytes 列（总存量核算用）。
// 该列在 AutoMigrate 模型里新增，但 AutoMigrate 只在 schema 版本变化时执行；存量库（已是最新
// 版本）走"跳过迁移"路径不会重跑 AutoMigrate，需在这里显式补列。
func ensureConversationRecordSizeBytes(db *gorm.DB) error {
	if db.Migrator().HasColumn(&ConversationRecord{}, "size_bytes") {
		return nil
	}
	return db.Migrator().AddColumn(&ConversationRecord{}, "size_bytes")
}

// ensureSubscriptionPlanRecommendedBackfill 升级兼容：is_recommended 已从 model
// 移除 gorm default 标签（避免 MySQL/PG 每次启动对 boolean 默认值反复 ALTER）。
// MySQL/PG 升级时该新列由 AutoMigrate 加列且无 DB 默认值，存量行会是 NULL；
// 统一回填 0 保证语义一致。SQLite 手工 DDL 带 DEFAULT 0，无 NULL 行，此函数
// 幂等无副作用。
func ensureSubscriptionPlanRecommendedBackfill(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&SubscriptionPlan{}, "is_recommended") {
		return nil
	}
	return db.Model(&SubscriptionPlan{}).
		Where("is_recommended IS NULL").
		Update("is_recommended", 0).Error
}

// ensureSubscriptionPlanResetWindows 幂等补 subscription_plans.reset_windows 列（动态重置
// 窗口列表，JSON 文本）。SQLite 走手工 DDL（migrateDB 每次启动执行）；MySQL/PG 在升版本
// 路径由 AutoMigrate 加列；存量库（已最新版本）走"跳过迁移"路径，需在这里显式补列。
// 无默认值的列在存量行上是 NULL，统一归一空串（空 reset_windows = 无限额度）。
func ensureSubscriptionPlanResetWindows(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&SubscriptionPlan{}, "reset_windows") {
		if err := db.Migrator().AddColumn(&SubscriptionPlan{}, "reset_windows"); err != nil {
			return err
		}
	}
	return db.Model(&SubscriptionPlan{}).
		Where("reset_windows IS NULL").
		Update("reset_windows", "").Error
}

// ensureUserSubscriptionWindowState 幂等补 user_subscriptions.window_state 列（动态窗口
// 消费状态，JSON 文本）。列由 AutoMigrate（升版本路径）或此处（已最新版本库的跳过路径）
// 添加；存量订阅无窗口状态，统一归一空串（状态缺失由 advance 按满额补齐）。
func ensureUserSubscriptionWindowState(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&UserSubscription{}, "window_state") {
		if err := db.Migrator().AddColumn(&UserSubscription{}, "window_state"); err != nil {
			return err
		}
	}
	return db.Model(&UserSubscription{}).
		Where("window_state IS NULL").
		Update("window_state", "").Error
}

// ensureUserSubscriptionPeriodUsedColumn 幂等补 user_subscriptions.period_used 列（单期账本，
// 当前预付期累计消耗）。列带 NOT NULL DEFAULT 0（model tag），存量行 ALTER 时已回填 0。
// AutoMigrate 只在日期戳变化时执行；已最新库走 skip 路径不重跑，需显式补列，否则查询
// period_used 报表列不存在。
func ensureUserSubscriptionPeriodUsedColumn(db *gorm.DB) error {
	if db.Migrator().HasColumn(&UserSubscription{}, "period_used") {
		return nil
	}
	return db.Migrator().AddColumn(&UserSubscription{}, "period_used")
}

// ensureUserSubscriptionRenewTermsColumn 幂等补 user_subscriptions.renew_terms 列（续费条款
// 快照，JSON 文本）。理由同 ensureUserSubscriptionPeriodUsedColumn：skip 路径的已最新库需
// 显式补列。补列后把存量 NULL 归一空串（无快照 = 续费/估值回退套餐当前条款）。
func ensureUserSubscriptionRenewTermsColumn(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&UserSubscription{}, "renew_terms") {
		if err := db.Migrator().AddColumn(&UserSubscription{}, "renew_terms"); err != nil {
			return err
		}
	}
	return db.Model(&UserSubscription{}).
		Where("renew_terms IS NULL").
		Update("renew_terms", "").Error
}

// ensureQuotaClaimLockSeeded 确保额度池全局锁行存在（id=1），供 MySQL/PG 并发领取串行化
func ensureQuotaClaimLockSeeded(db *gorm.DB) error {
	var count int64
	if err := db.Model(&QuotaClaimLock{}).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return db.Create(&QuotaClaimLock{Id: 1}).Error
	}
	return nil
}

// ensureQuotaClaimRecordsClean 处理从旧版升级的 quota_claim_records 表。
// 旧版含 pool_id (NOT NULL) / period_key 列；收敛后 struct 已删除这两列，但
// AutoMigrate 只加列不删列，残留的 pool_id 会让新的 insert 触发
// NOT NULL constraint failed（SQLite 扩展错误码 1299）。检测到旧列时删除，
// 保证存量库升级后领取/打卡不报错。
func ensureQuotaClaimRecordsClean(db *gorm.DB) error {
	hasLegacy, err := quotaClaimRecordsHasLegacyPoolId(db)
	if err != nil {
		return err
	}
	if !hasLegacy {
		return nil
	}
	return dropLegacyQuotaClaimColumns(db)
}

// quotaClaimRecordsHasLegacyPoolId 检测 quota_claim_records 表是否仍含旧版 pool_id 列。
func quotaClaimRecordsHasLegacyPoolId(db *gorm.DB) (bool, error) {
	var count int64
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		err := db.Raw(
			"SELECT COUNT(*) FROM pragma_table_info('quota_claim_records') WHERE name = 'pool_id'",
		).Scan(&count).Error
		return count > 0, err
	}
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		err := db.Raw(
			"SELECT COUNT(*) FROM information_schema.COLUMNS WHERE table_schema = current_schema() AND table_name = 'quota_claim_records' AND column_name = 'pool_id'",
		).Scan(&count).Error
		return count > 0, err
	}
	err := db.Raw(
		"SELECT COUNT(*) FROM information_schema.COLUMNS WHERE table_schema = DATABASE() AND table_name = 'quota_claim_records' AND column_name = 'pool_id'",
	).Scan(&count).Error
	return count > 0, err
}

// dropLegacyQuotaClaimColumns 删除旧版残留的 pool_id / period_key 列。
// SQLite 的 DROP COLUMN 不允许列仍被索引引用，需先删对应索引。
func dropLegacyQuotaClaimColumns(db *gorm.DB) error {
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		if err := db.Exec("DROP INDEX IF EXISTS idx_quota_claim_records_pool_id").Error; err != nil {
			return err
		}
		if err := db.Exec("DROP INDEX IF EXISTS idx_quota_claim_records_period_key").Error; err != nil {
			return err
		}
		if err := db.Exec("ALTER TABLE quota_claim_records DROP COLUMN pool_id").Error; err != nil {
			return err
		}
		return db.Exec("ALTER TABLE quota_claim_records DROP COLUMN period_key").Error
	}
	return db.Exec("ALTER TABLE quota_claim_records DROP COLUMN pool_id, DROP COLUMN period_key").Error
}

// legacySubscriptionPlanColumns / legacyUserSubscriptionColumns 是随 legacy 订阅配额模型
// 移除而要删除的列（legacy 从早期版本就存在，删列逻辑版本无关：每次启动检测自检）。
var legacySubscriptionPlanColumns = []string{
	"total_amount", "quota_reset_period", "quota_reset_custom_seconds",
	"reset_amount_limit", "weekly_amount_limit", "monthly_amount_limit",
	// 随第三方支付渠道（Stripe/Creem/Waffo Pancake）一起移除的商品 ID 列。
	"stripe_price_id", "creem_product_id", "waffo_pancake_product_id",
}

var legacyUserSubscriptionColumns = []string{
	"cycle_start_at", "cycle_used", "next_cycle_reset_at",
	// 早期重置窗口模型遗留的时间列（现由 period_used/动态窗口取代）。
	"last_reset_time", "next_reset_time",
}

// legacySubscriptionLedgerColumns 是单期账本改造（period_used）移除的累计展示列：
// amount_total 在动态窗口模型下恒为 0；amount_used 曾是跨期累计展示，单期语义由
// period_used 取代（迁移清零起步，不搬历史值）。
var legacySubscriptionLedgerColumns = []string{
	"amount_total", "amount_used",
}

// existingColumnsOf 返回 table 中实际存在的目标列（跨 SQLite/MySQL/PostgreSQL）。
// table 与列名来自上方固定清单（非用户输入），直接拼接 SQL 与 dropLegacyQuotaClaimColumns 一致。
func existingColumnsOf(db *gorm.DB, table string, columns []string) ([]string, error) {
	var present []string
	for _, col := range columns {
		var count int64
		var err error
		switch {
		case common.UsingMainDatabase(common.DatabaseTypeSQLite):
			err = db.Raw("SELECT COUNT(*) FROM pragma_table_info('" + table + "') WHERE name = '" + col + "'").Scan(&count).Error
		case common.UsingMainDatabase(common.DatabaseTypePostgreSQL):
			err = db.Raw("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE table_schema = current_schema() AND table_name = '" + table + "' AND column_name = '" + col + "'").Scan(&count).Error
		default:
			err = db.Raw("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE table_schema = DATABASE() AND table_name = '" + table + "' AND column_name = '" + col + "'").Scan(&count).Error
		}
		if err != nil {
			return nil, err
		}
		if count > 0 {
			present = append(present, col)
		}
	}
	return present, nil
}

// sqliteIndexesOnColumns 返回 SQLite 表上引用了给定列的索引名。SQLite 的 DROP COLUMN
// 不允许列仍被索引引用，必须先删索引；索引清单用 pragma 动态查而不是手工维护——漏一个
// 就是启动期 FATAL（2026-09-10 踩过：legacy 列 next_reset_time 上的旧索引没删，
// 开发库 SQLite 直接起不来，MySQL 因为会随列自动删索引所以演练时没暴露）。
func sqliteIndexesOnColumns(db *gorm.DB, table string, columns []string) ([]string, error) {
	if len(columns) == 0 {
		return nil, nil
	}
	var indexes []string
	err := db.Raw(
		"SELECT DISTINCT il.name FROM pragma_index_list(?) AS il, pragma_index_info(il.name) AS ii WHERE ii.name IN (?)",
		table, columns,
	).Scan(&indexes).Error
	return indexes, err
}

// dropLegacySubscriptionColumns 幂等删除指定表上的 legacy 列。SQLite 逐列 DROP，且先删
// 掉引用这些列的索引（SQLite 不允许 DROP COLUMN 时列仍被索引引用）；MySQL/PostgreSQL
// 一条 ALTER 多列，索引随列自动消失。
func dropLegacySubscriptionColumns(db *gorm.DB, table string, columns []string) error {
	present, err := existingColumnsOf(db, table, columns)
	if err != nil {
		return err
	}
	if len(present) == 0 {
		return nil
	}
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		indexes, err := sqliteIndexesOnColumns(db, table, present)
		if err != nil {
			return err
		}
		for _, idx := range indexes {
			if err := db.Exec("DROP INDEX IF EXISTS " + idx).Error; err != nil {
				return err
			}
		}
		for _, col := range present {
			if err := db.Exec("ALTER TABLE " + table + " DROP COLUMN " + col).Error; err != nil {
				return err
			}
		}
		return nil
	}
	drops := make([]string, 0, len(present))
	for _, col := range present {
		drops = append(drops, "DROP COLUMN "+col)
	}
	return db.Exec("ALTER TABLE " + table + " " + strings.Join(drops, ", ")).Error
}

// ensureDropLegacySubscriptionPlanColumns 删除 subscription_plans 上随 legacy 模型移除的
// 列（total_amount / quota_reset_* / reset_amount_limit / weekly / monthly /
// stripe_price_id / creem_product_id / waffo_pancake_product_id）。
func ensureDropLegacySubscriptionPlanColumns(db *gorm.DB) error {
	return dropLegacySubscriptionColumns(db, "subscription_plans", legacySubscriptionPlanColumns)
}

// ensureDropLegacyUserSubscriptionColumns 删除 user_subscriptions 上随 legacy 模型移除的
// 列（cycle_start_at / cycle_used / next_cycle_reset_at / last_reset_time / next_reset_time）。
// 这些列上可能留有旧版 GORM 建的索引，dropLegacySubscriptionColumns 会在 SQLite 上先删索引。
func ensureDropLegacyUserSubscriptionColumns(db *gorm.DB) error {
	return dropLegacySubscriptionColumns(db, "user_subscriptions", legacyUserSubscriptionColumns)
}

// ensureDropLegacySubscriptionLedgerColumns 删除 user_subscriptions 上单期账本改造
// 移除的累计展示列（amount_total / amount_used，被 period_used 取代）。
func ensureDropLegacySubscriptionLedgerColumns(db *gorm.DB) error {
	return dropLegacySubscriptionColumns(db, "user_subscriptions", legacySubscriptionLedgerColumns)
}

// legacyBackupTables 是历史迁移留下的一次性备份表（_bak_<table>_<date>）。源表
// （abilities / subscription_orders / subscription_plans）仍在并由 AutoMigrate
// 管理，备份已无用途；显式删除，保证升级库与全新建库的表结构一致。
var legacyBackupTables = []string{
	"_bak_abilities_sponsored_20260628",
	"_bak_subscription_orders_20260628",
	"_bak_subscription_plans_20260628",
}

func ensureDropLegacyBackupTables(db *gorm.DB) error {
	for _, table := range legacyBackupTables {
		if !db.Migrator().HasTable(table) {
			continue
		}
		if err := db.Migrator().DropTable(table); err != nil {
			return err
		}
		common.SysLog("dropped legacy backup table " + table)
	}
	return nil
}

func migrateLOGDB() error {
	if err := MigrateAuditLogs(); err != nil {
		return err
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		return migrateClickHouseLogDB()
	}
	return LOG_DB.AutoMigrate(&Log{})
}

func migrateClickHouseLogDB() error {
	ttlDays := clickHouseLogTTLDays()
	if err := LOG_DB.Exec(clickHouseLogCreateTableSQL(ttlDays)).Error; err != nil {
		return err
	}
	return syncClickHouseLogTTL(ttlDays)
}

func clickHouseLogTTLDays() int {
	ttlDays := common.GetEnvOrDefault("LOG_SQL_CLICKHOUSE_TTL_DAYS", 0)
	if ttlDays < 0 {
		return 0
	}
	return ttlDays
}

func clickHouseLogTTLExpression(ttlDays int) string {
	if ttlDays <= 0 {
		return ""
	}
	return fmt.Sprintf("toDateTime(created_at) + INTERVAL %d DAY DELETE", ttlDays)
}

func clickHouseLogTTLClause(ttlDays int) string {
	expression := clickHouseLogTTLExpression(ttlDays)
	if expression == "" {
		return ""
	}
	return "\nTTL " + expression
}

func clickHouseLogCreateTableSQL(ttlDays int) string {
	return fmt.Sprintf(`
CREATE TABLE IF NOT EXISTS logs (
	id Int64 DEFAULT 0,
	user_id Int32 DEFAULT 0,
	created_at Int64 DEFAULT 0,
	type Int32 DEFAULT 0,
	content String DEFAULT '',
	username String DEFAULT '',
	token_name String DEFAULT '',
	model_name String DEFAULT '',
	quota Int32 DEFAULT 0,
	prompt_tokens Int32 DEFAULT 0,
	completion_tokens Int32 DEFAULT 0,
	use_time Int32 DEFAULT 0,
	is_stream UInt8 DEFAULT 0,
	channel_id Int32 DEFAULT 0,
	token_id Int32 DEFAULT 0,
	`+"`group`"+` String DEFAULT '',
	ip String DEFAULT '',
	request_id String DEFAULT '',
	upstream_request_id String DEFAULT '',
	other String DEFAULT ''
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(toDateTime(created_at))
ORDER BY (created_at, request_id)%s`, clickHouseLogTTLClause(ttlDays))
}

func syncClickHouseLogTTL(ttlDays int) error {
	expression := clickHouseLogTTLExpression(ttlDays)
	if expression != "" {
		return LOG_DB.Exec("ALTER TABLE logs MODIFY TTL " + expression).Error
	}

	hasTTL, err := clickHouseLogTableHasTTL()
	if err != nil {
		return err
	}
	if !hasTTL {
		return nil
	}
	return LOG_DB.Exec("ALTER TABLE logs REMOVE TTL").Error
}

func clickHouseLogTableHasTTL() (bool, error) {
	var createTableSQL string
	if err := LOG_DB.Raw("SHOW CREATE TABLE logs").Scan(&createTableSQL).Error; err != nil {
		return false, err
	}
	return clickHouseCreateTableHasTTL(createTableSQL), nil
}

func clickHouseCreateTableHasTTL(createTableSQL string) bool {
	upperSQL := strings.ToUpper(createTableSQL)
	return strings.Contains(upperSQL, "\nTTL ") || strings.Contains(upperSQL, " TTL ")
}

type sqliteColumnDef struct {
	Name string
	DDL  string
}

// ensureChannelCodingPlanQuotaColumns 幂等加列:channels.coding_plan_provider /
// coding_plan_key 是已有表上的新列,已到最新 schema 版本(跳过 autoMigrateAll)的库
// 同样需要补上。HasTable/HasColumn 守卫 + AddColumn,SQLite/MySQL/PG 通用;
// 全新安装时 channels 表尚不存在,直接返回交给 autoMigrateAll 全量建。
func ensureChannelCodingPlanQuotaColumns(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Channel{}) {
		return nil
	}
	if !db.Migrator().HasColumn(&Channel{}, "coding_plan_provider") {
		if err := db.Migrator().AddColumn(&Channel{}, "coding_plan_provider"); err != nil {
			return err
		}
	}
	if !db.Migrator().HasColumn(&Channel{}, "coding_plan_key") {
		if err := db.Migrator().AddColumn(&Channel{}, "coding_plan_key"); err != nil {
			return err
		}
	}
	return nil
}

// ensureChannelCodingPlanAutoControlColumns 幂等加列:channels.coding_plan_auto_control /
// coding_plan_disable_threshold / coding_plan_enable_threshold。理由与
// ensureChannelCodingPlanQuotaColumns 相同:已有表上的新列,已最新版本库也要补。
// 无 gorm default 标签,存量行为 NULL,由 service 回退默认阈值(98/90)。
func ensureChannelCodingPlanAutoControlColumns(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Channel{}) {
		return nil
	}
	columns := []string{
		"coding_plan_auto_control",
		"coding_plan_disable_threshold",
		"coding_plan_enable_threshold",
	}
	for _, column := range columns {
		if !db.Migrator().HasColumn(&Channel{}, column) {
			if err := db.Migrator().AddColumn(&Channel{}, column); err != nil {
				return err
			}
		}
	}
	return nil
}

// ensureUpstreamSyncSchema 幂等补齐上游同步引入的 schema：task_plugins /
// login_encryption_keys 两张新表，以及 users.access_token_created_at 新列。
// 它们都在 autoMigrateAll 的模型列表里，但已到最新迁移戳的库会跳过 AutoMigrate，
// 因此这里显式补，保证升级库与全新建库的 schema 一致。
func ensureUpstreamSyncSchema(db *gorm.DB) error {
	if err := db.AutoMigrate(&LoginEncryptionKey{}, &TaskPlugin{}); err != nil {
		return err
	}
	if db.Migrator().HasTable(&User{}) && !db.Migrator().HasColumn(&User{}, "access_token_created_at") {
		if err := db.Migrator().AddColumn(&User{}, "access_token_created_at"); err != nil {
			return err
		}
	}
	return nil
}

// ensureChannelModelSettingsTable 幂等建 channel_model_settings 表（渠道内模型级禁用 +
// 渠道级 context_window 覆盖）。表在 autoMigrateAll 列表里，但 AutoMigrate 只在 schema
// 版本变化时执行；已最新版本库走"跳过迁移"路径不会重跑，需显式建表。
func ensureChannelModelSettingsTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&ChannelModelSetting{}) {
		return nil
	}
	return db.Migrator().CreateTable(&ChannelModelSetting{})
}

// ensureAccountsTable 幂等建 accounts 表（凭证与渠道解耦）。理由同
// ensureChannelModelSettingsTable：已最新版本库走跳过路径需显式补表。
func ensureAccountsTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&Account{}) {
		return nil
	}
	return db.Migrator().CreateTable(&Account{})
}

// ensureChannelAccountIdColumn 幂等补 channels.account_id 列。无默认值，
// 存量行为 NULL/0（未挂账户，legacy 降级路径），backfill 逐步回填。
func ensureChannelAccountIdColumn(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Channel{}) {
		return nil
	}
	if !db.Migrator().HasColumn(&Channel{}, "account_id") {
		if err := db.Migrator().AddColumn(&Channel{}, "account_id"); err != nil {
			return err
		}
	}
	return nil
}

// ensureChannelAccountBackfill 存量渠道账户化 backfill：对 account_id=0 的渠道，
// 每渠道生成一个私有账户（凭证字段一一搬运：key/base_url/代理/多key状态/编码套餐/
// 余额/组织），并回填 account_id。幂等（account_id>0 跳过）；分批事务执行，
// 单渠道失败记日志继续（下轮启动重试），失败计数汇总。
// 渠道 legacy 凭证列不清理（只读降级保留）；账户 AutoGenerated=true 标记系统生成
// （删除渠道后的孤儿清理只回收此类账户）。
func ensureChannelAccountBackfill(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Account{}) || !db.Migrator().HasColumn(&Channel{}, "account_id") {
		return nil
	}
	var channels []*Channel
	if err := db.Where("account_id IS NULL OR account_id = 0").
		Find(&channels).Error; err != nil {
		return err
	}
	if len(channels) == 0 {
		return nil
	}
	failed := 0
	for _, ch := range channels {
		err := db.Transaction(func(tx *gorm.DB) error {
			account := buildPrivateAccountFromChannel(ch)
			if err := tx.Create(account).Error; err != nil {
				return err
			}
			return tx.Model(&Channel{}).Where("id = ?", ch.Id).Update("account_id", account.Id).Error
		})
		if err != nil {
			failed++
			common.SysLog(fmt.Sprintf("channel account backfill failed: channel_id=%d, error=%v", ch.Id, err))
		}
	}
	if failed > 0 {
		common.SysLog(fmt.Sprintf("channel account backfill: %d channels migrated, %d failed (will retry on next startup)", len(channels)-failed, failed))
	} else {
		common.SysLog(fmt.Sprintf("channel account backfill: %d channels migrated to private accounts", len(channels)))
	}
	return nil
}

// ensureModelsContextWindowColumn 幂等补 models.context_window 列（模型级上下文窗口）。
// 理由同 ensureChannelModelSettingsTable：已最新版本库走跳过路径需显式补列。
// AddColumn 无默认值，存量行是 NULL——Go 读作 0（不限制），语义正确，无需回填。
func ensureModelsContextWindowColumn(db *gorm.DB) error {
	if db.Migrator().HasTable(&Model{}) {
		if !db.Migrator().HasColumn(&Model{}, "context_window") {
			if err := db.Migrator().AddColumn(&Model{}, "context_window"); err != nil {
				return err
			}
		}
	}
	return nil
}

func ensureSubscriptionPlanTableSQLite() error {
	if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		return nil
	}
	tableName := "subscription_plans"
	if !DB.Migrator().HasTable(tableName) {
		createSQL := `CREATE TABLE ` + "`" + tableName + "`" + ` (
` + "`id`" + ` integer,
` + "`title`" + ` varchar(128) NOT NULL,
` + "`subtitle`" + ` varchar(255) DEFAULT '',
` + "`price_amount`" + ` decimal(10,6) NOT NULL,
` + "`currency`" + ` varchar(8) NOT NULL DEFAULT 'USD',
` + "`duration_unit`" + ` varchar(16) NOT NULL DEFAULT 'month',
` + "`duration_value`" + ` integer NOT NULL DEFAULT 1,
` + "`custom_seconds`" + ` bigint NOT NULL DEFAULT 0,
` + "`enabled`" + ` numeric DEFAULT 1,
` + "`sort_order`" + ` integer DEFAULT 0,
` + "`priority`" + ` integer NOT NULL DEFAULT 0,
` + "`is_recommended`" + ` numeric DEFAULT 0,
` + "`allow_balance_pay`" + ` numeric DEFAULT 1,
` + "`allow_wallet_overflow`" + ` numeric DEFAULT 1,
` + "`max_purchase_per_user`" + ` integer DEFAULT 0,
` + "`upgrade_group`" + ` varchar(64) DEFAULT '',
` + "`downgrade_group`" + ` varchar(64) DEFAULT '',
` + "`max_cumulative_seconds`" + ` bigint NOT NULL DEFAULT 0,
` + "`exclusive_group`" + ` varchar(64) DEFAULT '',
` + "`allowed_groups`" + ` text DEFAULT '',
` + "`reset_windows`" + ` text DEFAULT '',
` + "`created_at`" + ` bigint,
` + "`updated_at`" + ` bigint,
PRIMARY KEY (` + "`id`" + `)
)`
		return DB.Exec(createSQL).Error
	}
	var cols []struct {
		Name string `gorm:"column:name"`
	}
	if err := DB.Raw("PRAGMA table_info(`" + tableName + "`)").Scan(&cols).Error; err != nil {
		return err
	}
	existing := make(map[string]struct{}, len(cols))
	for _, c := range cols {
		existing[c.Name] = struct{}{}
	}
	required := []sqliteColumnDef{
		{Name: "title", DDL: "`title` varchar(128) NOT NULL"},
		{Name: "subtitle", DDL: "`subtitle` varchar(255) DEFAULT ''"},
		{Name: "price_amount", DDL: "`price_amount` decimal(10,6) NOT NULL"},
		{Name: "currency", DDL: "`currency` varchar(8) NOT NULL DEFAULT 'USD'"},
		{Name: "duration_unit", DDL: "`duration_unit` varchar(16) NOT NULL DEFAULT 'month'"},
		{Name: "duration_value", DDL: "`duration_value` integer NOT NULL DEFAULT 1"},
		{Name: "custom_seconds", DDL: "`custom_seconds` bigint NOT NULL DEFAULT 0"},
		{Name: "enabled", DDL: "`enabled` numeric DEFAULT 1"},
		{Name: "sort_order", DDL: "`sort_order` integer DEFAULT 0"},
		{Name: "priority", DDL: "`priority` integer NOT NULL DEFAULT 0"},
		{Name: "is_recommended", DDL: "`is_recommended` numeric DEFAULT 0"},
		{Name: "allow_balance_pay", DDL: "`allow_balance_pay` numeric DEFAULT 1"},
		{Name: "allow_wallet_overflow", DDL: "`allow_wallet_overflow` numeric DEFAULT 1"},
		{Name: "max_purchase_per_user", DDL: "`max_purchase_per_user` integer DEFAULT 0"},
		{Name: "upgrade_group", DDL: "`upgrade_group` varchar(64) DEFAULT ''"},
		{Name: "downgrade_group", DDL: "`downgrade_group` varchar(64) DEFAULT ''"},
		{Name: "max_cumulative_seconds", DDL: "`max_cumulative_seconds` bigint NOT NULL DEFAULT 0"},
		{Name: "exclusive_group", DDL: "`exclusive_group` varchar(64) DEFAULT ''"},
		{Name: "allowed_groups", DDL: "`allowed_groups` text DEFAULT ''"},
		{Name: "reset_windows", DDL: "`reset_windows` text DEFAULT ''"},
		{Name: "created_at", DDL: "`created_at` bigint"},
		{Name: "updated_at", DDL: "`updated_at` bigint"},
	}
	for _, col := range required {
		if _, ok := existing[col.Name]; ok {
			continue
		}
		if err := DB.Exec("ALTER TABLE `" + tableName + "` ADD COLUMN " + col.DDL).Error; err != nil {
			return err
		}
	}
	return nil
}

// migrateTokenModelLimitsToText migrates model_limits column from varchar(1024) to text
// This is safe to run multiple times - it checks the column type first
func migrateTokenModelLimitsToText(db *gorm.DB) error {
	// SQLite uses type affinity, so TEXT and VARCHAR are effectively the same — no migration needed
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		return nil
	}

	tableName := "tokens"
	columnName := "model_limits"

	if !db.Migrator().HasTable(tableName) {
		return nil
	}

	if !db.Migrator().HasColumn(&Token{}, columnName) {
		return nil
	}

	var alterSQL string
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		var dataType string
		if err := db.Raw(`SELECT data_type FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&dataType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if dataType == "text" {
			return nil
		}
		alterSQL = fmt.Sprintf(`ALTER TABLE %s ALTER COLUMN %s TYPE text`, tableName, columnName)
	} else if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		var columnType string
		if err := db.Raw(`SELECT COLUMN_TYPE FROM information_schema.columns
				WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&columnType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if strings.ToLower(columnType) == "text" {
			return nil
		}
		alterSQL = fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s text", tableName, columnName)
	} else {
		return nil
	}

	if alterSQL != "" {
		if err := db.Exec(alterSQL).Error; err != nil {
			return fmt.Errorf("failed to migrate %s.%s to text: %w", tableName, columnName, err)
		}
		common.SysLog(fmt.Sprintf("Successfully migrated %s.%s to text", tableName, columnName))
	}
	return nil
}

// migrateSubscriptionPlanPriceAmount migrates price_amount column from float/double to decimal(10,6)
// This is safe to run multiple times - it checks the column type first
func migrateSubscriptionPlanPriceAmount(db *gorm.DB) error {
	// SQLite doesn't support ALTER COLUMN, and its type affinity handles this automatically
	// Skip early to avoid GORM parsing the existing table DDL which may cause issues
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		return nil
	}

	tableName := "subscription_plans"
	columnName := "price_amount"

	// Check if table exists first
	if !db.Migrator().HasTable(tableName) {
		return nil
	}

	// Check if column exists
	if !db.Migrator().HasColumn(&SubscriptionPlan{}, columnName) {
		return nil
	}

	var alterSQL string
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		// PostgreSQL: Check if already decimal/numeric
		var dataType string
		if err := db.Raw(`SELECT data_type FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&dataType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if dataType == "numeric" {
			return nil // Already decimal/numeric
		}
		alterSQL = fmt.Sprintf(`ALTER TABLE %s ALTER COLUMN %s TYPE decimal(10,6) USING %s::decimal(10,6)`,
			tableName, columnName, columnName)
	} else if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		// MySQL: Check if already decimal
		var columnType string
		if err := db.Raw(`SELECT COLUMN_TYPE FROM information_schema.columns
				WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&columnType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if strings.HasPrefix(strings.ToLower(columnType), "decimal") {
			return nil // Already decimal
		}
		alterSQL = fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s decimal(10,6) NOT NULL DEFAULT 0",
			tableName, columnName)
	} else {
		return nil
	}

	if alterSQL != "" {
		if err := db.Exec(alterSQL).Error; err != nil {
			return fmt.Errorf("failed to migrate %s.%s to decimal: %w", tableName, columnName, err)
		}
		common.SysLog(fmt.Sprintf("Successfully migrated %s.%s to decimal(10,6)", tableName, columnName))
	}
	return nil
}

func closeDB(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	err = sqlDB.Close()
	return err
}

func CloseDB() error {
	if LOG_DB != DB {
		err := closeDB(LOG_DB)
		if err != nil {
			return err
		}
	}
	return closeDB(DB)
}

// checkMySQLChineseSupport ensures the MySQL connection and current schema
// default charset/collation can store Chinese characters. It allows common
// Chinese-capable charsets (utf8mb4, utf8, gbk, big5, gb18030) and panics otherwise.
func checkMySQLChineseSupport(db *gorm.DB) error {
	// 仅检测：当前库默认字符集/排序规则 + 各表的排序规则（隐含字符集）

	// Read current schema defaults
	var schemaCharset, schemaCollation string
	err := db.Raw("SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()").Row().Scan(&schemaCharset, &schemaCollation)
	if err != nil {
		return fmt.Errorf("读取当前库默认字符集/排序规则失败 / Failed to read schema default charset/collation: %v", err)
	}

	toLower := func(s string) string { return strings.ToLower(s) }
	// Allowed charsets that can store Chinese text
	allowedCharsets := map[string]string{
		"utf8mb4": "utf8mb4_",
		"utf8":    "utf8_",
		"gbk":     "gbk_",
		"big5":    "big5_",
		"gb18030": "gb18030_",
	}
	isChineseCapable := func(cs, cl string) bool {
		csLower := toLower(cs)
		clLower := toLower(cl)
		if prefix, ok := allowedCharsets[csLower]; ok {
			if clLower == "" {
				return true
			}
			return strings.HasPrefix(clLower, prefix)
		}
		// 如果仅提供了排序规则，尝试按排序规则前缀判断
		for _, prefix := range allowedCharsets {
			if strings.HasPrefix(clLower, prefix) {
				return true
			}
		}
		return false
	}

	// 1) 当前库默认值必须支持中文
	if !isChineseCapable(schemaCharset, schemaCollation) {
		return fmt.Errorf("当前库默认字符集/排序规则不支持中文：schema(%s/%s)。请将库设置为 utf8mb4/utf8/gbk/big5/gb18030 / Schema default charset/collation is not Chinese-capable: schema(%s/%s). Please set to utf8mb4/utf8/gbk/big5/gb18030",
			schemaCharset, schemaCollation, schemaCharset, schemaCollation)
	}

	// 2) 所有物理表的排序规则（隐含字符集）必须支持中文
	type tableInfo struct {
		Name      string
		Collation *string
	}
	var tables []tableInfo
	if err := db.Raw("SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'").Scan(&tables).Error; err != nil {
		return fmt.Errorf("读取表排序规则失败 / Failed to read table collations: %v", err)
	}

	var badTables []string
	for _, t := range tables {
		// NULL 或空表示继承库默认设置，已在上面校验库默认，视为通过
		if t.Collation == nil || *t.Collation == "" {
			continue
		}
		cl := *t.Collation
		// 仅凭排序规则判断是否中文可用
		ok := false
		lower := strings.ToLower(cl)
		for _, prefix := range allowedCharsets {
			if strings.HasPrefix(lower, prefix) {
				ok = true
				break
			}
		}
		if !ok {
			badTables = append(badTables, fmt.Sprintf("%s(%s)", t.Name, cl))
		}
	}

	if len(badTables) > 0 {
		// 限制输出数量以避免日志过长
		maxShow := 20
		shown := badTables
		if len(shown) > maxShow {
			shown = shown[:maxShow]
		}
		return fmt.Errorf(
			"存在不支持中文的表，请修复其排序规则/字符集。示例（最多展示 %d 项）：%v / Found tables not Chinese-capable. Please fix their collation/charset. Examples (showing up to %d): %v",
			maxShow, shown, maxShow, shown,
		)
	}
	return nil
}

var (
	lastPingTime time.Time
	pingMutex    sync.Mutex
)

func PingDB() error {
	pingMutex.Lock()
	defer pingMutex.Unlock()

	if time.Since(lastPingTime) < time.Second*10 {
		return nil
	}

	sqlDB, err := DB.DB()
	if err != nil {
		log.Printf("Error getting sql.DB from GORM: %v", err)
		return err
	}

	err = sqlDB.Ping()
	if err != nil {
		log.Printf("Error pinging DB: %v", err)
		return err
	}

	lastPingTime = time.Now()
	common.SysLog("Database pinged successfully")
	return nil
}

// ensureGroupPinTables 幂等建固定分组两表（group_pin_products / group_pins）并补列。
// 表由 AutoMigrate（升日期路径）创建；存量已最新库走"跳过迁移"路径不重跑
// AutoMigrate，需在这里显式补齐。AutoMigrate 幂等：表存在只补缺失列
// （260909-group-pin 之后商品模型新增 subtitle/is_recommended 等列即靠这里兜底）。
func ensureGroupPinTables(db *gorm.DB) error {
	if err := db.AutoMigrate(&GroupPinProduct{}); err != nil {
		return err
	}
	return db.AutoMigrate(&GroupPin{})
}

// ensureSubscriptionOrderPinColumns 幂等补 subscription_orders.kind / pin_product_id
// 列（固定分组订单分流）。理由同 ensureGroupPinTables：skip 路径的已最新库需显式补列。
func ensureSubscriptionOrderPinColumns(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&SubscriptionOrder{}, "kind") {
		if err := db.Migrator().AddColumn(&SubscriptionOrder{}, "kind"); err != nil {
			return err
		}
	}
	if err := db.Model(&SubscriptionOrder{}).Where("kind IS NULL").Update("kind", OrderKindSubscription).Error; err != nil {
		return err
	}
	if !db.Migrator().HasColumn(&SubscriptionOrder{}, "pin_product_id") {
		return db.Migrator().AddColumn(&SubscriptionOrder{}, "pin_product_id")
	}
	return nil
}
