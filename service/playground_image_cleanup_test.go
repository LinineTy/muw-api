package service

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openPlaygroundImageCleanupTestDB 初始化内存 SQLite 与临时私有目录，恢复原全局状态。
func openPlaygroundImageCleanupTestDB(t *testing.T) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlaygroundImage{}))

	prevDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = prevDB })

	prevPrivateDir := common.PrivateUploadDir
	common.PrivateUploadDir = t.TempDir()
	t.Cleanup(func() { common.PrivateUploadDir = prevPrivateDir })

	prevTTL := setting.PlaygroundImageTTLDays
	setting.PlaygroundImageTTLDays = setting.DefaultPlaygroundImageTTLDays
	t.Cleanup(func() { setting.PlaygroundImageTTLDays = prevTTL })
}

func writePlaygroundImageFile(t *testing.T, id int, ext string) {
	t.Helper()
	dir := filepath.Join(common.PrivateUploadDir, "playground-images")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.%s", id, ext)), []byte("x"), 0o644))
}

// TestCleanupPlaygroundImagesRemovesExpiredTransient 过期临时行+文件被清，近期行与
// 永久收藏跳过（无论多老）。
func TestCleanupPlaygroundImagesRemovesExpiredTransient(t *testing.T) {
	openPlaygroundImageCleanupTestDB(t)

	now := time.Now().Unix()
	old := now - int64((4*24*time.Hour)/time.Second) // 4 天前 > 默认 3 天 TTL
	recent := now - int64(time.Hour/time.Second)

	// InsertPlaygroundImage 会覆写 CreatedTime，用 DB.Create 显式时间。
	require.NoError(t, model.DB.Create(&model.PlaygroundImage{
		Id: 1, Name: "old-transient", Ext: "png", Size: 1, UserId: 100, Permanent: false, CreatedTime: old,
	}).Error)
	require.NoError(t, model.DB.Create(&model.PlaygroundImage{
		Id: 2, Name: "old-permanent", Ext: "png", Size: 1, UserId: 100, Permanent: true, CreatedTime: old,
	}).Error)
	require.NoError(t, model.DB.Create(&model.PlaygroundImage{
		Id: 3, Name: "recent-transient", Ext: "png", Size: 1, UserId: 100, Permanent: false, CreatedTime: recent,
	}).Error)
	writePlaygroundImageFile(t, 1, "png")
	writePlaygroundImageFile(t, 2, "png")
	writePlaygroundImageFile(t, 3, "png")

	cleanupPlaygroundImages()

	// 过期临时行被硬删，文件被移除。
	_, err := model.GetPlaygroundImageById(1)
	assert.Error(t, err)
	_, statErr := os.Stat(filepath.Join(common.PrivateUploadDir, "playground-images", "1.png"))
	assert.True(t, os.IsNotExist(statErr))

	// 永久收藏与近期临时行保留，文件保留。
	_, err = model.GetPlaygroundImageById(2)
	assert.NoError(t, err)
	_, err = model.GetPlaygroundImageById(3)
	assert.NoError(t, err)
	_, statErr = os.Stat(filepath.Join(common.PrivateUploadDir, "playground-images", "2.png"))
	assert.NoError(t, statErr)
	_, statErr = os.Stat(filepath.Join(common.PrivateUploadDir, "playground-images", "3.png"))
	assert.NoError(t, statErr)
}
