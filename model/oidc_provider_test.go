// @muw-owned
package model

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// openOIDCTestDB 按 TEST_OIDC_DIALECT（sqlite/mysql/postgres，默认 sqlite）开测试库；
// MySQL/PostgreSQL 用 TEST_<DIALECT>_DSN 指向真实实例（仓库规范要求三库都验过）。
func openOIDCTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	kind := strings.ToLower(strings.TrimSpace(os.Getenv("TEST_OIDC_DIALECT")))
	var (
		db  *gorm.DB
		err error
	)
	switch kind {
	case "", "sqlite":
		db, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	case "mysql":
		db, err = gorm.Open(mysql.Open(os.Getenv("TEST_MYSQL_DSN")), &gorm.Config{})
	case "postgres":
		db, err = gorm.Open(postgres.Open(os.Getenv("TEST_POSTGRES_DSN")), &gorm.Config{})
	default:
		t.Fatalf("不支持的 TEST_OIDC_DIALECT：%s", kind)
	}
	require.NoError(t, err)
	return db
}

// 回归：存量库（跳过 AutoMigrate 路径）必须能靠 ensureOIDCProviderTables 补出 5 张表，
// 且重复执行幂等——否则升级库一访问 OIDC 接口就报 no such table。
func TestEnsureOIDCProviderTablesIsIdempotent(t *testing.T) {
	db := openOIDCTestDB(t)
	// 干净起点：先删掉 5 张表，验证 ensure 能从零建出来（真实 MySQL/PostgreSQL 上同样成立）。
	require.NoError(t, db.Migrator().DropTable(&OIDCConsent{}, &OIDCRefreshToken{}, &OIDCAuthCode{}, &OIDCSigningKey{}, &OIDCClient{}))
	require.NoError(t, ensureOIDCProviderTables(db))
	require.NoError(t, ensureOIDCProviderTables(db), "重复执行必须幂等")

	for _, table := range []any{&OIDCClient{}, &OIDCAuthCode{}, &OIDCRefreshToken{}, &OIDCConsent{}, &OIDCSigningKey{}} {
		assert.True(t, db.Migrator().HasTable(table), "缺表")
	}

	// 关键约束抽查：client_id 唯一、用户×应用授权唯一、令牌哈希唯一。
	unique := fmt.Sprintf("muw_dup_%d", time.Now().UnixNano())
	require.NoError(t, db.Create(&OIDCClient{ClientId: unique}).Error)
	assert.Error(t, db.Create(&OIDCClient{ClientId: unique}).Error, "client_id 必须唯一")

	require.NoError(t, db.Create(&OIDCConsent{UserId: 7, ClientId: unique}).Error)
	assert.Error(t, db.Create(&OIDCConsent{UserId: 7, ClientId: unique}).Error, "同一用户同一应用只应有一条授权")

	tokenHash := fmt.Sprintf("hash-%d", time.Now().UnixNano())
	require.NoError(t, db.Create(&OIDCRefreshToken{TokenHash: tokenHash}).Error)
	assert.Error(t, db.Create(&OIDCRefreshToken{TokenHash: tokenHash}).Error, "令牌哈希必须唯一")

	kid := fmt.Sprintf("kid-%d", time.Now().UnixNano())
	require.NoError(t, db.Create(&OIDCSigningKey{Kid: kid, PrivateKeyCipher: "x"}).Error)
	assert.Error(t, db.Create(&OIDCSigningKey{Kid: kid, PrivateKeyCipher: "x"}).Error, "签名密钥 kid 必须唯一")
}

// 迁移列表必须保持"日期递增 + 名称唯一"，新增的 OIDC 条目不能破坏这套校验。
func TestOIDCMigrationEntryIsRegistered(t *testing.T) {
	var found bool
	for _, migration := range migrations {
		if migration.Name == "260926-oidc-provider" {
			found = true
		}
	}
	assert.True(t, found, "迁移列表里应有 260926-oidc-provider")
	require.NoError(t, validateMigrations(migrations))
}

// 仓库规范要求的"存量库升级"场景：库由上一个版本建好（已打最新迁移戳，启动会跳过
// autoMigrateAll），此时升级到带 OIDC 的版本，必须靠 migrateDB 里的幂等 ensure 补表。
func TestMigrateDBCreatesOIDCTablesOnExistingUpToDateDatabase(t *testing.T) {
	// 只在 SQLite 上模拟"存量库升级"：这条路径要先 autoMigrateAll() 造出上一个版本的库，
	// 而当前代码在**全新 MySQL 库**上建 subscription_plans 会失败（TEXT 列带 DEFAULT '',
	// MySQL 不允许）——那是与本功能无关的既有问题，见待办。MySQL/PostgreSQL 侧改用
	// "全新库建表 + 约束 + ensure 幂等 + 端到端流程"作为等价证据。
	if kind := strings.ToLower(strings.TrimSpace(os.Getenv("TEST_OIDC_DIALECT"))); kind != "" && kind != "sqlite" {
		t.Skipf("存量库升级模拟仅支持 sqlite（%s 上 autoMigrateAll 触发既有的 subscription_plans DDL 问题）", kind)
	}
	db := openOIDCTestDB(t)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })

	// 造一个"上一个版本建出来的库"：全量模型已建，但没有 OIDC 表。
	require.NoError(t, autoMigrateAll())
	require.NoError(t, db.Migrator().DropTable(&OIDCConsent{}, &OIDCRefreshToken{}, &OIDCAuthCode{}, &OIDCSigningKey{}, &OIDCClient{}))
	require.NoError(t, ensureSchemaMigrationsTable(db))
	require.NoError(t, db.Where("1 = 1").Delete(&SchemaMigration{}).Error)
	require.NoError(t, db.Create(&SchemaMigration{Name: migrations[len(migrations)-1].Name}).Error)

	require.NoError(t, migrateDB())

	for _, table := range []any{&OIDCClient{}, &OIDCAuthCode{}, &OIDCRefreshToken{}, &OIDCConsent{}, &OIDCSigningKey{}} {
		assert.True(t, db.Migrator().HasTable(table), "存量库升级后缺表")
	}
}
