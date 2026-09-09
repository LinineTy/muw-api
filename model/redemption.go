package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
)

type Redemption struct {
	Id           int            `json:"id"`
	UserId       int            `json:"user_id"`
	Key          string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status       int            `json:"status" gorm:"default:1"`
	Name         string         `json:"name" gorm:"index"`
	Quota        int            `json:"quota" gorm:"default:100"`
	Type         int            `json:"type" gorm:"default:1"`   // 用途：1=兑换额度，2=注册邀请（创建后不可改）
	MaxUses      int            `json:"max_uses" gorm:"default:1"` // 可用次数，1 即一次性（创建后不可改）
	UsedCount    int            `json:"used_count" gorm:"default:0"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime int64          `json:"redeemed_time" gorm:"bigint"`
	Count        int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId   int            `json:"used_user_id"`
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `json:"expired_time" gorm:"bigint"` // 过期时间，0 表示不过期
}

// RedemptionUse 记录每个码被哪些用户使用过。(redemption_id, user_id) 唯一，保证
// 同一用户不能重复兑换同一码，即使码的可用次数（max_uses）尚未用满。used_count
// 仍表示总使用次数，与 redemption_uses 的行数一致。
type RedemptionUse struct {
	Id           int   `json:"id"`
	RedemptionId int   `json:"redemption_id" gorm:"index;uniqueIndex:idx_redemption_use"`
	UserId       int   `json:"user_id" gorm:"index;uniqueIndex:idx_redemption_use"`
	UsedTime     int64 `json:"used_time" gorm:"bigint"`
}

func (RedemptionUse) TableName() string { return "redemption_uses" }

// isDuplicateKeyError 判断是否为唯一约束冲突（跨 SQLite/MySQL/PostgreSQL）。
// 生产 gorm.Config 未开 TranslateError，gorm.ErrDuplicatedKey 不会自动命中，
// 需按各驱动错误文本兜底。
func isDuplicateKeyError(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") || // SQLite
		strings.Contains(msg, "duplicate entry") || // MySQL
		strings.Contains(msg, "duplicate key") // PostgreSQL
}

func GetAllRedemptions(startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 获取总数
	err = tx.Model(&Redemption{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func SearchRedemptions(keyword string, status string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&Redemption{})

	if keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil {
			query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
		} else {
			query = query.Where("name LIKE ?", keyword+"%")
		}
	}

	if status != "" {
		now := common.GetTimestamp()
		switch status {
		case "expired":
			query = query.Where(
				"status = ? AND expired_time != 0 AND expired_time < ?",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusEnabled):
			query = query.Where(
				"status = ? AND (expired_time = 0 OR expired_time >= ?)",
				common.RedemptionCodeStatusEnabled,
				now,
			)
		case strconv.Itoa(common.RedemptionCodeStatusDisabled):
			query = query.Where("status = ?", common.RedemptionCodeStatusDisabled)
		case strconv.Itoa(common.RedemptionCodeStatusUsed):
			query = query.Where("status = ?", common.RedemptionCodeStatusUsed)
		}
	}

	// Get total count
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated data
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	var err error = nil
	err = DB.First(&redemption, "id = ?", id).Error
	return &redemption, err
}

var (
	ErrRedemptionInvalid      = errors.New("无效的兑换码")
	ErrRedemptionUsed         = errors.New("该兑换码已被使用")
	ErrRedemptionDisabled     = errors.New("该兑换码已被禁用")
	ErrRedemptionExpired      = errors.New("该兑换码已过期")
	ErrRedemptionTypeMismatch = errors.New("该兑换码不可用于兑换额度")
)

func Redeem(key string, userId int) (quota int, err error) {
	if key == "" {
		return 0, ErrRedemptionInvalid
	}
	if userId == 0 {
		return 0, ErrRedeemFailed
	}
	redemption := &Redemption{}

	keyCol := "`key`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		keyCol = `"key"`
	}
	common.RandomSleep()
	err = DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(keyCol+" = ?", key).First(redemption).Error
		if err != nil {
			return ErrRedemptionInvalid
		}
		if redemption.Status == common.RedemptionCodeStatusDisabled {
			return ErrRedemptionDisabled
		}
		if redemption.Status != common.RedemptionCodeStatusEnabled {
			return ErrRedemptionUsed
		}
		if redemption.Type != common.RedemptionCodeTypeTopup {
			return ErrRedemptionTypeMismatch
		}
		if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
			return ErrRedemptionExpired
		}
		// Compare-and-swap on the remaining slots: only the transaction that
		// bumps used_count past max_uses wins the last slot, so a concurrent
		// redeem of the same code loses here even without a row lock (e.g. on
		// SQLite).
		updated, nowFull, err := consumeRedemptionSlot(tx, redemption, userId)
		if err != nil {
			return err
		}
		if !updated {
			return ErrRedemptionUsed
		}
		if nowFull {
			if err := tx.Model(&Redemption{}).
				Where("id = ? AND status = ?", redemption.Id, common.RedemptionCodeStatusEnabled).
				Update("status", common.RedemptionCodeStatusUsed).Error; err != nil {
				return err
			}
		}
		return creditTopUpQuota(tx, userId, redemption.Quota, nil)
	})
	if err != nil {
		common.SysError("redemption failed: " + err.Error())
		switch {
		case errors.Is(err, ErrRedemptionInvalid):
			return 0, ErrRedemptionInvalid
		case errors.Is(err, ErrRedemptionUsed):
			return 0, ErrRedemptionUsed
		case errors.Is(err, ErrRedemptionDisabled):
			return 0, ErrRedemptionDisabled
		case errors.Is(err, ErrRedemptionExpired):
			return 0, ErrRedemptionExpired
		case errors.Is(err, ErrRedemptionTypeMismatch):
			return 0, ErrRedemptionTypeMismatch
		default:
			return 0, ErrRedeemFailed
		}
	}
	syncCreditUserQuotaCache(userId, redemption.Quota, "redemption")
	RecordTopupLogWithPayment(userId, fmt.Sprintf("通过兑换码充值 %s，兑换码ID %d", logger.LogQuota(redemption.Quota), redemption.Id), "redemption")
	return redemption.Quota, nil
}

// consumeRedemptionSlot 原子占用一个可用槽位：CAS 使 used_count 递增（并刷新
// redeemed_time，usedUserId > 0 时记录使用者）。返回 updated（是否占用成功）与
// nowFull（是否已用满）。成功后必须在事务内重新读取 used_count 判满，否则 SQLite
// 下两个事务都可能读到旧值而漏翻 status。
func consumeRedemptionSlot(tx *gorm.DB, redemption *Redemption, usedUserId int) (updated bool, nowFull bool, err error) {
	fields := map[string]interface{}{
		"used_count":    gorm.Expr("used_count + 1"),
		"redeemed_time": common.GetTimestamp(),
	}
	if usedUserId > 0 {
		fields["used_user_id"] = usedUserId
	}
	result := tx.Model(&Redemption{}).
		Where("id = ? AND status = ? AND used_count < max_uses", redemption.Id, common.RedemptionCodeStatusEnabled).
		Updates(fields)
	if result.Error != nil {
		return false, false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, false, nil
	}
	if usedUserId > 0 {
		// 同一用户不能重复兑换同一码：先查存在即静默拒绝（不产生 SQL 冲突日志），
		// 再插入；唯一索引仅在并发下兜底，冲突时本事务（含刚递增的 used_count）回滚。
		var used RedemptionUse
		if err := tx.Where("redemption_id = ? AND user_id = ?", redemption.Id, usedUserId).
			Limit(1).Find(&used).Error; err != nil {
			return false, false, err
		}
		if used.Id != 0 {
			return false, false, nil
		}
		if err := tx.Create(&RedemptionUse{
			RedemptionId: redemption.Id,
			UserId:       usedUserId,
			UsedTime:     common.GetTimestamp(),
		}).Error; err != nil {
			if isDuplicateKeyError(err) {
				return false, false, nil
			}
			return false, false, err
		}
	}
	var usedCount int
	if err := tx.Model(&Redemption{}).Where("id = ?", redemption.Id).Pluck("used_count", &usedCount).Error; err != nil {
		return false, false, err
	}
	return true, usedCount >= redemption.MaxUses, nil
}

var (
	ErrInviteCodeInvalid  = errors.New("无效的邀请码")
	ErrInviteCodeDisabled = errors.New("邀请码已被禁用")
	ErrInviteCodeUsed     = errors.New("邀请码已被使用")
	ErrInviteCodeExpired  = errors.New("邀请码已过期")
)

// OccupyInviteCode 校验并占用一个注册邀请码名额（用途必须为邀请，Type=2）。
// 占用成功返回码 id；注册流程后续创建用户失败时调用 ReleaseInviteCode 回滚。
// 注意：占位时不写 used_user_id（注册用户的 id 此时未知），由调用方在用户创建
// 成功后调用 MarkInviteCodeUsed 回填。
func OccupyInviteCode(key string) (codeId int, err error) {
	if key == "" {
		return 0, ErrInviteCodeInvalid
	}
	redemption := &Redemption{}

	keyCol := "`key`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		keyCol = `"key"`
	}
	common.RandomSleep()
	err = DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(keyCol+" = ?", key).First(redemption).Error
		if err != nil {
			return ErrInviteCodeInvalid
		}
		if redemption.Type != common.RedemptionCodeTypeInvite {
			// 类型不符（这是兑换码而非邀请码）优先级最高：无论其状态如何都报"无效的邀请码"。
			return ErrInviteCodeInvalid
		}
		if redemption.Status == common.RedemptionCodeStatusDisabled {
			return ErrInviteCodeDisabled
		}
		if redemption.Status != common.RedemptionCodeStatusEnabled {
			return ErrInviteCodeUsed
		}
		if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
			return ErrInviteCodeExpired
		}
		updated, nowFull, err := consumeRedemptionSlot(tx, redemption, 0)
		if err != nil {
			return err
		}
		if !updated {
			return ErrInviteCodeUsed
		}
		if nowFull {
			return tx.Model(&Redemption{}).
				Where("id = ? AND status = ?", redemption.Id, common.RedemptionCodeStatusEnabled).
				Update("status", common.RedemptionCodeStatusUsed).Error
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return redemption.Id, nil
}

// ReleaseInviteCode 回滚一次邀请码占用（注册失败时调用），并把因本次占用占满而
// 翻为已用的码恢复为可注册状态。条件更新天然处理并发下其他占位导致的边界。
func ReleaseInviteCode(codeId int) error {
	if codeId == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&Redemption{}).
			Where("id = ? AND used_count > 0", codeId).
			Update("used_count", gorm.Expr("used_count - 1"))
		if result.Error != nil {
			return result.Error
		}
		return tx.Model(&Redemption{}).
			Where("id = ? AND status = ? AND used_count < max_uses", codeId, common.RedemptionCodeStatusUsed).
			Update("status", common.RedemptionCodeStatusEnabled).Error
	})
}

// MarkInviteCodeUsed 记录最后一位使用该邀请码注册成功的用户 id，并登记该用户对
// 该码的使用（redemption_uses），保持与兑换码一致的"每用户一次"语义。
func MarkInviteCodeUsed(codeId, userId int) error {
	if codeId == 0 || userId == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&RedemptionUse{
			RedemptionId: codeId,
			UserId:       userId,
			UsedTime:     common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		return tx.Model(&Redemption{}).Where("id = ?", codeId).Update("used_user_id", userId).Error
	})
}

func (redemption *Redemption) Insert() error {
	if redemption.Quota <= 0 {
		return errors.New("redemption quota must be positive")
	}
	if err := common.ValidateWalletQuota(redemption.Quota); err != nil {
		return err
	}
	var err error
	err = DB.Create(redemption).Error
	return err
}

func (redemption *Redemption) SelectUpdate() error {
	// This can update zero values
	return DB.Model(redemption).Select("redeemed_time", "status").Updates(redemption).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (redemption *Redemption) Update() error {
	if redemption.Quota <= 0 {
		return errors.New("redemption quota must be positive")
	}
	if err := common.ValidateWalletQuota(redemption.Quota); err != nil {
		return err
	}
	var err error
	err = DB.Model(redemption).Select("name", "status", "quota", "redeemed_time", "expired_time").Updates(redemption).Error
	return err
}

func (redemption *Redemption) Delete() error {
	var err error
	err = DB.Delete(redemption).Error
	return err
}

func DeleteRedemptionById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	err = DB.Where(redemption).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}

// BatchDeleteRedemptions soft-deletes the selected codes in one statement.
func BatchDeleteRedemptions(ids []int) (int64, error) {
	if len(ids) == 0 || len(ids) > 1000 {
		return 0, errors.New("select between 1 and 1000 redemption codes")
	}
	for _, id := range ids {
		if id <= 0 {
			return 0, errors.New("redemption IDs must be positive")
		}
	}
	result := DB.Where("id IN ?", ids).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
