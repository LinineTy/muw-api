// @muw-owned
package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openOIDCUpToDateDB 模拟"已到最新 schema"的库：schema_migrations 已打上最新 head，
// 启动走跳过 autoMigrateAll 的路径，OIDC 的表只能靠幂等 ensure 补上。
func openOIDCUpToDateDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, ensureSchemaMigrationsTable(db))
	require.NoError(t, db.Create(&SchemaMigration{Name: migrations[len(migrations)-1].Name}).Error)
	return db
}

// 回归：存量库（跳过 AutoMigrate 路径）必须能靠 ensureOIDCProviderTables 补出 5 张表，
// 且重复执行幂等——否则升级库一访问 OIDC 接口就报 no such table。
func TestEnsureOIDCProviderTablesIsIdempotentOnUpToDateDB(t *testing.T) {
	db := openOIDCUpToDateDB(t)
	require.NoError(t, ensureOIDCProviderTables(db))
	require.NoError(t, ensureOIDCProviderTables(db), "重复执行必须幂等")

	for _, table := range []any{&OIDCClient{}, &OIDCAuthCode{}, &OIDCRefreshToken{}, &OIDCConsent{}, &OIDCSigningKey{}} {
		assert.True(t, db.Migrator().HasTable(table), "缺表")
	}

	// 关键约束抽查：client_id 唯一、用户×应用授权唯一、令牌哈希唯一。
	require.NoError(t, db.Create(&OIDCClient{ClientId: "muw_dup"}).Error)
	assert.Error(t, db.Create(&OIDCClient{ClientId: "muw_dup"}).Error, "client_id 必须唯一")

	require.NoError(t, db.Create(&OIDCConsent{UserId: 7, ClientId: "muw_dup"}).Error)
	assert.Error(t, db.Create(&OIDCConsent{UserId: 7, ClientId: "muw_dup"}).Error, "同一用户同一应用只应有一条授权")

	require.NoError(t, db.Create(&OIDCRefreshToken{TokenHash: "hash-1"}).Error)
	assert.Error(t, db.Create(&OIDCRefreshToken{TokenHash: "hash-1"}).Error, "令牌哈希必须唯一")

	require.NoError(t, db.Create(&OIDCSigningKey{Kid: "kid-1", PrivateKeyCipher: "x"}).Error)
	assert.Error(t, db.Create(&OIDCSigningKey{Kid: "kid-1", PrivateKeyCipher: "x"}).Error, "签名密钥 kid 必须唯一")
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
