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

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupImageTestDB 初始化内存 SQLite 并把上传目录指向临时目录。
func setupImageTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db

	require.NoError(t, db.AutoMigrate(&model.ImageAsset{}))

	common.UploadDir = t.TempDir()
	t.Cleanup(func() {
		common.UploadDir = "uploads"
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

// newImageTestEngine 装配图片管理接口，注入测试用户 id。
func newImageTestEngine() *gin.Engine {
	router := gin.New()
	router.POST("/upload", func(c *gin.Context) {
		c.Set("id", 100)
		UploadImage(c)
	})
	router.GET("/list", ListImages)
	router.DELETE("/delete/:id", func(c *gin.Context) {
		c.Set("id", 100)
		DeleteImage(c)
	})
	return router
}

type apiEnvelope struct {
	Success bool            `json:"success"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func uploadTestImage(t *testing.T, router *gin.Engine, filename string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	fw, err := writer.CreateFormFile("file", filename)
	require.NoError(t, err)
	_, err = fw.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/upload", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func testPNGBytes(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	return buf.Bytes()
}

// TestUploadImageRejectsNonImage 上传非图片内容必须被拒绝（保护磁盘目录只存真图片）。
func TestUploadImageRejectsNonImage(t *testing.T) {
	setupImageTestDB(t)
	router := newImageTestEngine()

	rec := uploadTestImage(t, router, "fake.png", []byte("<svg onload=alert(1)>not an image</svg>"))

	var env apiEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "仅支持")

	// 拒绝时不创建 images 目录。
	_, err := os.Stat(filepath.Join(common.UploadDir, "images"))
	assert.True(t, os.IsNotExist(err))
}

// TestUploadImageRejectsOversized 超过 5MB 的图片必须被拒绝。
func TestUploadImageRejectsOversized(t *testing.T) {
	setupImageTestDB(t)
	router := newImageTestEngine()

	rec := uploadTestImage(t, router, "big.png", bytes.Repeat([]byte{0x42}, maxImageSize+1))

	var env apiEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "5MB")
}

// TestUploadImageSavesPng 真 PNG 上传成功：落盘、入库、返回可访问 url。
func TestUploadImageSavesPng(t *testing.T) {
	setupImageTestDB(t)
	router := newImageTestEngine()

	rec := uploadTestImage(t, router, "hero.png", testPNGBytes(t))

	require.Equal(t, http.StatusOK, rec.Code)
	var env apiEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	require.True(t, env.Success)
	var data struct {
		Id  int    `json:"id"`
		Url string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, "/uploads/images/1.png", data.Url)

	// 磁盘文件存在且内容一致。
	diskPath := filepath.Join(common.UploadDir, "images", "1.png")
	stored, err := os.ReadFile(diskPath)
	require.NoError(t, err)
	assert.Equal(t, testPNGBytes(t), stored)

	// DB 行存在且记录元数据。
	asset, err := model.GetImageAssetById(data.Id)
	require.NoError(t, err)
	assert.Equal(t, "hero.png", asset.Name)
	assert.Equal(t, "png", asset.Ext)
	assert.Equal(t, int64(len(testPNGBytes(t))), asset.Size)
	assert.Equal(t, 100, asset.UploaderId)
}

// TestListImagesOrdersNewestFirst 列表按 id 倒序返回且带可访问 url。
func TestListImagesOrdersNewestFirst(t *testing.T) {
	setupImageTestDB(t)
	router := newImageTestEngine()

	uploadTestImage(t, router, "a.png", testPNGBytes(t))
	uploadTestImage(t, router, "b.png", testPNGBytes(t))

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/list", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var env apiEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	require.True(t, env.Success)
	var items []struct {
		Id   int    `json:"id"`
		Name string `json:"name"`
		Url  string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &items))
	require.Len(t, items, 2)
	assert.Equal(t, 2, items[0].Id)
	assert.Equal(t, "/uploads/images/2.png", items[0].Url)
	assert.Equal(t, 1, items[1].Id)
}

// TestDeleteImageRemovesRowAndFile 删除后 DB 软删且磁盘文件被移除。
func TestDeleteImageRemovesRowAndFile(t *testing.T) {
	setupImageTestDB(t)
	router := newImageTestEngine()

	uploadTestImage(t, router, "hero.png", testPNGBytes(t))
	diskPath := filepath.Join(common.UploadDir, "images", "1.png")
	require.FileExists(t, diskPath)

	req := httptest.NewRequest(http.MethodDelete, "/delete/1", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var env apiEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	assert.True(t, env.Success)

	_, err := model.GetImageAssetById(1)
	assert.Error(t, err)
	_, err = os.Stat(diskPath)
	assert.ErrorIs(t, err, os.ErrNotExist)
}

// TestDeleteImageNotFound 删除不存在的图片返回错误。
func TestDeleteImageNotFound(t *testing.T) {
	setupImageTestDB(t)
	router := newImageTestEngine()

	req := httptest.NewRequest(http.MethodDelete, "/delete/999", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var env apiEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "不存在")
}
