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
package model

import (
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// Quota pool periods
const (
	QuotaPoolPeriodDaily   = "daily"
	QuotaPoolPeriodWeekly  = "weekly"
	QuotaPoolPeriodMonthly = "monthly"
)

// Amount types
const (
	QuotaPoolAmountFixed  = "fixed"
	QuotaPoolAmountRandom = "random"
)

// Balance rule modes
const (
	QuotaPoolBalanceOff   = "off"
	QuotaPoolBalanceBelow = "below" // 余额低于阈值才可领
	QuotaPoolBalanceAbove = "above" // 余额高于阈值才可领
)

// Record kinds
const (
	QuotaRecordKindClaim   = "claim"   // 领取：发放额度
	QuotaRecordKindCheckin = "checkin" // 打卡：只记录，不发额度
)

var (
	ErrQuotaPoolDisabled          = errors.New("quota pool disabled")
	ErrQuotaPoolTimeRestricted    = errors.New("quota pool time restricted")
	ErrQuotaPoolPoolCapReached    = errors.New("quota pool cap reached")
	ErrQuotaPoolUserCapReached    = errors.New("quota pool user cap reached")
	ErrQuotaPoolBalanceNotAllowed = errors.New("quota pool balance not allowed")
	ErrQuotaPoolCountLimitReached = errors.New("quota pool count limit reached")
	ErrQuotaCheckinAlreadyToday   = errors.New("quota checkin already today")
)

// QuotaClaimRecord 领取/打卡记录：周期内累计计算 + 历史
// 全站周期与单用户周期粒度可不同，因此同时记录两个周期键。
type QuotaClaimRecord struct {
	Id            int    `json:"id"`
	UserId        int    `json:"user_id" gorm:"not null;index"`
	PoolPeriodKey string `json:"pool_period_key" gorm:"type:varchar(16);index"` // 全站周期键，如 "2026-08-01" / "2026-W31" / "2026-08"
	UserPeriodKey string `json:"user_period_key" gorm:"type:varchar(16);index"` // 单用户周期键
	Quota         int    `json:"quota"`                                         // 发放额度（打卡为 0）
	Kind          string `json:"kind" gorm:"type:varchar(8);index"`             // claim | checkin
	ClaimedAt     int64  `json:"claimed_at" gorm:"bigint"`
}

func (QuotaClaimRecord) TableName() string {
	return "quota_claim_records"
}

// QuotaClaimLock 全局串行锁：并发领取时串行化，防止全站周期上限超发
// （仅 MySQL/PostgreSQL 需要；SQLite 单写者天然串行）
type QuotaClaimLock struct {
	Id int `gorm:"primaryKey"`
}

func (QuotaClaimLock) TableName() string {
	return "quota_claim_locks"
}

// ---- 周期键 ----

// quotaPoolPeriodKey 计算当前时间所属的周期键
func quotaPoolPeriodKey(period string, t time.Time) string {
	switch period {
	case QuotaPoolPeriodDaily:
		return t.Format("2006-01-02")
	case QuotaPoolPeriodMonthly:
		return t.Format("2006-01")
	default: // weekly
		year, week := t.ISOWeek()
		return fmt.Sprintf("%d-W%02d", year, week)
	}
}

// ---- 时间窗口规则 ----

type TimePeriod struct {
	Start string `json:"start"` // "HH:MM"
	End   string `json:"end"`   // "HH:MM"
}

type TimeWindow struct {
	Dates    []string     `json:"dates"`    // "YYYY-MM-DD"，空=不限
	Weekdays []int        `json:"weekdays"` // 0=周日 .. 6=周六，空=不限
	Periods  []TimePeriod `json:"periods"`  // 空=不限
}

func parseTimeWindows(rule string) []TimeWindow {
	var windows []TimeWindow
	if strings.TrimSpace(rule) == "" {
		return windows
	}
	if err := common.UnmarshalJsonStr(rule, &windows); err != nil {
		return windows
	}
	return windows
}

// matchesTimeRule 判断当前时间是否落在白名单窗口内；空规则视为不限制
func matchesTimeRule(rule string, t time.Time) bool {
	windows := parseTimeWindows(rule)
	if len(windows) == 0 {
		return true
	}
	dateStr := t.Format("2006-01-02")
	weekday := int(t.Weekday()) // 0=Sunday .. 6=Saturday
	nowMin := t.Hour()*60 + t.Minute()

	for _, w := range windows {
		// 日期/星期匹配（两者都为空 = 不限日期）
		dateMatch := len(w.Dates) == 0
		if !dateMatch {
			for _, d := range w.Dates {
				if d == dateStr {
					dateMatch = true
					break
				}
			}
		}
		weekdayMatch := len(w.Weekdays) == 0
		if !weekdayMatch {
			for _, wd := range w.Weekdays {
				if wd == weekday {
					weekdayMatch = true
					break
				}
			}
		}
		if !dateMatch || !weekdayMatch {
			continue
		}
		// 时间段匹配（空 = 不限时间）
		if len(w.Periods) == 0 {
			return true
		}
		for _, p := range w.Periods {
			startMin := parseHHMM(p.Start)
			endMin := parseHHMM(p.End)
			// start <= end 表示当天区间；start > end 表示跨午夜区间
			if startMin <= endMin {
				if nowMin >= startMin && nowMin < endMin {
					return true
				}
			} else {
				if nowMin >= startMin || nowMin < endMin {
					return true
				}
			}
		}
	}
	return false
}

func parseHHMM(s string) int {
	s = strings.TrimSpace(s)
	var h, m int
	if _, err := fmt.Sscanf(s, "%d:%d", &h, &m); err != nil {
		return -1
	}
	return h*60 + m
}

// ---- 周期累计统计（只统计领取记录，打卡不计入上限） ----

func globalPeriodGranted(tx *gorm.DB, poolPeriodKey string) (int, error) {
	var total int64
	err := tx.Model(&QuotaClaimRecord{}).
		Where("kind = ? AND pool_period_key = ?", QuotaRecordKindClaim, poolPeriodKey).
		Select("COALESCE(SUM(quota), 0)").Scan(&total).Error
	return int(total), err
}

func userPeriodGranted(tx *gorm.DB, userId int, userPeriodKey string) (int, error) {
	var total int64
	err := tx.Model(&QuotaClaimRecord{}).
		Where("kind = ? AND user_id = ? AND user_period_key = ?", QuotaRecordKindClaim, userId, userPeriodKey).
		Select("COALESCE(SUM(quota), 0)").Scan(&total).Error
	return int(total), err
}

func userPeriodClaimCount(tx *gorm.DB, userId int, userPeriodKey string) (int, error) {
	var count int64
	err := tx.Model(&QuotaClaimRecord{}).
		Where("kind = ? AND user_id = ? AND user_period_key = ?", QuotaRecordKindClaim, userId, userPeriodKey).
		Count(&count).Error
	return int(count), err
}

// hasCheckedInToday 判断用户当天是否已打卡（kind=checkin）
func hasCheckedInToday(userId int, now time.Time) (bool, error) {
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).Unix()
	end := start + 86400
	var count int64
	err := DB.Model(&QuotaClaimRecord{}).
		Where("user_id = ? AND kind = ? AND claimed_at >= ? AND claimed_at < ?",
			userId, QuotaRecordKindCheckin, start, end).
		Count(&count).Error
	return count > 0, err
}

// ---- 领取/打卡 ----

// computeQuotaAmount 计算本次发放额度
func computeQuotaAmount(s *operation_setting.QuotaPoolSetting) int {
	if s.AmountType == QuotaPoolAmountRandom {
		if s.MaxAmount > s.MinAmount {
			return s.MinAmount + rand.Intn(s.MaxAmount-s.MinAmount+1)
		}
		return s.MinAmount
	}
	return s.Amount
}

// QuotaClaimStatus 当前周期领取状态（用户端展示用）
type QuotaClaimStatus struct {
	PoolPeriodKey     string `json:"pool_period_key"`
	UserPeriodKey     string `json:"user_period_key"`
	GlobalGranted     int    `json:"global_granted"` // 全站当前周期已发
	UserGranted       int    `json:"user_granted"`   // 用户当前周期已领额度
	UserCount         int    `json:"user_count"`     // 用户当前周期领取次数
	GlobalCapReached  bool   `json:"global_cap_reached"`
	UserCapReached    bool   `json:"user_cap_reached"`
	CountLimitReached bool   `json:"count_limit_reached"`
	TimeOpen          bool   `json:"time_open"`
	BalanceAllowed    bool   `json:"balance_allowed"`
	CheckedInToday    bool   `json:"checked_in_today"`
	TotalClaims       int64  `json:"total_claims"` // 生命周期累计领取次数
	TotalQuota        int64  `json:"total_quota"`  // 生命周期累计领取额度
}

// GetQuotaClaimStatus 计算当前周期领取状态（只读，不发放）
func GetQuotaClaimStatus(userId int) (*QuotaClaimStatus, error) {
	setting := operation_setting.GetQuotaPoolSetting()
	now := time.Now()
	poolKey := quotaPoolPeriodKey(setting.PoolPeriod, now)
	userKey := quotaPoolPeriodKey(setting.UserPeriod, now)
	status := &QuotaClaimStatus{
		PoolPeriodKey:  poolKey,
		UserPeriodKey:  userKey,
		TimeOpen:       matchesTimeRule(setting.TimeRule, now),
		BalanceAllowed: true,
	}

	checkedIn, err := hasCheckedInToday(userId, now)
	if err != nil {
		return nil, err
	}
	status.CheckedInToday = checkedIn

	if setting.BalanceMode != QuotaPoolBalanceOff {
		quota, err := GetUserQuota(userId, false)
		if err != nil {
			return nil, err
		}
		if setting.BalanceMode == QuotaPoolBalanceBelow {
			status.BalanceAllowed = quota < setting.BalanceLimit
		} else {
			status.BalanceAllowed = quota > setting.BalanceLimit
		}
	}

	// 周期统计总是返回（即便未配置对应上限），"到顶"标志仅在配置了上限时判定。
	// 这样用户始终能看到已领次数/额度，而不是因未配置上限而恒显示 0。
	if g, err := globalPeriodGranted(DB, poolKey); err != nil {
		return nil, err
	} else {
		status.GlobalGranted = g
		status.GlobalCapReached = setting.PoolPeriodCap > 0 && g >= setting.PoolPeriodCap
	}
	if g, err := userPeriodGranted(DB, userId, userKey); err != nil {
		return nil, err
	} else {
		status.UserGranted = g
		// 单次发放最小量：fixed=Amount，random=MinAmount
		minClaim := setting.Amount
		if setting.AmountType == QuotaPoolAmountRandom {
			minClaim = setting.MinAmount
		}
		// 剩余空间已小于单次最小发放时同样视为到顶：此时任何一次领取都会被后端
		// 拒绝（granted+quotaAwarded > cap），前端应禁用按钮而不是点了再报错。
		status.UserCapReached = setting.UserPeriodCap > 0 &&
			(g >= setting.UserPeriodCap || g+minClaim > setting.UserPeriodCap)
	}
	if c, err := userPeriodClaimCount(DB, userId, userKey); err != nil {
		return nil, err
	} else {
		status.UserCount = c
		status.CountLimitReached = setting.UserPeriodCountLimit > 0 && c >= setting.UserPeriodCountLimit
	}

	// 生命周期累计（只统计领取）
	DB.Model(&QuotaClaimRecord{}).
		Where("user_id = ? AND kind = ?", userId, QuotaRecordKindClaim).Count(&status.TotalClaims)
	DB.Model(&QuotaClaimRecord{}).
		Where("user_id = ? AND kind = ?", userId, QuotaRecordKindClaim).
		Select("COALESCE(SUM(quota), 0)").Scan(&status.TotalQuota)

	return status, nil
}

// GetUserQuotaClaimRecords 获取用户在时间戳区间内的领取/打卡记录（日历按天聚合用）
func GetUserQuotaClaimRecords(userId int, startTs, endTs int64) ([]QuotaClaimRecord, error) {
	var records []QuotaClaimRecord
	err := DB.Where("user_id = ? AND claimed_at >= ? AND claimed_at < ?", userId, startTs, endTs).
		Order("claimed_at asc").Find(&records).Error
	return records, err
}

// ClaimQuota 用户从额度池领取（规则校验 + 发放），照 UserCheckin 的跨库事务写法
func ClaimQuota(userId int) (*QuotaClaimRecord, error) {
	setting := operation_setting.GetQuotaPoolSetting()
	if !setting.Enabled {
		return nil, ErrQuotaPoolDisabled
	}

	now := time.Now()
	poolKey := quotaPoolPeriodKey(setting.PoolPeriod, now)
	userKey := quotaPoolPeriodKey(setting.UserPeriod, now)

	// 规则1 时间窗口
	if !matchesTimeRule(setting.TimeRule, now) {
		return nil, ErrQuotaPoolTimeRestricted
	}

	// 规则4 余额门槛（在事务外读一次即可，无需外部 API）
	if setting.BalanceMode != QuotaPoolBalanceOff {
		quota, qErr := GetUserQuota(userId, false)
		if qErr != nil {
			return nil, qErr
		}
		if setting.BalanceMode == QuotaPoolBalanceBelow && quota >= setting.BalanceLimit {
			return nil, ErrQuotaPoolBalanceNotAllowed
		}
		if setting.BalanceMode == QuotaPoolBalanceAbove && quota <= setting.BalanceLimit {
			return nil, ErrQuotaPoolBalanceNotAllowed
		}
	}

	quotaAwarded := computeQuotaAmount(setting)

	record := &QuotaClaimRecord{
		UserId:        userId,
		PoolPeriodKey: poolKey,
		UserPeriodKey: userKey,
		Quota:         quotaAwarded,
		Kind:          QuotaRecordKindClaim,
		ClaimedAt:     now.Unix(),
	}

	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		return claimQuotaWithoutTransaction(record, setting, quotaAwarded, poolKey, userKey)
	}
	return claimQuotaWithTransaction(record, setting, quotaAwarded, poolKey, userKey)
}

// CheckInQuota 用户打卡（不发额度，只记录），每天一次
func CheckInQuota(userId int) (*QuotaClaimRecord, error) {
	setting := operation_setting.GetQuotaPoolSetting()
	if !setting.Enabled {
		return nil, ErrQuotaPoolDisabled
	}

	now := time.Now()
	if !matchesTimeRule(setting.TimeRule, now) {
		return nil, ErrQuotaPoolTimeRestricted
	}

	checkedIn, err := hasCheckedInToday(userId, now)
	if err != nil {
		return nil, err
	}
	if checkedIn {
		return nil, ErrQuotaCheckinAlreadyToday
	}

	record := &QuotaClaimRecord{
		UserId:        userId,
		PoolPeriodKey: quotaPoolPeriodKey(setting.PoolPeriod, now),
		UserPeriodKey: quotaPoolPeriodKey(setting.UserPeriod, now),
		Quota:         0,
		Kind:          QuotaRecordKindCheckin,
		ClaimedAt:     now.Unix(),
	}
	if err := DB.Create(record).Error; err != nil {
		return nil, err
	}
	return record, nil
}

// claimQuotaWithTransaction MySQL / PostgreSQL 事务
func claimQuotaWithTransaction(record *QuotaClaimRecord, setting *operation_setting.QuotaPoolSetting, quotaAwarded int, poolKey, userKey string) (*QuotaClaimRecord, error) {
	err := DB.Transaction(func(tx *gorm.DB) error {
		// 锁全局锁行，串行化所有并发领取，避免并发超发全站周期上限
		var lock QuotaClaimLock
		if err := lockForUpdate(tx).Where("id = ?", 1).First(&lock).Error; err != nil {
			return err
		}

		// 规则2 全站周期总额上限
		if setting.PoolPeriodCap > 0 {
			granted, err := globalPeriodGranted(tx, poolKey)
			if err != nil {
				return err
			}
			if granted+quotaAwarded > setting.PoolPeriodCap {
				return ErrQuotaPoolPoolCapReached
			}
		}
		// 规则3 单用户周期额度上限
		if setting.UserPeriodCap > 0 {
			granted, err := userPeriodGranted(tx, record.UserId, userKey)
			if err != nil {
				return err
			}
			if granted+quotaAwarded > setting.UserPeriodCap {
				return ErrQuotaPoolUserCapReached
			}
		}
		// 规则5 单用户周期领取次数
		if setting.UserPeriodCountLimit > 0 {
			count, err := userPeriodClaimCount(tx, record.UserId, userKey)
			if err != nil {
				return err
			}
			if count >= setting.UserPeriodCountLimit {
				return ErrQuotaPoolCountLimitReached
			}
		}

		if err := tx.Create(record).Error; err != nil {
			return err
		}
		return tx.Model(&User{}).Where("id = ?", record.UserId).
			Update("quota", gorm.Expr("quota + ?", quotaAwarded)).Error
	})
	if err != nil {
		return nil, err
	}
	go func() {
		_ = cacheIncrUserQuota(record.UserId, int64(quotaAwarded))
	}()
	return record, nil
}

// claimQuotaWithoutTransaction SQLite 顺序操作 + 手动回滚
func claimQuotaWithoutTransaction(record *QuotaClaimRecord, setting *operation_setting.QuotaPoolSetting, quotaAwarded int, poolKey, userKey string) (*QuotaClaimRecord, error) {
	// 规则2 全站周期总额上限
	if setting.PoolPeriodCap > 0 {
		granted, err := globalPeriodGranted(DB, poolKey)
		if err != nil {
			return nil, err
		}
		if granted+quotaAwarded > setting.PoolPeriodCap {
			return nil, ErrQuotaPoolPoolCapReached
		}
	}
	// 规则3 单用户周期额度上限
	if setting.UserPeriodCap > 0 {
		granted, err := userPeriodGranted(DB, record.UserId, userKey)
		if err != nil {
			return nil, err
		}
		if granted+quotaAwarded > setting.UserPeriodCap {
			return nil, ErrQuotaPoolUserCapReached
		}
	}
	// 规则5 单用户周期领取次数
	if setting.UserPeriodCountLimit > 0 {
		count, err := userPeriodClaimCount(DB, record.UserId, userKey)
		if err != nil {
			return nil, err
		}
		if count >= setting.UserPeriodCountLimit {
			return nil, ErrQuotaPoolCountLimitReached
		}
	}

	if err := DB.Create(record).Error; err != nil {
		return nil, err
	}
	if err := IncreaseUserQuota(record.UserId, quotaAwarded, true); err != nil {
		DB.Delete(record)
		return nil, err
	}
	return record, nil
}
