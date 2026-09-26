// @muw-owned
package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// OIDCUsageStat 按 (应用, 用户) 记一行使用计数：统计"谁用过、用了多少次、最后什么时候"。
// 用计数表而不是聚合审计日志：统计口径不受日志清理策略影响，查询也便宜。
type OIDCUsageStat struct {
	Id           int    `json:"id"`
	ClientId     string `json:"client_id" gorm:"type:varchar(64);uniqueIndex:idx_oidc_usage_client_user,priority:1"`
	UserId       int    `json:"user_id" gorm:"uniqueIndex:idx_oidc_usage_client_user,priority:2;index"`
	TokenCount   int64  `json:"token_count" gorm:"type:bigint;not null;default:0"`
	LastIssuedAt int64  `json:"last_issued_at" gorm:"type:bigint;index"`
	CreatedAt    int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt    int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (OIDCUsageStat) TableName() string { return "oidc_usage_stats" }

// RecordOIDCTokenIssued 记一次令牌签发。先尝试自增，未命中再建行（并发下靠复合唯一索引兜底）。
func RecordOIDCTokenIssued(clientId string, userId int, now int64) error {
	result := DB.Model(&OIDCUsageStat{}).
		Where("client_id = ? AND user_id = ?", clientId, userId).
		Updates(map[string]any{
			"token_count":    gorm.Expr("token_count + 1"),
			"last_issued_at": now,
			"updated_at":     now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		return nil
	}
	err := DB.Create(&OIDCUsageStat{ClientId: clientId, UserId: userId, TokenCount: 1,
		LastIssuedAt: now, CreatedAt: now, UpdatedAt: now}).Error
	if err != nil && !errors.Is(err, gorm.ErrDuplicatedKey) {
		// 并发首建撞唯一索引时重试一次自增。
		return DB.Model(&OIDCUsageStat{}).
			Where("client_id = ? AND user_id = ?", clientId, userId).
			Updates(map[string]any{"token_count": gorm.Expr("token_count + 1"), "last_issued_at": now, "updated_at": now}).Error
	}
	return err
}

// OIDCApplicationUsage 返回某个应用的逐用户使用行（应用详情页展示"谁在用、用了多少次"）。
func OIDCApplicationUsage(clientId string) ([]*OIDCUsageStat, error) {
	var rows []*OIDCUsageStat
	err := DB.Where("client_id = ?", clientId).Order("last_issued_at DESC").Limit(50).Find(&rows).Error
	return rows, err
}

// EnsureOIDCUsageStatTable 幂等建计数表（给"已最新版本"的库补表）。
func EnsureOIDCUsageStatTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&OIDCUsageStat{}) {
		return nil
	}
	return db.Migrator().CreateTable(&OIDCUsageStat{})
}

var _ = common.GetTimestamp
