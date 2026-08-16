package model

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// ErrPledgeCooldown 保证书仍在冷却期。由 ApplyUserPledge 在事务内返回，
// 下次可做保证书的时间通过返回值带出。
var ErrPledgeCooldown = errors.New("pledge cooldown")

// CreditScoreLog 信誉分变动审计明细（扣分/恢复/管理端调整）。
// 独立表放主库 DB；Reason 必须带上扣分依据（命中的违规标记词/敏感词 + 错误原文截断），
// 保证"为什么扣分"在风控中心一眼可查。
type CreditScoreLog struct {
	Id        int64  `json:"id" gorm:"primaryKey"`
	UserId    int    `json:"user_id" gorm:"index;index:idx_cs_user_created,priority:1;index:idx_cs_user_source_created,priority:1"`
	Source    string `json:"source" gorm:"type:varchar(32);index;index:idx_cs_user_source_created,priority:2"`
	Points    int    `json:"points"`  // 负=扣分，正=恢复
	Balance   int    `json:"balance"` // 更新后余额
	RequestId string `json:"request_id" gorm:"type:varchar(64);index"`
	Reason    string `json:"reason" gorm:"type:varchar(512)"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index;autoCreateTime;index:idx_cs_user_created,priority:2;index:idx_cs_user_source_created,priority:3"`
	// RevertedAt 管理端打回（审核误判撤销）该条扣分记录的时间，0=未打回。
	// 仅敏感词扣分（source=local_keyword）可打回；打回后该条不再计入重复倍率次数。
	RevertedAt int64 `json:"reverted_at" gorm:"bigint;index"`
}

func (CreditScoreLog) TableName() string { return "credit_score_logs" }

// ErrCreditScoreLogAlreadyReverted 该扣分记录已被打回，不能重复打回。
var ErrCreditScoreLogAlreadyReverted = errors.New("credit score log already reverted")

// ApplyCreditScoreDelta 原子应用信誉分变动（delta 负=扣、正=恢复），clamp 到 [0, maxScore]，
// 并写入审计明细 log（log.UserId/Points/Balance 回填为实际值）。lockForUpdate 串行化并发扣分，
// SQLite 下跳过锁（lockForUpdate 内部处理）。返回更新后余额。
func ApplyCreditScoreDelta(userId int, delta int, maxScore int, log *CreditScoreLog) (int, error) {
	if userId <= 0 || log == nil {
		return 0, errors.New("invalid params")
	}
	var newBalance int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("credit_score").Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		newBalance = user.CreditScore + delta
		if newBalance < 0 {
			newBalance = 0
		}
		if maxScore > 0 && newBalance > maxScore {
			newBalance = maxScore
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("credit_score", newBalance).Error; err != nil {
			return err
		}
		log.UserId = userId
		log.Points = delta
		log.Balance = newBalance
		if log.CreatedAt == 0 {
			log.CreatedAt = common.GetTimestamp()
		}
		return tx.Create(log).Error
	})
	if err != nil {
		return 0, err
	}
	return newBalance, nil
}

// ApplyCreditScoreRevert 管理端打回一条扣分记录：用户行锁内原子完成"幂等校验（未打回才
// 标记）+ 加回分数（delta 为正，clamp 到 [0,maxScore]）+ 落恢复审计明细"。原记录标记
// 打回与分数更新共用用户行锁，并发打回同一记录时后者因 reverted_at != 0 被拒绝，不会
// 双重加分。revertLog 的 UserId/Points/Balance 回填为实际值。
func ApplyCreditScoreRevert(sourceLogID int64, userId int, delta int, maxScore int, revertLog *CreditScoreLog) (int, error) {
	if userId <= 0 || revertLog == nil {
		return 0, errors.New("invalid params")
	}
	if delta <= 0 {
		return 0, errors.New("revert delta must be positive")
	}
	var newBalance int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("credit_score").Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		// 幂等：只把未打回的记录置为已打回；RowsAffected=0 说明已被打回，拒绝。
		// 用 COALESCE 兼容存量 NULL（AutoMigrate 加列无默认值，老行 reverted_at 是 NULL，
		// 裸 `reverted_at = 0` 匹配不到 NULL 行，会误判"已打回"）。
		result := tx.Model(&CreditScoreLog{}).
			Where("id = ? AND COALESCE(reverted_at, 0) = 0", sourceLogID).
			Update("reverted_at", common.GetTimestamp())
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrCreditScoreLogAlreadyReverted
		}
		newBalance = user.CreditScore + delta
		if newBalance < 0 {
			newBalance = 0
		}
		if maxScore > 0 && newBalance > maxScore {
			newBalance = maxScore
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("credit_score", newBalance).Error; err != nil {
			return err
		}
		revertLog.UserId = userId
		revertLog.Points = delta
		revertLog.Balance = newBalance
		if revertLog.CreatedAt == 0 {
			revertLog.CreatedAt = common.GetTimestamp()
		}
		return tx.Create(revertLog).Error
	})
	if err != nil {
		return 0, err
	}
	return newBalance, nil
}
func ApplyUserPledge(userId int, points int, maxScore int, cooldown int64, source string, log *CreditScoreLog) (newBalance int, nextPledgeAt int64, err error) {
	if userId <= 0 || log == nil || points <= 0 {
		return 0, 0, errors.New("invalid pledge params")
	}
	if cooldown <= 0 {
		cooldown = 7 * 86400
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("credit_score").Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		now := time.Now().Unix()
		var last CreditScoreLog
		qerr := tx.Model(&CreditScoreLog{}).
			Where("user_id = ? AND source = ?", userId, source).
			Order("id desc").First(&last).Error
		if qerr != nil && !errors.Is(qerr, gorm.ErrRecordNotFound) {
			return qerr
		}
		if last.Id > 0 && now < last.CreatedAt+cooldown {
			nextPledgeAt = last.CreatedAt + cooldown
			return ErrPledgeCooldown
		}
		newBalance = user.CreditScore + points
		if maxScore > 0 && newBalance > maxScore {
			newBalance = maxScore
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("credit_score", newBalance).Error; err != nil {
			return err
		}
		log.UserId = userId
		log.Points = points
		log.Balance = newBalance
		log.CreatedAt = now
		return tx.Create(log).Error
	})
	if err != nil {
		return 0, nextPledgeAt, err
	}
	if nextPledgeAt == 0 {
		nextPledgeAt = time.Now().Unix() + cooldown
	}
	return newBalance, nextPledgeAt, nil
}

// ApplyCreditScoreDeduction 在用户行锁内原子完成"24h 同源倍率 + 24h 每日上限 + 扣分 +
// 审计"。倍率与上限统计放在拿到锁之后、事务内进行：并发扣分会在行锁上排队，后到的
// 请求能读到先前扣分（锁内首读建立于锁后快照），每日上限因此有效，不会被并发突发绕过。
// 返回实际扣除点数（0=被上限拦下/无需扣）与更新后余额。
func ApplyCreditScoreDeduction(userId int, source string, basePoints int, maxScore int, repeatTiers []operation_setting.RepeatMultiplierTier, maxDailyDeduction int, windowStart int64, log *CreditScoreLog) (applied int, newBalance int, err error) {
	if userId <= 0 || log == nil {
		return 0, 0, errors.New("invalid params")
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("credit_score").Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		points := basePoints
		// 倍率阶梯非空视为启用：occurrence = 已有同类违规数 + 1（本次还没落库）。
		// 已打回（误判撤销）的记录不计入次数，避免误判推高后续倍率。
		if len(repeatTiers) > 0 && basePoints > 0 {
			var count int64
			if err := tx.Model(&CreditScoreLog{}).
				Where("user_id = ? AND source = ? AND COALESCE(reverted_at, 0) = 0 AND created_at >= ?", userId, source, windowStart).
				Count(&count).Error; err != nil {
				return err
			}
			occurrence := int(count) + 1
			mult := multiplierForRepeat(occurrence, repeatTiers)
			// 倍率可为小数（如 ×1.5），乘积四舍五入取整走统一 quota 取整；clamp 防御，
			// 倍率配置异常导致乘积回退时至少按基础分扣，绝不出现"扣负分"（负扣分=加分）。
			if points = common.QuotaRound(float64(basePoints) * mult); points < basePoints {
				points = basePoints
			}
		}
		if maxDailyDeduction > 0 {
			var used int
			if err := tx.Model(&CreditScoreLog{}).
				Select("COALESCE(SUM(ABS(points)), 0)").
				// 只统计系统自动扣分：管理端手动扣分（source=admin_adjust）是人工有意
				// 操作，不应占用当日的自动风控扣分额度。与 service.CreditSourceAdminAdjust 对齐。
				// 已打回（误判撤销）的扣分不占用额度。
				Where("user_id = ? AND points < 0 AND source <> ? AND COALESCE(reverted_at, 0) = 0 AND created_at >= ?", userId, "admin_adjust", windowStart).
				Scan(&used).Error; err != nil {
				return err
			}
			remaining := maxDailyDeduction - used
			if remaining <= 0 {
				return nil // 已达每日上限，本次不扣
			}
			if points > remaining {
				points = remaining
			}
		}
		if points <= 0 {
			return nil
		}
		newBalance = user.CreditScore - points
		if newBalance < 0 {
			newBalance = 0
		}
		if maxScore > 0 && newBalance > maxScore {
			newBalance = maxScore
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("credit_score", newBalance).Error; err != nil {
			return err
		}
		applied = points
		log.UserId = userId
		log.Points = -points
		log.Balance = newBalance
		if log.CreatedAt == 0 {
			log.CreatedAt = common.GetTimestamp()
		}
		return tx.Create(log).Error
	})
	if err != nil {
		return 0, 0, err
	}
	return applied, newBalance, nil
}

// multiplierForRepeat 返回第 occurrence 次命中应用的倍率：取 from <= occurrence 中
// from 最大的一档；occurrence <= 1 或 tiers 为空返回 1（×1）。无效档（from<2、
// 倍率非正/NaN/Inf）跳过——倍率是管理员配置，防御损坏值绝不参与扣分计算。
func multiplierForRepeat(occurrence int, tiers []operation_setting.RepeatMultiplierTier) float64 {
	if occurrence <= 1 || len(tiers) == 0 {
		return 1
	}
	mult := 1.0
	bestFrom := 1
	for _, tier := range tiers {
		if tier.From < 2 || math.IsNaN(tier.Multiplier) ||
			math.IsInf(tier.Multiplier, 0) || tier.Multiplier < 1 {
			continue
		}
		if tier.From <= occurrence && tier.From >= bestFrom {
			bestFrom = tier.From
			mult = tier.Multiplier
		}
	}
	return mult
}

// ListUsersEligibleForRecover 返回可被动恢复信誉分的用户：分数未满，且 since（unix 秒）
// 之后既无扣分也无恢复（避免边扣边回）。NOT EXISTS 三库通用。
func ListUsersEligibleForRecover(fullScore int, since int64, limit int) ([]*User, error) {
	if limit <= 0 {
		limit = 100
	}
	subDeduct := DB.Model(&CreditScoreLog{}).
		Select("1").
		Where("user_id = users.id AND points < 0 AND created_at >= ?", since)
	subRecover := DB.Model(&CreditScoreLog{}).
		Select("1").
		Where("user_id = users.id AND points > 0 AND created_at >= ?", since)
	var users []*User
	err := DB.Model(&User{}).
		Where("credit_score < ?", fullScore).
		Where("NOT EXISTS (?)", subDeduct).
		Where("NOT EXISTS (?)", subRecover).
		Limit(limit).
		Find(&users).Error
	return users, err
}

func GetUserCreditScore(userId int) (int, error) {
	var score int
	err := DB.Model(&User{}).Select("credit_score").Where("id = ?", userId).Scan(&score).Error
	if err != nil {
		return 0, err
	}
	return score, nil
}

// ListLowCreditScoreUsers 返回信用分低于阈值（如冻结红线）的用户列表，分低在前。
func ListLowCreditScoreUsers(threshold int, startIdx int, num int) ([]*User, int64, error) {
	if num <= 0 {
		num = common.MaxRecentItems
	}
	tx := DB.Model(&User{}).Where("credit_score < ?", threshold)
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var users []*User
	err := tx.Omit("password", "access_token", "linux_do_access_token", "linux_do_refresh_token").
		Order("credit_score asc, id asc").Limit(num).Offset(startIdx).Find(&users).Error
	return users, total, err
}

// DeleteOldCreditScoreLogsBatch 按 created_at 批量删除过期扣分/恢复明细（TTL 清理）。
func DeleteOldCreditScoreLogsBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if ctx != nil && ctx.Err() != nil {
		return 0, ctx.Err()
	}
	result := DB.WithContext(ctx).Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&CreditScoreLog{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// CountUsersBelowCreditScore 统计信用分低于阈值的用户数（风控中心概览）。
func CountUsersBelowCreditScore(threshold int) (int64, error) {
	var total int64
	err := DB.Model(&User{}).Where("credit_score < ?", threshold).Count(&total).Error
	return total, err
}

// CreditScoreSegmentCount 信用分区间统计行（CountUsersByCreditScoreSegment 的返回项）。
// json tag 必须小写：序列化进 overview 响应后前端按 segment/count 读取。
type CreditScoreSegmentCount struct {
	Segment string `json:"segment" gorm:"column:segment"`
	Count   int64  `json:"count" gorm:"column:segment_count"`
}

// CountUsersByCreditScoreSegment 按信用分占满分(fullScore)的百分比分桶统计用户数（软删除
// 自动排除）。百分比桶与 full_score 配置解耦：改满分/冻结阈值等数值时桶等比缩放，不会出现
// "上限调低后全员落入最低桶"的失真。桶：<50% / 50-79% / 80-99% / 100%，按桶顺序返回
// （整数运算避免浮点误差）。注意 ORDER BY 必须按 GROUP BY 的 segment 别名排序，不能引用
// 原始 credit_score 表达式——MySQL 的 only_full_group_by 会拒绝非聚合列进 ORDER BY（SQLite
// 不强制所以容易漏测，见 TestCountUsersByCreditScoreSegment）。
func CountUsersByCreditScoreSegment(fullScore int) ([]CreditScoreSegmentCount, error) {
	if fullScore <= 0 {
		fullScore = 650 // 兜底，避免除零
	}
	var rows []CreditScoreSegmentCount
	err := DB.Raw("SELECT CASE "+
		"WHEN credit_score * 100 / ? >= 100 THEN '100%' "+
		"WHEN credit_score * 100 / ? >= 80 THEN '80-99%' "+
		"WHEN credit_score * 100 / ? >= 50 THEN '50-79%' "+
		"ELSE '<50%' END AS segment, "+
		"COUNT(*) AS segment_count "+
		"FROM users WHERE deleted_at IS NULL "+
		"GROUP BY segment "+
		"ORDER BY CASE segment "+
		"WHEN '100%' THEN 0 "+
		"WHEN '80-99%' THEN 1 "+
		"WHEN '50-79%' THEN 2 "+
		"ELSE 3 END",
		fullScore, fullScore, fullScore).
		Scan(&rows).Error
	return rows, err
}

// SumAllDeductionsSince 统计 since 之后所有扣分（points<0）的绝对值总和（全局）。
func SumAllDeductionsSince(since int64) (int, error) {
	var sum int
	err := DB.Model(&CreditScoreLog{}).
		Select("COALESCE(SUM(ABS(points)), 0)").
		Where("points < 0").
		Where("created_at >= ?", since).
		Scan(&sum).Error
	return sum, err
}

// CountCreditScoreLogsSince 统计 since 之后的事件数，可限定来源列表。
func CountCreditScoreLogsSince(since int64, sources []string) (int64, error) {
	tx := DB.Model(&CreditScoreLog{}).Where("created_at >= ?", since)
	if len(sources) > 0 {
		tx = tx.Where("source IN ?", sources)
	}
	var total int64
	err := tx.Count(&total).Error
	return total, err
}

// CountCreditScoreLogs 统计某用户某来源在 since（unix 秒）之后的事件数，
// 用于 24h 重复违规倍率。
func CountCreditScoreLogs(userId int, source string, since int64) (int64, error) {
	if userId <= 0 {
		return 0, errors.New("invalid user id")
	}
	tx := DB.Model(&CreditScoreLog{}).Where("user_id = ?", userId)
	if source != "" {
		tx = tx.Where("source = ?", source)
	}
	if since > 0 {
		tx = tx.Where("created_at >= ?", since)
	}
	var total int64
	err := tx.Count(&total).Error
	return total, err
}

// GetLastCreditScoreLog 返回某用户某来源最新一条记录（如 source=pledge 用于保证书冷却）。
func GetLastCreditScoreLog(userId int, source string) (*CreditScoreLog, error) {
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	var log CreditScoreLog
	err := DB.Model(&CreditScoreLog{}).
		Where("user_id = ?", userId).
		Where("source = ?", source).
		Order("id desc").First(&log).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &log, nil
}

// DeleteAllCreditScoreLogs 清空全部信用分明细（全站信誉分重置时用：重置=从头开始，旧扣分/
// 恢复/保证书/重置记录一并清掉）。该表无软删字段，走硬删；返回删除行数。
func DeleteAllCreditScoreLogs() (int64, error) {
	result := DB.Where("1 = 1").Delete(&CreditScoreLog{})
	return result.RowsAffected, result.Error
}

func ListCreditScoreLogs(userId int, source string, startTimestamp int64, endTimestamp int64, startIdx int, num int) (logs []*CreditScoreLog, total int64, err error) {
	if num <= 0 {
		num = common.MaxRecentItems
	}
	tx := DB.Model(&CreditScoreLog{})
	if userId > 0 {
		tx = tx.Where("user_id = ?", userId)
	}
	if source != "" {
		tx = tx.Where("source = ?", source)
	}
	if startTimestamp > 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if err = tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	return logs, total, err
}
