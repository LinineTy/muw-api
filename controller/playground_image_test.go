package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupPlaygroundImageTestDB 初始化内存 SQLite，并把私有上传目录指向临时目录。
func setupPlaygroundImageTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db

	require.NoError(t, db.AutoMigrate(&model.PlaygroundImage{}, &model.User{}, &model.PlaygroundSpaceOrder{}))

	common.UploadDir = t.TempDir()
	common.PrivateUploadDir = t.TempDir()
	t.Cleanup(func() {
		common.UploadDir = "uploads"
		common.PrivateUploadDir = "uploads-private"
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

// insertTestUser 插入带 id 的最小用户行（可选设置图床禁用标记）。aff_code 唯一，
// 必须各不相同，否则第二行起撞唯一索引。
func insertTestUser(t *testing.T, id int, imageDisabled bool) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.User{
		Id:                      id,
		Username:                fmt.Sprintf("user%d", id),
		AffCode:                 fmt.Sprintf("aff%d", id),
		PlaygroundImageDisabled: imageDisabled,
	}).Error)
}

// newPlaygroundImageTestEngine 装配游乐场图片接口，支持覆盖注入用户 id。
func newPlaygroundImageTestEngine(userId int) *gin.Engine {
	router := gin.New()
	router.POST("/upload", func(c *gin.Context) {
		c.Set("id", userId)
		UploadPlaygroundImage(c)
	})
	router.GET("/list", func(c *gin.Context) {
		c.Set("id", userId)
		ListPlaygroundImages(c)
	})
	router.GET("/images/:id", func(c *gin.Context) {
		c.Set("id", userId)
		GetPlaygroundImage(c)
	})
	router.DELETE("/delete/:id", func(c *gin.Context) {
		c.Set("id", userId)
		DeletePlaygroundImage(c)
	})
	router.GET("/admin/stats", func(c *gin.Context) {
		c.Set("id", userId)
		AdminPlaygroundImageStats(c)
	})
	router.POST("/admin/cleanup", func(c *gin.Context) {
		c.Set("id", userId)
		AdminCleanupPlaygroundImages(c)
	})
	return router
}

// uploadTestImageAs 上传文件到指定路由（带可选的 permanent 查询参数）。
func uploadTestImageAs(t *testing.T, router *gin.Engine, filename string, content []byte, query string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	fw, err := writer.CreateFormFile("file", filename)
	require.NoError(t, err)
	_, err = fw.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	path := "/upload"
	if query != "" {
		path += "?" + query
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func playgroundTestPNGBytes(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	return buf.Bytes()
}

func playgroundPrivateFilePath(id int, ext string) string {
	return filepath.Join(common.PrivateUploadDir, "playground-images", fmt.Sprintf("%d.%s", id, ext))
}

func playgroundDecodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) apiEnvelope {
	t.Helper()
	var env apiEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	return env
}

// TestUploadPlaygroundImageRejectsNonImage 非图片内容必须被拒绝，且不创建私有目录。
func TestUploadPlaygroundImageRejectsNonImage(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	router := newPlaygroundImageTestEngine(100)

	rec := uploadTestImageAs(t, router, "fake.png", []byte("<svg onload=alert(1)>not an image</svg>"), "")

	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "仅支持")

	_, err := os.Stat(filepath.Join(common.PrivateUploadDir, "playground-images"))
	assert.True(t, os.IsNotExist(err))
}

// TestUploadPlaygroundImageRejectsOversized 超过 5MB 的图片必须被拒绝。
func TestUploadPlaygroundImageRejectsOversized(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	router := newPlaygroundImageTestEngine(100)

	rec := uploadTestImageAs(t, router, "big.png", bytes.Repeat([]byte{0x42}, maxImageSize+1), "")

	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "5MB")
}

// TestUploadPlaygroundImageRejectsMissingFile 无文件字段必须被拒绝。
func TestUploadPlaygroundImageRejectsMissingFile(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	router := newPlaygroundImageTestEngine(100)

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	require.NoError(t, writer.WriteField("foo", "bar"))
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/upload", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "缺少文件")
}

// TestUploadPlaygroundImageSavesPng 真 PNG 上传成功：落私有目录、入库、返回私有访问 url。
func TestUploadPlaygroundImageSavesPng(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	router := newPlaygroundImageTestEngine(100)

	data := playgroundTestPNGBytes(t)
	rec := uploadTestImageAs(t, router, "photo.png", data, "")

	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, "/api/playground/images/1", raw["url"])
	assert.Equal(t, false, raw["permanent"])

	// 磁盘字节一致。
	disk, err := os.ReadFile(playgroundPrivateFilePath(1, "png"))
	require.NoError(t, err)
	assert.Equal(t, data, disk)

	// DB 行字段正确。
	asset, err := model.GetPlaygroundImageById(1)
	require.NoError(t, err)
	assert.Equal(t, 100, asset.UserId)
	assert.Equal(t, "png", asset.Ext)
	assert.Equal(t, int64(len(data)), asset.Size)
	assert.False(t, asset.Permanent)
}

// TestUploadPlaygroundImagePermanentFlag ?permanent=true 落库带永久标记。
func TestUploadPlaygroundImagePermanentFlag(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	router := newPlaygroundImageTestEngine(100)

	rec := uploadTestImageAs(t, router, "photo.png", playgroundTestPNGBytes(t), "permanent=true")

	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
	asset, err := model.GetPlaygroundImageById(1)
	require.NoError(t, err)
	assert.True(t, asset.Permanent)
}

// TestUploadPlaygroundImageRejectsDisabledUser 被管理员禁用图床的用户上传必须被拒。
func TestUploadPlaygroundImageRejectsDisabledUser(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, true)
	router := newPlaygroundImageTestEngine(100)

	rec := uploadTestImageAs(t, router, "photo.png", playgroundTestPNGBytes(t), "")

	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "禁止")
}

// TestUploadPlaygroundImageRejectsWhenCapacityFull 统一容量模型：临时+永久合并计数，
// 已占用达到初始容量（SpaceCapacity=0 → 全局初始）后拒绝上传。
func TestUploadPlaygroundImageRejectsWhenCapacityFull(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Name: "x", Ext: "png", Size: int64(setting.UserSpaceInitialMB) << 20, UserId: 100, Permanent: false,
	}))
	router := newPlaygroundImageTestEngine(100)

	rec := uploadTestImageAs(t, router, "photo.png", playgroundTestPNGBytes(t), "")

	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "存储空间不足")
}

// TestUploadPlaygroundImageCapacityCountsTempAndPermanent 临时+永久合并：永久占满
// 也会拒绝临时上传。
func TestUploadPlaygroundImageCapacityCountsTempAndPermanent(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	// 永久图已占满初始容量，临时上传同样被拒（合并计数）。
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Name: "x", Ext: "png", Size: int64(setting.UserSpaceInitialMB) << 20, UserId: 100, Permanent: true,
	}))
	router := newPlaygroundImageTestEngine(100)

	rec := uploadTestImageAs(t, router, "photo.png", playgroundTestPNGBytes(t), "")

	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "存储空间不足")
}

// TestGetPlaygroundImageOwnership 本人可读图片字节；他人 403；不存在报错。
func TestGetPlaygroundImageOwnership(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	insertTestUser(t, 101, false)
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 1, Name: "x", Ext: "png", Size: 1, UserId: 100, Permanent: false,
	}))
	data := playgroundTestPNGBytes(t)
	require.NoError(t, os.MkdirAll(filepath.Join(common.PrivateUploadDir, "playground-images"), 0o755))
	require.NoError(t, os.WriteFile(playgroundPrivateFilePath(1, "png"), data, 0o644))

	// 本人可读，Content-Type 正确。
	owner := newPlaygroundImageTestEngine(100)
	rec := httptest.NewRecorder()
	owner.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/images/1", nil))
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "image/png", rec.Header().Get("Content-Type"))
	assert.Equal(t, data, rec.Body.Bytes())

	// 他人 403。
	other := newPlaygroundImageTestEngine(101)
	rec = httptest.NewRecorder()
	other.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/images/1", nil))
	assert.Equal(t, http.StatusForbidden, rec.Code)

	// 不存在 404。
	rec = httptest.NewRecorder()
	owner.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/images/999", nil))
	assert.Equal(t, http.StatusOK, rec.Code) // 业务错误仍走 200 信封
	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
}

// TestListPlaygroundImages 只返回当前用户且按 permanent 过滤。
func TestListPlaygroundImages(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 1, Name: "a", Ext: "png", Size: 1, UserId: 100, Permanent: false,
	}))
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 2, Name: "b", Ext: "png", Size: 1, UserId: 100, Permanent: true,
	}))
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 3, Name: "c", Ext: "png", Size: 1, UserId: 200, Permanent: true,
	}))

	router := newPlaygroundImageTestEngine(100)
	req := httptest.NewRequest(http.MethodGet, "/list", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
	items := []map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &items))
	require.Len(t, items, 2) // 缺省列出全部（临时+永久），用户 200 的行被排除
	assert.Equal(t, float64(2), items[0]["id"])
	assert.Equal(t, float64(1), items[1]["id"])
}

// TestDeletePlaygroundImageOwnership 本人可删并删文件；他人 403。
func TestDeletePlaygroundImageOwnership(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	insertTestUser(t, 100, false)
	insertTestUser(t, 101, false)
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 1, Name: "x", Ext: "png", Size: 1, UserId: 100, Permanent: false,
	}))
	require.NoError(t, os.MkdirAll(filepath.Join(common.PrivateUploadDir, "playground-images"), 0o755))
	require.NoError(t, os.WriteFile(playgroundPrivateFilePath(1, "png"), playgroundTestPNGBytes(t), 0o644))

	other := newPlaygroundImageTestEngine(101)
	rec := httptest.NewRecorder()
	other.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/delete/1", nil))
	assert.Equal(t, http.StatusForbidden, rec.Code)

	owner := newPlaygroundImageTestEngine(100)
	rec = httptest.NewRecorder()
	owner.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/delete/1", nil))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)

	_, err := os.Stat(playgroundPrivateFilePath(1, "png"))
	assert.True(t, os.IsNotExist(err))
	_, err = model.GetPlaygroundImageById(1)
	assert.Error(t, err) // 软删后查不到
}

// TestAdminPlaygroundImageStats 管理员统计返回临时/永久数量与字节。
func TestAdminPlaygroundImageStats(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 1, Name: "a", Ext: "png", Size: 10, UserId: 100, Permanent: false,
	}))
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 2, Name: "b", Ext: "png", Size: 20, UserId: 100, Permanent: false,
	}))
	require.NoError(t, model.InsertPlaygroundImage(&model.PlaygroundImage{
		Id: 3, Name: "c", Ext: "png", Size: 30, UserId: 101, Permanent: true,
	}))

	router := newPlaygroundImageTestEngine(100)
	req := httptest.NewRequest(http.MethodGet, "/admin/stats", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	transient := raw["transient"].(map[string]any)
	permanent := raw["permanent"].(map[string]any)
	assert.Equal(t, float64(2), transient["count"])
	assert.Equal(t, float64(30), transient["total_bytes"])
	assert.Equal(t, float64(1), permanent["count"])
	assert.Equal(t, float64(30), permanent["total_bytes"])
}

// TestAdminPlaygroundImageStatsEmpty 无图片时 stats 必须返回空数组而非 null，
// 避免前端 top_users.length 崩溃。
func TestAdminPlaygroundImageStatsEmpty(t *testing.T) {
	setupPlaygroundImageTestDB(t)

	router := newPlaygroundImageTestEngine(100)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin/stats", nil))

	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, []any{}, raw["top_users"])
	assert.Equal(t, float64(0), raw["transient"].(map[string]any)["count"])
	assert.Equal(t, float64(0), raw["permanent"].(map[string]any)["count"])
}

// TestAdminCleanupPlaygroundImages 只清过期临时图；all=true 清所有临时图；永久不动。
func TestAdminCleanupPlaygroundImages(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	now := common.GetTimestamp()
	old := now - int64(4*24*3600)    // 4 天前 > 默认 3 天 TTL
	recent := now - int64(3600)      // 1 小时前：TTL 内保留，但 all=true 时必删（避免秒边界抖动）
	// 过期临时行（落文件）。
	require.NoError(t, model.DB.Create(&model.PlaygroundImage{
		Id: 1, Name: "old", Ext: "png", Size: 1, UserId: 100, Permanent: false, CreatedTime: old,
	}).Error)
	require.NoError(t, os.MkdirAll(filepath.Join(common.PrivateUploadDir, "playground-images"), 0o755))
	require.NoError(t, os.WriteFile(playgroundPrivateFilePath(1, "png"), []byte("x"), 0o644))
	// 近期临时行（落文件）。
	require.NoError(t, model.DB.Create(&model.PlaygroundImage{
		Id: 2, Name: "recent", Ext: "png", Size: 1, UserId: 100, Permanent: false, CreatedTime: recent,
	}).Error)
	require.NoError(t, os.WriteFile(playgroundPrivateFilePath(2, "png"), []byte("x"), 0o644))
	// 永久行。
	require.NoError(t, model.DB.Create(&model.PlaygroundImage{
		Id: 3, Name: "perm", Ext: "png", Size: 1, UserId: 100, Permanent: true, CreatedTime: old,
	}).Error)

	router := newPlaygroundImageTestEngine(100)

	// 只清过期。
	body := bytes.NewBufferString(`{}`)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/admin/cleanup", body))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, float64(1), raw["deleted"])
	_, err := model.GetPlaygroundImageById(1)
	assert.Error(t, err)
	_, err = model.GetPlaygroundImageById(2) // 近期临时仍在
	assert.NoError(t, err)
	_, err = model.GetPlaygroundImageById(3) // 永久仍在
	assert.NoError(t, err)

	// all=true 清所有临时。
	body = bytes.NewBufferString(`{"all":true}`)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/admin/cleanup", body))
	env = playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success)
	raw = map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, float64(1), raw["deleted"])
	_, err = model.GetPlaygroundImageById(2)
	assert.Error(t, err)
	_, err = model.GetPlaygroundImageById(3) // 永久仍保留
	assert.NoError(t, err)
}
