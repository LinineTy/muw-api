/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
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
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const maxAvatarSize = 5 << 20 // 5MB

// avatarExtByFormat maps image.Decode's format name to a stable file extension.
var avatarExtByFormat = map[string]string{
	"png":  "png",
	"jpeg": "jpg",
	"gif":  "gif",
}

// UploadAvatar accepts a multipart image (field "file"), validates it, stores it
// under <UploadDir>/avatar/<userId>.<ext> and records the URL on the user row.
// Re-uploading overwrites the previous file; the avatar is marked as custom so
// a later OAuth login no longer overwrites it.
func UploadAvatar(c *gin.Context) {
	userID := c.GetInt("id")
	if userID <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "缺少文件字段")
		return
	}
	if fileHeader.Size > maxAvatarSize {
		common.ApiErrorMsg(c, "头像文件不能超过 5MB")
		return
	}

	src, err := fileHeader.Open()
	if err != nil {
		common.ApiErrorMsg(c, "无法读取上传文件")
		return
	}
	defer src.Close()

	data, err := io.ReadAll(io.LimitReader(src, maxAvatarSize+1))
	if err != nil {
		common.ApiErrorMsg(c, "无法读取上传文件")
		return
	}
	if len(data) > maxAvatarSize {
		common.ApiErrorMsg(c, "头像文件不能超过 5MB")
		return
	}

	// Decode to verify it is a real image and to learn the format.
	_, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		common.ApiErrorMsg(c, "头像必须是 PNG/JPEG/GIF 图片")
		return
	}
	ext, ok := avatarExtByFormat[format]
	if !ok {
		common.ApiErrorMsg(c, "头像必须是 PNG/JPEG/GIF 图片")
		return
	}

	avatarDir := filepath.Join(common.UploadDir, "avatar")
	if err := os.MkdirAll(avatarDir, 0o755); err != nil {
		common.SysError(fmt.Sprintf("failed to create avatar dir: %s", err.Error()))
		common.ApiErrorMsg(c, "存储目录不可写")
		return
	}

	// Remove any previous avatar of this user with a different extension so the
	// deterministic <userId>.<ext> filename never leaves orphaned files behind.
	filename := fmt.Sprintf("%d.%s", userID, ext)
	if entries, err := os.ReadDir(avatarDir); err == nil {
		prefix := fmt.Sprintf("%d.", userID)
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			if strings.HasPrefix(entry.Name(), prefix) && entry.Name() != filename {
				_ = os.Remove(filepath.Join(avatarDir, entry.Name()))
			}
		}
	}

	if err := os.WriteFile(filepath.Join(avatarDir, filename), data, 0o644); err != nil {
		common.SysError(fmt.Sprintf("failed to write avatar file: %s", err.Error()))
		common.ApiErrorMsg(c, "头像保存失败")
		return
	}

	url := "/uploads/avatar/" + filename
	if err := model.DB.Model(&model.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
		"avatar":        url,
		"avatar_custom": true,
	}).Error; err != nil {
		common.SysError(fmt.Sprintf("failed to persist avatar for user %d: %s", userID, err.Error()))
		common.ApiErrorMsg(c, "头像保存失败")
		return
	}

	common.ApiSuccess(c, gin.H{"url": url})
}
