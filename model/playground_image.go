package model

import (
	"errors"

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
	UserId      int            `json:"user_id" gorm:"index:idx_uid_permanent,priority:1"` // 覆盖按用户统计/列表
	Permanent   bool           `json:"permanent" gorm:"index:idx_uid_permanent,priority:2;index:idx_playground_image_permanent"` // Go 零值 false，不加 gorm default 标签（跨库迁移安全）
	CreatedTime int64          `json:"created_time" gorm:"bigint;index"`                  // 覆盖 TTL 过期清理
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

func (PlaygroundImage) TableName() string { return "playground_images" }

// InsertPlaygroundImage 新建图片记录，Id 由数据库自增生成。
func InsertPlaygroundImage(asset *PlaygroundImage) error {
	asset.CreatedTime = common.GetTimestamp()
	return DB.Create(asset).Error
}

var (
	// ErrPlaygroundImageSpaceInsufficient 用户云空间容量不足（原子校验返回）。
	ErrPlaygroundImageSpaceInsufficient = errors.New("playground image space insufficient")
	// ErrPlaygroundImageSpaceGlobalFull 云空间总分配量（全局红线）已满（原子校验返回）。
	ErrPlaygroundImageSpaceGlobalFull = errors.New("playground image global space full")
)

// InsertPlaygroundImageWithCapacity 原子地校验并插入图片：事务内锁定用户行
// （FOR UPDATE，SQLite 跳过但单写者天然串行），在锁内统计该用户已占用与全局
// 占用，命中用户容量或全局红线时拒绝，否则插入。同一用户的并发上传因行锁
// 串行化，「判断容量 → 写入」不再互相覆盖（TOCTOU）；全局红线跨用户无法靠单
// 用户行锁串行，仍为读-写，并发超限幅度受并发数×单图上限约束，有界可接受。
// userCapacity/globalMax 由调用方传入（model 不依赖 setting）。
func InsertPlaygroundImageWithCapacity(asset *PlaygroundImage, userCapacity int64, globalMax int64) error {
	asset.CreatedTime = common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		var locked User
		if err := lockForUpdate(tx).Where("id = ?", asset.UserId).First(&locked).Error; err != nil {
			return err
		}
		var used int64
		if err := tx.Model(&PlaygroundImage{}).Where("user_id = ?", asset.UserId).
			Select("COALESCE(SUM(size), 0)").Scan(&used).Error; err != nil {
			return err
		}
		if used+asset.Size > userCapacity {
			return ErrPlaygroundImageSpaceInsufficient
		}
		var global int64
		if err := tx.Model(&PlaygroundImage{}).
			Select("COALESCE(SUM(size), 0)").Scan(&global).Error; err != nil {
			return err
		}
		if global+asset.Size > globalMax {
			return ErrPlaygroundImageSpaceGlobalFull
		}
		return tx.Create(asset).Error
	})
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

// SumPlaygroundImageSizesByUserIds 批量统计一批用户的云空间占用（临时+永久合并），
// 供用户管理列表展示每用户用量。
func SumPlaygroundImageSizesByUserIds(userIds []int) (map[int]int64, error) {
	if len(userIds) == 0 {
		return map[int]int64{}, nil
	}
	type usageRow struct {
		UserId int   `gorm:"column:user_id"`
		Total  int64 `gorm:"column:total"`
	}
	var rows []usageRow
	err := DB.Model(&PlaygroundImage{}).
		Where("user_id IN ?", userIds).
		Select("user_id, COALESCE(SUM(size), 0) AS total").
		Group("user_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	usage := make(map[int]int64, len(rows))
	for _, row := range rows {
		usage[row.UserId] = row.Total
	}
	return usage, nil
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
