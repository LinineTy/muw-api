package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func openPlaygroundImageTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	prevType := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() { common.SetMainDatabaseType(prevType) })

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&PlaygroundImage{}))

	prevDB := DB
	DB = db
	t.Cleanup(func() { DB = prevDB })
	return db
}

// TestPlaygroundImageCountSumExcludesSoftDeleted 计数与求和必须排除软删行。
func TestPlaygroundImageCountSumExcludesSoftDeleted(t *testing.T) {
	openPlaygroundImageTestDB(t)

	require.NoError(t, InsertPlaygroundImage(&PlaygroundImage{
		Id: 1, Name: "a", Ext: "png", Size: 10, UserId: 100, Permanent: false,
	}))
	require.NoError(t, InsertPlaygroundImage(&PlaygroundImage{
		Id: 2, Name: "b", Ext: "png", Size: 20, UserId: 100, Permanent: false,
	}))

	count, err := CountPlaygroundImagesByUser(100, false)
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)
	sum, err := SumPlaygroundImageSizesByUser(100, false)
	require.NoError(t, err)
	assert.Equal(t, int64(30), sum)

	// 软删后不再计入。
	require.NoError(t, DeletePlaygroundImageById(1))
	count, err = CountPlaygroundImagesByUser(100, false)
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)
	sum, err = SumPlaygroundImageSizesByUser(100, false)
	require.NoError(t, err)
	assert.Equal(t, int64(20), sum)
}

// TestPlaygroundImageListExpiredOnlyNonPermanent ListExpired 只返回过期的非永久行。
func TestPlaygroundImageListExpiredOnlyNonPermanent(t *testing.T) {
	openPlaygroundImageTestDB(t)

	now := common.GetTimestamp()
	// InsertPlaygroundImage 会覆写 CreatedTime，过期测试需用 DB.Create 显式时间。
	require.NoError(t, DB.Create(&PlaygroundImage{
		Id: 1, Name: "old-transient", Ext: "png", Size: 1, UserId: 100, Permanent: false, CreatedTime: now - 100,
	}).Error)
	require.NoError(t, DB.Create(&PlaygroundImage{
		Id: 2, Name: "old-permanent", Ext: "png", Size: 1, UserId: 100, Permanent: true, CreatedTime: now - 100,
	}).Error)
	require.NoError(t, DB.Create(&PlaygroundImage{
		Id: 3, Name: "recent-transient", Ext: "png", Size: 1, UserId: 100, Permanent: false, CreatedTime: now,
	}).Error)

	rows, err := ListExpiredPlaygroundImages(now-10, 0)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, 1, rows[0].Id)
}

// TestPlaygroundImageHardDelete HardDelete 走 Unscoped，行真删（软删区也不留）。
func TestPlaygroundImageHardDelete(t *testing.T) {
	openPlaygroundImageTestDB(t)

	require.NoError(t, InsertPlaygroundImage(&PlaygroundImage{
		Id: 1, Name: "a", Ext: "png", Size: 1, UserId: 100, Permanent: false,
	}))

	affected, err := HardDeletePlaygroundImagesByIds([]int{1})
	require.NoError(t, err)
	assert.Equal(t, int64(1), affected)

	var total int64
	require.NoError(t, DB.Unscoped().Model(&PlaygroundImage{}).Count(&total).Error)
	assert.Equal(t, int64(0), total)
}

// TestPlaygroundImageUserDisabledField 验证用户图床禁用字段的读写（管理员可设、可读回）。
func TestPlaygroundImageUserDisabledField(t *testing.T) {
	openPlaygroundImageTestDB(t)
	require.NoError(t, DB.AutoMigrate(&User{}))

	require.NoError(t, DB.Create(&User{Id: 100, Username: "u", PlaygroundImageDisabled: true}).Error)

	user, err := GetUserById(100, false)
	require.NoError(t, err)
	assert.True(t, user.PlaygroundImageDisabled)

	user.PlaygroundImageDisabled = false
	require.NoError(t, user.EditWithTx(DB, false))

	user2, err := GetUserById(100, false)
	require.NoError(t, err)
	assert.False(t, user2.PlaygroundImageDisabled)
}
