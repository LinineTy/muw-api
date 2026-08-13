package controller

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"  // register GIF decoder for format detection
	_ "image/jpeg" // register JPEG decoder for format detection
	_ "image/png"  // register PNG decoder for format detection
	"io"
	"mime"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp" // register WebP decoder for format detection
)

// playgroundImageFilepath 返回私有目录下的落盘路径。此目录在 static /uploads/
// 服务树之外，用户图片只能经鉴权接口读取。
func playgroundImageFilepath(id int, ext string) string {
	return filepath.Join(common.PrivateUploadDir, "playground-images", fmt.Sprintf("%d.%s", id, ext))
}

// validatePlaygroundImageData 解码校验真图片并映射扩展名；拒绝 SVG/可执行内容。
// 游乐场附件仅支持图片（不做视频）。复用 image_asset.go 的白名单与大小上限。
func validatePlaygroundImageData(data []byte) (string, bool) {
	if len(data) > maxImageSize {
		return "", false
	}
	_, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", false
	}
	ext, ok := imageExtByFormat[format]
	return ext, ok
}

// persistPlaygroundImage 入库元数据行并落盘到私有目录。任一步失败都硬删已写的
// DB 行（Unscoped），避免孤儿记录。
func persistPlaygroundImage(asset *model.PlaygroundImage, data []byte) error {
	if err := model.InsertPlaygroundImage(asset); err != nil {
		return err
	}
	dir := filepath.Join(common.PrivateUploadDir, "playground-images")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		_, _ = model.HardDeletePlaygroundImagesByIds([]int{asset.Id})
		return err
	}
	filename := fmt.Sprintf("%d.%s", asset.Id, asset.Ext)
	if err := os.WriteFile(filepath.Join(dir, filename), data, 0o644); err != nil {
		_, _ = model.HardDeletePlaygroundImagesByIds([]int{asset.Id})
		return err
	}
	return nil
}

// UploadPlaygroundImage 接收 multipart 图片（字段 "file"），落盘私有目录并写元数据行。
// ?permanent=true 时归入用户永久收藏（GC 跳过），否则为临时附件（TTL 自动清理）。
// 配额与 TTL 由设置控制（setting.PlaygroundImage*），改动热生效。
func UploadPlaygroundImage(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}
	if user.PlaygroundImageDisabled {
		common.ApiErrorMsg(c, "该用户已被禁止使用图片上传")
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "缺少文件字段")
		return
	}

	src, err := fileHeader.Open()
	if err != nil {
		common.ApiErrorMsg(c, "无法读取上传文件")
		return
	}
	defer src.Close()

	data, err := io.ReadAll(io.LimitReader(src, maxImageSize+1))
	if err != nil {
		common.ApiErrorMsg(c, "无法读取上传文件")
		return
	}
	if len(data) > maxImageSize {
		common.ApiErrorMsg(c, "图片文件不能超过 5MB")
		return
	}

	ext, ok := validatePlaygroundImageData(data)
	if !ok {
		common.ApiErrorMsg(c, "仅支持 PNG/JPEG/GIF/WebP 图片")
		return
	}

	permanent, _ := strconv.ParseBool(c.Query("permanent"))

	// 落库前容量检查（软删自动排除已删行）。root 无限制：容量与云空间总分配量都跳过。
	// 云空间统一容量模型：临时+永久合并计一个总空间。
	if c.GetInt("role") != common.RoleRootUser {
		capacity := int64(setting.UserSpaceInitialMB) << 20
		if user.SpaceCapacity > 0 {
			capacity = user.SpaceCapacity
		}
		used, err := model.SumPlaygroundImageSizesByUserAll(userId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if used+int64(len(data)) > capacity {
			common.ApiErrorMsg(c, "存储空间不足")
			return
		}
		// 云空间总分配量（红线）：固定分配，非磁盘剩余空间；只拦普通用户。
		// 云空间全部用户临时+永久文件合计数；图床（image_assets）不计入。
		globalTransient, err := model.SumPlaygroundImageSizesGlobal(false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		globalPermanent, err := model.SumPlaygroundImageSizesGlobal(true)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if globalTransient+globalPermanent+int64(len(data)) > int64(setting.UserSpaceGlobalMaxMB)<<20 {
			common.ApiErrorMsg(c, "云空间容量已满")
			return
		}
	}

	name := filepath.Base(fileHeader.Filename)
	if runes := []rune(name); len(runes) > 255 {
		name = string(runes[:255])
	}

	asset := &model.PlaygroundImage{
		Name:      name,
		Ext:       ext,
		Size:      int64(len(data)),
		UserId:    userId,
		Permanent: permanent,
	}
	if err := persistPlaygroundImage(asset, data); err != nil {
		common.SysError("failed to save playground image: " + err.Error())
		common.ApiErrorMsg(c, "文件保存失败")
		return
	}
	common.ApiSuccess(c, gin.H{
		"id":        asset.Id,
		"url":       fmt.Sprintf("/api/playground/images/%d", asset.Id),
		"permanent": asset.Permanent,
	})
}

// GetPlaygroundImage 按归属校验后返回图片字节。私有图片仅本人可读。
func GetPlaygroundImage(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的图片 ID")
		return
	}

	asset, err := model.GetPlaygroundImageById(id)
	if err != nil {
		common.ApiErrorMsg(c, "图片不存在")
		return
	}
	if asset.UserId != userId {
		c.JSON(403, gin.H{"success": false, "message": "无权访问该图片"})
		return
	}

	data, err := os.ReadFile(playgroundImageFilepath(asset.Id, asset.Ext))
	if err != nil {
		common.SysError(fmt.Sprintf("failed to read playground image %d: %s", id, err.Error()))
		common.ApiErrorMsg(c, "图片文件不存在")
		return
	}

	contentType := mime.TypeByExtension("." + asset.Ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Content-Disposition", "inline")
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, contentType, data)
}

// ListPlaygroundImages 返回当前用户的图片列表（最新在前）。?permanent=true 时只看永久收藏。
func ListPlaygroundImages(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	permanentOnly, _ := strconv.ParseBool(c.DefaultQuery("permanent", "true"))

	assets, err := model.ListPlaygroundImagesByUser(userId, permanentOnly, 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	type imageItem struct {
		Id          int    `json:"id"`
		Name        string `json:"name"`
		Ext         string `json:"ext"`
		Url         string `json:"url"`
		Size        int64  `json:"size"`
		Permanent   bool   `json:"permanent"`
		CreatedTime int64  `json:"created_time"`
	}
	items := make([]imageItem, 0, len(assets))
	for _, asset := range assets {
		items = append(items, imageItem{
			Id:          asset.Id,
			Name:        asset.Name,
			Ext:         asset.Ext,
			Url:         fmt.Sprintf("/api/playground/images/%d", asset.Id),
			Size:        asset.Size,
			Permanent:   asset.Permanent,
			CreatedTime: asset.CreatedTime,
		})
	}
	common.ApiSuccess(c, items)
}

// DeletePlaygroundImage 软删元数据行并尽力删除磁盘文件。仅本人可删。
func DeletePlaygroundImage(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的图片 ID")
		return
	}

	asset, err := model.GetPlaygroundImageById(id)
	if err != nil {
		common.ApiErrorMsg(c, "图片不存在")
		return
	}
	if asset.UserId != userId {
		c.JSON(403, gin.H{"success": false, "message": "无权删除该图片"})
		return
	}

	if err := model.DeletePlaygroundImageById(id); err != nil {
		common.ApiError(c, err)
		return
	}

	if err := os.Remove(playgroundImageFilepath(asset.Id, asset.Ext)); err != nil && !os.IsNotExist(err) {
		common.SysError(fmt.Sprintf("failed to remove playground image file %d: %s", id, err.Error()))
	}
	common.ApiSuccess(c, nil)
}

// AdminPlaygroundImageStats 管理员查看全局游乐场图片用量（临时 vs 永久 + 按用户 Top）。
func AdminPlaygroundImageStats(c *gin.Context) {
	transientCount, err := model.CountPlaygroundImagesGlobal(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	transientBytes, err := model.SumPlaygroundImageSizesGlobal(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	permanentCount, err := model.CountPlaygroundImagesGlobal(true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	permanentBytes, err := model.SumPlaygroundImageSizesGlobal(true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	topUsers, err := model.GroupPlaygroundImageUsageByUser(10)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if topUsers == nil {
		topUsers = []model.PlaygroundImageUserUsage{}
	}

	common.ApiSuccess(c, gin.H{
		"transient": gin.H{
			"count":       transientCount,
			"total_bytes": transientBytes,
			"ttl_days":    setting.PlaygroundImageTTLDays,
		},
		"permanent": gin.H{
			"count":       permanentCount,
			"total_bytes": permanentBytes,
		},
		"top_users": topUsers,
	})
}

// AdminCleanupPlaygroundImages 管理员手动清理临时图片。
// 请求体 {"all": true} 清空所有临时图片；缺省/为 false 只清过期的。
func AdminCleanupPlaygroundImages(c *gin.Context) {
	var request struct {
		All bool `json:"all"`
	}
	// 无 body（或解析失败）时按「只清过期」处理。
	_ = common.DecodeJson(c.Request.Body, &request)

	var cutoff int64
	if request.All {
		cutoff = time.Now().Unix() // 早于现在 = 全部临时图片
	} else {
		ttlDays := setting.PlaygroundImageTTLDays
		if ttlDays < 1 {
			ttlDays = 1
		}
		cutoff = time.Now().Add(-time.Duration(ttlDays) * 24 * time.Hour).Unix()
	}

	deleted, err := service.RunPlaygroundImageCleanup(cutoff)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}

// ClearUserTransientPlaygroundImages 清空当前用户的全部临时图片（不含永久收藏）。
// 真删释放容量；云空间页临时区不展示明细，只提供此批量清理。
func ClearUserTransientPlaygroundImages(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	assets, err := model.ListTransientPlaygroundImagesByUser(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(assets) == 0 {
		common.ApiSuccess(c, gin.H{"deleted": 0})
		return
	}

	ids := make([]int, 0, len(assets))
	for _, asset := range assets {
		ids = append(ids, asset.Id)
		if err := os.Remove(playgroundImageFilepath(asset.Id, asset.Ext)); err != nil && !os.IsNotExist(err) {
			common.SysError(fmt.Sprintf("failed to remove playground image file %d: %s", asset.Id, err.Error()))
		}
	}
	deleted, err := model.HardDeletePlaygroundImagesByIds(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}
