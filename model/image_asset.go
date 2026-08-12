package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// ImageAsset 图床图片元数据：图片本体存磁盘 <UploadDir>/images/<id>.<ext>,
// 由现有静态路由 /uploads/ 对外服务（见 router/web-router.go）。仅 root 可上传/删除。
type ImageAsset struct {
	Id          int            `json:"id" gorm:"primaryKey"`
	Name        string         `json:"name" gorm:"size:255"` // 原始文件名（仅展示用）
	Ext         string         `json:"ext" gorm:"size:8"`
	Size        int64          `json:"size" gorm:"bigint"`
	UploaderId  int            `json:"uploader_id"`
	CreatedTime int64          `json:"created_time" gorm:"bigint"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

func (ImageAsset) TableName() string { return "image_assets" }

// InsertImageAsset 新建图片记录，Id 由数据库自增生成。
func InsertImageAsset(asset *ImageAsset) error {
	asset.CreatedTime = common.GetTimestamp()
	return DB.Create(asset).Error
}

// GetImageAssetById 按 Id 查询图片记录（不含软删行）。
func GetImageAssetById(id int) (*ImageAsset, error) {
	var asset ImageAsset
	if err := DB.Where("id = ?", id).First(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

// GetAllImageAssets 返回全部图片记录（不含软删行），按 id 倒序（最新在前）。
func GetAllImageAssets() ([]*ImageAsset, error) {
	var assets []*ImageAsset
	if err := DB.Order("id DESC").Find(&assets).Error; err != nil {
		return nil, err
	}
	return assets, nil
}

// DeleteImageAssetById 软删图片记录。
func DeleteImageAssetById(id int) error {
	return DB.Delete(&ImageAsset{}, id).Error
}
