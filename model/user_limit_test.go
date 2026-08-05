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

// openUserLimitTestDB 打开独立内存 SQLite,含 users 与 user_count_locks 结构,
// 并预置 id=1 全局锁行(与 migrateDB 每次启动的 seed 一致)。
func openUserLimitTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &UserCountLock{}))
	require.NoError(t, db.Create(&UserCountLock{Id: 1}).Error)
	return db
}

func withMaxUserCount(t *testing.T, n int) func() {
	t.Helper()
	old := common.MaxUserCount
	common.MaxUserCount = n
	return func() { common.MaxUserCount = old }
}

func createUser(t *testing.T, db *gorm.DB, username string, role int) {
	t.Helper()
	// aff_code 有唯一约束,直接 Create 需给每个用户独立值
	require.NoError(t, db.Create(&User{Username: username, Password: "x", Role: role, AffCode: "aff-" + username}).Error)
}

// TestCheckUserLimitReached 覆盖站点最大用户数校验:
// 0 不限制;达到上限拒绝(ErrUserLimitReached);超管(root)不计入额度。
func TestCheckUserLimitReached(t *testing.T) {
	t.Run("unlimited", func(t *testing.T) {
		db := openUserLimitTestDB(t)
		defer withMaxUserCount(t, 0)()
		createUser(t, db, "u1", common.RoleCommonUser)
		err := db.Transaction(func(tx *gorm.DB) error { return checkUserLimitReached(tx) })
		require.NoError(t, err)
	})

	t.Run("under limit", func(t *testing.T) {
		db := openUserLimitTestDB(t)
		defer withMaxUserCount(t, 3)()
		createUser(t, db, "u1", common.RoleCommonUser)
		createUser(t, db, "u2", common.RoleCommonUser)
		err := db.Transaction(func(tx *gorm.DB) error { return checkUserLimitReached(tx) })
		require.NoError(t, err)
	})

	t.Run("at limit rejects", func(t *testing.T) {
		db := openUserLimitTestDB(t)
		defer withMaxUserCount(t, 2)()
		createUser(t, db, "u1", common.RoleCommonUser)
		createUser(t, db, "u2", common.RoleCommonUser)
		err := db.Transaction(func(tx *gorm.DB) error { return checkUserLimitReached(tx) })
		assert.ErrorIs(t, err, ErrUserLimitReached)
	})

	t.Run("root not counted", func(t *testing.T) {
		db := openUserLimitTestDB(t)
		defer withMaxUserCount(t, 1)()
		// 一个超管 + 一个普通用户:普通用户已到上限 1 → 拒绝
		createUser(t, db, "root1", common.RoleRootUser)
		createUser(t, db, "w1", common.RoleCommonUser)
		err := db.Transaction(func(tx *gorm.DB) error { return checkUserLimitReached(tx) })
		assert.ErrorIs(t, err, ErrUserLimitReached)

		// 去掉普通用户:只剩超管(不计入)→ 允许
		require.NoError(t, db.Where("username = ?", "w1").Delete(&User{}).Error)
		err = db.Transaction(func(tx *gorm.DB) error { return checkUserLimitReached(tx) })
		require.NoError(t, err)
	})

	t.Run("exactly n minus one allows", func(t *testing.T) {
		db := openUserLimitTestDB(t)
		defer withMaxUserCount(t, 3)()
		// 已有 2 个普通用户,上限 3,再允许第 3 个;第 4 个拒绝
		createUser(t, db, "a", common.RoleCommonUser)
		createUser(t, db, "b", common.RoleCommonUser)
		err := db.Transaction(func(tx *gorm.DB) error { return checkUserLimitReached(tx) })
		require.NoError(t, err)
		createUser(t, db, "c", common.RoleCommonUser)
		err = db.Transaction(func(tx *gorm.DB) error { return checkUserLimitReached(tx) })
		assert.ErrorIs(t, err, ErrUserLimitReached)
	})
}

// TestEnsureUserCountLockSeededIsIdempotent 覆盖锁行 seed 幂等。
func TestEnsureUserCountLockSeededIsIdempotent(t *testing.T) {
	db := openUserLimitTestDB(t)
	require.NoError(t, ensureUserCountLockSeeded(db))
	require.NoError(t, ensureUserCountLockSeeded(db))
	var count int64
	require.NoError(t, db.Model(&UserCountLock{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

// TestEnsureUserCountLockSeededCreatesTableWhenMissing 覆盖已最新(跳过 AutoMigrate)
// 的库也能建表并 seed:表不存在时 ensureUserCountLockSeeded 必须能自建。
func TestEnsureUserCountLockSeededCreatesTableWhenMissing(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, ensureUserCountLockSeeded(db))
	var lock UserCountLock
	require.NoError(t, db.First(&lock, 1).Error)
	assert.EqualValues(t, 1, lock.Id)
}

// TestInsertEnforcesUserLimitReached 验证 Insert 走完整事务路径也会被限制拦下。
func TestInsertEnforcesUserLimitReached(t *testing.T) {
	db := openUserLimitTestDB(t)
	defer withMaxUserCount(t, 1)()

	// 达到上限后再 Insert 应返回 ErrUserLimitReached
	createUser(t, db, "existing", common.RoleCommonUser)
	u := &User{Username: fmt.Sprintf("newuser%d", 0), Password: "x", Role: common.RoleCommonUser}
	err := db.Transaction(func(tx *gorm.DB) error {
		return u.InsertWithTx(tx, 0)
	})
	assert.ErrorIs(t, err, ErrUserLimitReached)
}
