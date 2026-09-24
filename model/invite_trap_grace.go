// @muw-owned
package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// InviteTrapGrace 钓鱼邀请码（Redemption.IsTrap）命中后的宽限记录（自研）。
//
// 命中钩子不再立刻停用账号，而是先落一条宽限记录：用户在宽限期内用**有效邀请码**
// 完成激活即结清（ResolvedReason=activated）；到期仍未激活的，由定时任务统一停用
// 账号（ResolvedReason=expired）。
//
// 该表同时是「谁踩过钩子」的台账：处置时间与原因都留在行内，误伤时按
// resolved_reason='expired' 一条 SQL 即可批量放行，不必回翻审计表。
type InviteTrapGrace struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	UserId       int    `json:"user_id" gorm:"index"`
	RedemptionId int    `json:"redemption_id"`
	HitAt        int64  `json:"hit_at"`
	ExpireAt     int64  `json:"expire_at" gorm:"index"`
	HitCount     int    `json:"hit_count"`
	Ip           string `json:"ip" gorm:"type:varchar(64)"`
	UserAgent    string `json:"user_agent" gorm:"type:varchar(255)"`
	ResolvedAt   int64  `json:"resolved_at"`
	// ResolvedReason: "" 进行中 / activated 用有效邀请码激活成功 /
	// verified 同一次提交通过人机校验（真人误踩）/ expired 到期未激活已停用
	ResolvedReason string `json:"resolved_reason" gorm:"type:varchar(32)"`
}

// 宽限记录的结清原因。
const (
	InviteTrapGraceReasonActivated = "activated"
	InviteTrapGraceReasonExpired   = "expired"
	// InviteTrapGraceReasonVerified 命中钩子的同一次提交里通过了人机校验（PoW）：
	// 判为真人误踩，宽限记录当场结清，账号不会被到期停用。
	InviteTrapGraceReasonVerified = "verified"
)

func (InviteTrapGrace) TableName() string { return "invite_trap_graces" }

// EnsureInviteTrapGraceTable 幂等建 invite_trap_graces 表：自研新表，存量库走
// 「跳过 AutoMigrate」路径时必须在这里显式补建，否则读写会报 no such table。
func ensureInviteTrapGraceTable(db *gorm.DB) error {
	if db.Migrator().HasTable(&InviteTrapGrace{}) {
		return nil
	}
	return db.Migrator().CreateTable(&InviteTrapGrace{})
}

// StartInviteTrapGrace 记录一次钩子命中。
//
// 同一用户已有未结记录时**不重置**截止时间（只累计命中次数并刷新来源信息），
// 否则反复提交钩子码即可无限续期；没有未结记录时按 common.InviteTrapGraceSeconds
// 计算截止时间。
func StartInviteTrapGrace(userId int, redemptionId int, ip string, userAgent string) (*InviteTrapGrace, error) {
	if userId == 0 {
		return nil, errors.New("id 为空！")
	}
	userAgent = trapGraceTruncate(userAgent, 255)
	ip = trapGraceTruncate(ip, 64)
	var record InviteTrapGrace
	err := DB.Where("user_id = ? AND resolved_at = 0", userId).First(&record).Error
	if err == nil {
		record.HitCount += 1
		record.Ip = ip
		record.UserAgent = userAgent
		if err := DB.Model(&record).
			Select("hit_count", "ip", "user_agent").
			Updates(&record).Error; err != nil {
			return nil, err
		}
		return &record, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := common.GetTimestamp()
	record = InviteTrapGrace{
		UserId:       userId,
		RedemptionId: redemptionId,
		HitAt:        now,
		ExpireAt:     now + int64(common.InviteTrapGraceWindow()),
		HitCount:     1,
		Ip:           ip,
		UserAgent:    userAgent,
	}
	if err := DB.Create(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// GetUnresolvedInviteTrapGrace 取该用户未结清的宽限记录；没有则返回 (nil, nil)。
func GetUnresolvedInviteTrapGrace(userId int) (*InviteTrapGrace, error) {
	if userId == 0 {
		return nil, nil
	}
	var record InviteTrapGrace
	err := DB.Where("user_id = ? AND resolved_at = 0", userId).First(&record).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &record, nil
}

// ResolveInviteTrapGrace 结清该用户全部未结记录（幂等：没有未结记录时是空操作）。
func ResolveInviteTrapGrace(userId int, reason string) error {
	if userId == 0 {
		return errors.New("id 为空！")
	}
	return DB.Model(&InviteTrapGrace{}).
		Where("user_id = ? AND resolved_at = 0", userId).
		Updates(map[string]any{
			"resolved_at":     common.GetTimestamp(),
			"resolved_reason": reason,
		}).Error
}

// ListExpiredInviteTrapGraces 列出已到期但尚未结清的宽限记录（定时任务批量处置用）。
func ListExpiredInviteTrapGraces(now int64, limit int) ([]*InviteTrapGrace, error) {
	if limit <= 0 {
		limit = 100
	}
	var records []*InviteTrapGrace
	err := DB.Where("resolved_at = 0 AND expire_at <= ?", now).
		Order("expire_at").
		Limit(limit).
		Find(&records).Error
	return records, err
}

// CountUnresolvedInviteTrapGraces 统计未结清的宽限记录数（运维核对用）。
func CountUnresolvedInviteTrapGraces() (int64, error) {
	var count int64
	err := DB.Model(&InviteTrapGrace{}).Where("resolved_at = 0").Count(&count).Error
	return count, err
}

// trapGraceTruncate 按字节上限截断（IP/UA 落库用，避免超长值撑爆列）。
func trapGraceTruncate(value string, max int) string {
	if max <= 0 || len(value) <= max {
		return value
	}
	return value[:max]
}
