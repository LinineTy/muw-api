package controller

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"  // register GIF decoder for format detection
	_ "image/jpeg" // register JPEG decoder for format detection
	_ "image/png"  // register PNG decoder for format detection
	"io"
	"os"
	"path/filepath"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp" // register WebP decoder for format detection
)

const maxImageSize = 5 << 20 // 5MB

// imageExtByFormat maps image.Decode's format name to a stable file extension.
var imageExtByFormat = map[string]string{
	"png":  "png",
	"jpeg": "jpg",
	"gif":  "gif",
	"webp": "webp",
}

// imageURL 生成图片对外访问的相对路径（由现有 /uploads/ 静态路由服务）。
func imageURL(asset *model.ImageAsset) string {
	return fmt.Sprintf("/uploads/images/%d.%s", asset.Id, asset.Ext)
}

// UploadImage 接收 multipart 图片（字段 "file"），校验后落盘到
// <UploadDir>/images/<id>.<ext> 并写入元数据行。仅 root 可调用（路由层鉴权）。
func UploadImage(c *gin.Context) {
	uploaderID := c.GetInt("id")
	if uploaderID <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "缺少文件字段")
		return
	}
	if fileHeader.Size > maxImageSize {
		common.ApiErrorMsg(c, "图片文件不能超过 5MB")
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

	// 解码校验真图片并取格式，拒绝 SVG 等可执行内容。
	_, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		common.ApiErrorMsg(c, "仅支持 PNG/JPEG/GIF/WebP 图片")
		return
	}
	ext, ok := imageExtByFormat[format]
	if !ok {
		common.ApiErrorMsg(c, "仅支持 PNG/JPEG/GIF/WebP 图片")
		return
	}

	// 原始文件名仅作展示；过长时按 rune 截断，避免超出 varchar(255)。
	name := filepath.Base(fileHeader.Filename)
	if runes := []rune(name); len(runes) > 255 {
		name = string(runes[:255])
	}

	asset := &model.ImageAsset{
		Name:       name,
		Ext:        ext,
		Size:       int64(len(data)),
		UploaderId: uploaderID,
	}
	if err := model.InsertImageAsset(asset); err != nil {
		common.ApiError(c, err)
		return
	}

	imageDir := filepath.Join(common.UploadDir, "images")
	if err := os.MkdirAll(imageDir, 0o755); err != nil {
		_ = model.DeleteImageAssetById(asset.Id) // 回滚元数据行
		common.SysError(fmt.Sprintf("failed to create image dir: %s", err.Error()))
		common.ApiErrorMsg(c, "存储目录不可写")
		return
	}

	filename := fmt.Sprintf("%d.%s", asset.Id, ext)
	if err := os.WriteFile(filepath.Join(imageDir, filename), data, 0o644); err != nil {
		_ = model.DeleteImageAssetById(asset.Id)
		common.SysError(fmt.Sprintf("failed to write image file: %s", err.Error()))
		common.ApiErrorMsg(c, "图片保存失败")
		return
	}

	common.ApiSuccess(c, gin.H{"id": asset.Id, "url": imageURL(asset)})
}

// ListImages 返回全部图床图片（最新在前）。
func ListImages(c *gin.Context) {
	assets, err := model.GetAllImageAssets()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	type imageItem struct {
		Id          int    `json:"id"`
		Name        string `json:"name"`
		Url         string `json:"url"`
		Size        int64  `json:"size"`
		UploaderId  int    `json:"uploader_id"`
		CreatedTime int64  `json:"created_time"`
	}
	items := make([]imageItem, 0, len(assets))
	for _, asset := range assets {
		items = append(items, imageItem{
			Id:          asset.Id,
			Name:        asset.Name,
			Url:         imageURL(asset),
			Size:        asset.Size,
			UploaderId:  asset.UploaderId,
			CreatedTime: asset.CreatedTime,
		})
	}
	common.ApiSuccess(c, items)
}

// DeleteImage 软删元数据行并尽力删除磁盘文件。软删在前，保证列表不再出现；
// 残留的孤儿文件无害。
func DeleteImage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的图片 ID")
		return
	}

	asset, err := model.GetImageAssetById(id)
	if err != nil {
		common.ApiErrorMsg(c, "图片不存在")
		return
	}

	if err := model.DeleteImageAssetById(id); err != nil {
		common.ApiError(c, err)
		return
	}

	filename := fmt.Sprintf("%d.%s", asset.Id, asset.Ext)
	if err := os.Remove(filepath.Join(common.UploadDir, "images", filename)); err != nil && !os.IsNotExist(err) {
		common.SysError(fmt.Sprintf("failed to remove image file %s: %s", filename, err.Error()))
	}
	common.ApiSuccess(c, nil)
}
