package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// PlaygroundImage 游乐场图片元数据：图片本体存私有目录
// <PrivateUploadDir>/playground-images/<id>.<ext>，仅通过鉴权接口
// /api/playground/images/:id 按归属读取，不对 /uploads/ 静态路由暴露。
// Permanent=true 表示用户永久收藏（生成图「保存」），跳过 TTL GC。
type PlaygroundImage struct {
	Id          int            `json:"id" gorm:"primaryKey"`
	Name        string         `json:"name" gorm:"size:255"` // 原始文件名（仅展示用）
	Ext         string         `json:"ext" gorm:"size:8"`
	Size        int64          `json:"size" gorm:"bigint"`
	UserId      int            `json:"user_id"`
	Permanent   bool           `json:"permanent"` // Go 零值 false，不加 gorm default 标签（跨库迁移安全）
	CreatedTime int64          `json:"created_time" gorm:"bigint"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

func (PlaygroundImage) TableName() string { return "playground_images" }

// InsertPlaygroundImage 新建图片记录，Id 由数据库自增生成。
func InsertPlaygroundImage(asset *PlaygroundImage) error {
	asset.CreatedTime = common.GetTimestamp()
	return DB.Create(asset).Error
}

// CountPlaygroundImagesByUser 统计某用户的活跃图片数（软删自动排除）。
func CountPlaygroundImagesByUser(userId int, permanent bool) (int64, error) {
	var count int64
	err := DB.Model(&PlaygroundImage{}).
		Where("user_id = ? AND permanent = ?", userId, permanent).
		Count(&count).Error
	return count, err
}

// SumPlaygroundImageSizesByUser 统计某用户的活跃图片总字节数（软删自动排除）。
func SumPlaygroundImageSizesByUser(userId int, permanent bool) (int64, error) {
	var sum int64
	err := DB.Model(&PlaygroundImage{}).
		Where("user_id = ? AND permanent = ?", userId, permanent).
		Select("COALESCE(SUM(size), 0)").
		Scan(&sum).Error
	return sum, err
}

// SumPlaygroundImageSizesByUserAll 统计某用户临时+永久合并的总字节数（软删排除）。
// 云空间统一容量模型按此计算已占用空间。
func SumPlaygroundImageSizesByUserAll(userId int) (int64, error) {
	var sum int64
	err := DB.Model(&PlaygroundImage{}).
		Where("user_id = ?", userId).
		Select("COALESCE(SUM(size), 0)").
		Scan(&sum).Error
	return sum, err
}

// ListPlaygroundImagesByUser 返回某用户图片记录（最新在前）；permanentOnly 时只看永久收藏。
func ListPlaygroundImagesByUser(userId int, permanentOnly bool, limit int) ([]*PlaygroundImage, error) {
	var assets []*PlaygroundImage
	query := DB.Where("user_id = ?", userId)
	if permanentOnly {
		query = query.Where("permanent = ?", true)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Order("id DESC").Find(&assets).Error; err != nil {
		return nil, err
	}
	return assets, nil
}

// ListTransientPlaygroundImagesByUser 返回某用户全部临时（非永久）图片，供用户级「清空临时」。
func ListTransientPlaygroundImagesByUser(userId int) ([]*PlaygroundImage, error) {
	var assets []*PlaygroundImage
	err := DB.Where("user_id = ? AND permanent = ?", userId, false).
		Order("id DESC").
		Find(&assets).Error
	return assets, err
}

// PlaygroundImageUserUsage 单用户用量汇总（管理员统计用）。
type PlaygroundImageUserUsage struct {
	UserId     int   `json:"user_id"`
	Count      int64 `json:"count"`
	TotalBytes int64 `json:"total_bytes"`
}

// CountPlaygroundImagesGlobal 全局统计指定类型图片总数（软删自动排除）。
func CountPlaygroundImagesGlobal(permanent bool) (int64, error) {
	var count int64
	err := DB.Model(&PlaygroundImage{}).
		Where("permanent = ?", permanent).
		Count(&count).Error
	return count, err
}

// SumPlaygroundImageSizesGlobal 全局统计指定类型图片总字节数。
func SumPlaygroundImageSizesGlobal(permanent bool) (int64, error) {
	var sum int64
	err := DB.Model(&PlaygroundImage{}).
		Where("permanent = ?", permanent).
		Select("COALESCE(SUM(size), 0)").
		Scan(&sum).Error
	return sum, err
}

// GroupPlaygroundImageUsageByUser 按用户汇总（不分永久/临时），按字节降序取前 limit。
func GroupPlaygroundImageUsageByUser(limit int) ([]PlaygroundImageUserUsage, error) {
	var usages []PlaygroundImageUserUsage
	query := DB.Model(&PlaygroundImage{}).
		Select("user_id, COUNT(*) AS count, COALESCE(SUM(size), 0) AS total_bytes").
		Group("user_id").
		Order("total_bytes DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Scan(&usages).Error; err != nil {
		return nil, err
	}
	return usages, nil
}

// GetPlaygroundImageById 按 Id 查询图片记录（不含软删行）。
func GetPlaygroundImageById(id int) (*PlaygroundImage, error) {
	var asset PlaygroundImage
	if err := DB.Where("id = ?", id).First(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

// DeletePlaygroundImageById 软删图片记录。
func DeletePlaygroundImageById(id int) error {
	return DB.Delete(&PlaygroundImage{}, id).Error
}

// ListExpiredPlaygroundImages 返回超过 cutoff 的过期临时图片（Unscoped 也覆盖软删残留，
// 供 GC 硬删清理）。永久收藏永久跳过。
func ListExpiredPlaygroundImages(cutoff int64, limit int) ([]*PlaygroundImage, error) {
	var assets []*PlaygroundImage
	query := DB.Unscoped().
		Where("created_time < ? AND permanent = ?", cutoff, false)
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&assets).Error; err != nil {
		return nil, err
	}
	return assets, nil
}

// HardDeletePlaygroundImagesByIds 硬删（Unscoped）指定记录，避免堆积在软删区。
func HardDeletePlaygroundImagesByIds(ids []int) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	result := DB.Unscoped().Where("id IN ?", ids).Delete(&PlaygroundImage{})
	return result.RowsAffected, result.Error
}
