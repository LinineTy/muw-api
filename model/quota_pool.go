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

var (
	ErrQuotaPoolNotFound          = errors.New("quota pool not found")
	ErrQuotaPoolDisabled          = errors.New("quota pool disabled")
	ErrQuotaPoolTimeRestricted    = errors.New("quota pool time restricted")
	ErrQuotaPoolPoolCapReached    = errors.New("quota pool cap reached")
	ErrQuotaPoolUserCapReached    = errors.New("quota pool user cap reached")
	ErrQuotaPoolBalanceNotAllowed = errors.New("quota pool balance not allowed")
	ErrQuotaPoolCountLimitReached = errors.New("quota pool count limit reached")
)

// QuotaPool 额度池：管理员配置发放规则，用户按规则领取（周期制）
type QuotaPool struct {
	Id          int    `json:"id"`
	Name        string `json:"name" gorm:"type:varchar(64);not null"`
	Description string `json:"description" gorm:"type:varchar(255);default:''"`
	Enabled     bool   `json:"enabled"`

	// 周期：daily | weekly | monthly（上限/次数按此滚动重置）
	Period string `json:"period" gorm:"type:varchar(16);default:'weekly'"`

	// 发放额度：fixed 固定 / random 随机区间
	AmountType string `json:"amount_type" gorm:"type:varchar(16);default:'fixed'"`
	Amount     int    `json:"amount"`     // fixed 档发放额度（quota 单位）
	MinAmount  int    `json:"min_amount"` // random 档下限
	MaxAmount  int    `json:"max_amount"` // random 档上限

	// 规则1 时间窗口：JSON 文本 [{dates:[], weekdays:[], periods:[{start,end}]}]
	TimeRule string `json:"time_rule" gorm:"type:text"`

	// 规则2 全池周期总额上限（quota 单位；0 = 不限）：当前周期内所有用户合计最多发这么多
	PoolPeriodCap int `json:"pool_period_cap"`
	// 规则3 单用户周期额度上限（quota 单位；0 = 不限）：当前用户本周期累计最多拿这么多
	UserPeriodCap int `json:"user_period_cap"`
	// 规则4 余额门槛：mode = off | below | above；limit 为 quota 阈值
	BalanceMode  string `json:"balance_mode" gorm:"type:varchar(16);default:'off'"`
	BalanceLimit int    `json:"balance_limit"`
	// 规则5 单用户周期领取次数上限（0 = 不限）
	UserPeriodCountLimit int `json:"user_period_count_limit"`

	CreatedTime int64 `json:"created_time" gorm:"bigint"`
	UpdatedTime int64 `json:"updated_time" gorm:"bigint"`
}

func (p *QuotaPool) BeforeCreate(tx *gorm.DB) error {
	now := time.Now().Unix()
	p.CreatedTime = now
	p.UpdatedTime = now
	return nil
}

func (p *QuotaPool) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedTime = time.Now().Unix()
	return nil
}

// QuotaClaimRecord 领取记录：周期内累计计算 + 历史
type QuotaClaimRecord struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"not null;index"`
	PoolId    int    `json:"pool_id" gorm:"not null;index"`
	Quota     int    `json:"quota"`
	PeriodKey string `json:"period_key" gorm:"type:varchar(16);index"` // 周期键
	ClaimedAt int64  `json:"claimed_at" gorm:"bigint"`
}

func (QuotaClaimRecord) TableName() string {
	return "quota_claim_records"
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

// ---- 池 CRUD ----

func GetQuotaPool(id int) (*QuotaPool, error) {
	var pool QuotaPool
	if err := DB.Where("id = ?", id).First(&pool).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrQuotaPoolNotFound
		}
		return nil, err
	}
	return &pool, nil
}

func GetEnabledQuotaPools() ([]QuotaPool, error) {
	var pools []QuotaPool
	err := DB.Where("enabled = ?", true).Order("id asc").Find(&pools).Error
	return pools, err
}

func GetAllQuotaPools() ([]QuotaPool, error) {
	var pools []QuotaPool
	err := DB.Order("id asc").Find(&pools).Error
	return pools, err
}

func CreateQuotaPool(pool *QuotaPool) error {
	return DB.Create(pool).Error
}

func UpdateQuotaPool(pool *QuotaPool) error {
	return DB.Save(pool).Error
}

func DeleteQuotaPool(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&QuotaPool{}, "id = ?", id).Error; err != nil {
			return err
		}
		return tx.Delete(&QuotaClaimRecord{}, "pool_id = ?", id).Error
	})
}

// ---- 周期累计统计 ----

func poolPeriodGranted(tx *gorm.DB, poolId int, periodKey string) (int, error) {
	var total int64
	err := tx.Model(&QuotaClaimRecord{}).
		Where("pool_id = ? AND period_key = ?", poolId, periodKey).
		Select("COALESCE(SUM(quota), 0)").Scan(&total).Error
	return int(total), err
}

func userPeriodGranted(tx *gorm.DB, userId, poolId int, periodKey string) (int, error) {
	var total int64
	err := tx.Model(&QuotaClaimRecord{}).
		Where("user_id = ? AND pool_id = ? AND period_key = ?", userId, poolId, periodKey).
		Select("COALESCE(SUM(quota), 0)").Scan(&total).Error
	return int(total), err
}

func userPeriodClaimCount(tx *gorm.DB, userId, poolId int, periodKey string) (int, error) {
	var count int64
	err := tx.Model(&QuotaClaimRecord{}).
		Where("user_id = ? AND pool_id = ? AND period_key = ?", userId, poolId, periodKey).
		Count(&count).Error
	return int(count), err
}

func GetQuotaPoolRecords(poolId int, startIdx, num int) (records []QuotaClaimRecord, total int64, err error) {
	err = DB.Model(&QuotaClaimRecord{}).Where("pool_id = ?", poolId).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	if num <= 0 {
		num = 20
	}
	err = DB.Where("pool_id = ?", poolId).
		Order("claimed_at desc").Limit(num).Offset(startIdx).Find(&records).Error
	return records, total, err
}

// ---- 领取 ----

// computeQuotaPoolAmount 计算本次发放额度
func computeQuotaPoolAmount(pool *QuotaPool) int {
	if pool.AmountType == QuotaPoolAmountRandom {
		if pool.MaxAmount > pool.MinAmount {
			return pool.MinAmount + rand.Intn(pool.MaxAmount-pool.MinAmount+1)
		}
		return pool.MinAmount
	}
	return pool.Amount
}

// QuotaPoolClaimStatus 用户对某池的当前周期领取状态（用户端列表展示用）
type QuotaPoolClaimStatus struct {
	PeriodKey         string `json:"period_key"`
	PoolPeriodGranted int    `json:"pool_period_granted"`
	UserPeriodGranted int    `json:"user_period_granted"`
	UserPeriodCount   int    `json:"user_period_count"`
	PoolCapReached    bool   `json:"pool_cap_reached"`
	UserCapReached    bool   `json:"user_cap_reached"`
	CountLimitReached bool   `json:"count_limit_reached"`
	TimeOpen          bool   `json:"time_open"`
	BalanceAllowed    bool   `json:"balance_allowed"`
}

// GetQuotaPoolClaimStatus 计算用户对某池的当前周期领取状态（只读，不发放）
func GetQuotaPoolClaimStatus(userId int, pool *QuotaPool) (*QuotaPoolClaimStatus, error) {
	now := time.Now()
	key := quotaPoolPeriodKey(pool.Period, now)
	status := &QuotaPoolClaimStatus{
		PeriodKey:      key,
		TimeOpen:       matchesTimeRule(pool.TimeRule, now),
		BalanceAllowed: true,
	}

	if pool.BalanceMode != QuotaPoolBalanceOff {
		quota, err := GetUserQuota(userId, false)
		if err != nil {
			return nil, err
		}
		if pool.BalanceMode == QuotaPoolBalanceBelow {
			status.BalanceAllowed = quota < pool.BalanceLimit
		} else {
			status.BalanceAllowed = quota > pool.BalanceLimit
		}
	}

	if pool.PoolPeriodCap > 0 {
		g, err := poolPeriodGranted(DB, pool.Id, key)
		if err != nil {
			return nil, err
		}
		status.PoolPeriodGranted = g
		status.PoolCapReached = g >= pool.PoolPeriodCap
	}
	if pool.UserPeriodCap > 0 {
		g, err := userPeriodGranted(DB, userId, pool.Id, key)
		if err != nil {
			return nil, err
		}
		status.UserPeriodGranted = g
		status.UserCapReached = g >= pool.UserPeriodCap
	}
	if pool.UserPeriodCountLimit > 0 {
		c, err := userPeriodClaimCount(DB, userId, pool.Id, key)
		if err != nil {
			return nil, err
		}
		status.UserPeriodCount = c
		status.CountLimitReached = c >= pool.UserPeriodCountLimit
	}
	return status, nil
}

// UserClaimPoolQuota 用户从额度池领取（规则校验 + 发放），照 UserCheckin 的跨库事务写法
func UserClaimPoolQuota(userId, poolId int) (*QuotaClaimRecord, error) {
	pool, err := GetQuotaPool(poolId)
	if err != nil {
		return nil, err
	}
	if !pool.Enabled {
		return nil, ErrQuotaPoolDisabled
	}

	now := time.Now()
	periodKey := quotaPoolPeriodKey(pool.Period, now)

	// 规则1 时间窗口
	if !matchesTimeRule(pool.TimeRule, now) {
		return nil, ErrQuotaPoolTimeRestricted
	}

	// 规则4 余额门槛（在事务外读一次即可，无需外部 API）
	if pool.BalanceMode != QuotaPoolBalanceOff {
		quota, qErr := GetUserQuota(userId, false)
		if qErr != nil {
			return nil, qErr
		}
		if pool.BalanceMode == QuotaPoolBalanceBelow && quota >= pool.BalanceLimit {
			return nil, ErrQuotaPoolBalanceNotAllowed
		}
		if pool.BalanceMode == QuotaPoolBalanceAbove && quota <= pool.BalanceLimit {
			return nil, ErrQuotaPoolBalanceNotAllowed
		}
	}

	quotaAwarded := computeQuotaPoolAmount(pool)

	record := &QuotaClaimRecord{
		UserId:    userId,
		PoolId:    poolId,
		Quota:     quotaAwarded,
		PeriodKey: periodKey,
		ClaimedAt: now.Unix(),
	}

	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		return claimQuotaPoolWithoutTransaction(record, pool, userId, quotaAwarded, periodKey)
	}
	return claimQuotaPoolWithTransaction(record, pool, userId, quotaAwarded, periodKey)
}

// claimQuotaPoolWithTransaction MySQL / PostgreSQL 事务
func claimQuotaPoolWithTransaction(record *QuotaClaimRecord, pool *QuotaPool, userId, quotaAwarded int, periodKey string) (*QuotaClaimRecord, error) {
	err := DB.Transaction(func(tx *gorm.DB) error {
		// 锁池行，避免并发超发
		if err := lockForUpdate(tx).Where("id = ?", pool.Id).First(&QuotaPool{}).Error; err != nil {
			return ErrQuotaPoolNotFound
		}

		// 规则2 全池周期总额上限
		if pool.PoolPeriodCap > 0 {
			granted, err := poolPeriodGranted(tx, pool.Id, periodKey)
			if err != nil {
				return err
			}
			if granted+quotaAwarded > pool.PoolPeriodCap {
				return ErrQuotaPoolPoolCapReached
			}
		}
		// 规则3 单用户周期额度上限
		if pool.UserPeriodCap > 0 {
			granted, err := userPeriodGranted(tx, userId, pool.Id, periodKey)
			if err != nil {
				return err
			}
			if granted+quotaAwarded > pool.UserPeriodCap {
				return ErrQuotaPoolUserCapReached
			}
		}
		// 规则5 单用户周期领取次数
		if pool.UserPeriodCountLimit > 0 {
			count, err := userPeriodClaimCount(tx, userId, pool.Id, periodKey)
			if err != nil {
				return err
			}
			if count >= pool.UserPeriodCountLimit {
				return ErrQuotaPoolCountLimitReached
			}
		}

		if err := tx.Create(record).Error; err != nil {
			return err
		}
		return tx.Model(&User{}).Where("id = ?", userId).
			Update("quota", gorm.Expr("quota + ?", quotaAwarded)).Error
	})
	if err != nil {
		return nil, err
	}
	go func() {
		_ = cacheIncrUserQuota(userId, int64(quotaAwarded))
	}()
	return record, nil
}

// claimQuotaPoolWithoutTransaction SQLite 顺序操作 + 手动回滚
func claimQuotaPoolWithoutTransaction(record *QuotaClaimRecord, pool *QuotaPool, userId, quotaAwarded int, periodKey string) (*QuotaClaimRecord, error) {
	// 规则2 全池周期总额上限
	if pool.PoolPeriodCap > 0 {
		granted, err := poolPeriodGranted(DB, pool.Id, periodKey)
		if err != nil {
			return nil, err
		}
		if granted+quotaAwarded > pool.PoolPeriodCap {
			return nil, ErrQuotaPoolPoolCapReached
		}
	}
	// 规则3 单用户周期额度上限
	if pool.UserPeriodCap > 0 {
		granted, err := userPeriodGranted(DB, userId, pool.Id, periodKey)
		if err != nil {
			return nil, err
		}
		if granted+quotaAwarded > pool.UserPeriodCap {
			return nil, ErrQuotaPoolUserCapReached
		}
	}
	// 规则5 单用户周期领取次数
	if pool.UserPeriodCountLimit > 0 {
		count, err := userPeriodClaimCount(DB, userId, pool.Id, periodKey)
		if err != nil {
			return nil, err
		}
		if count >= pool.UserPeriodCountLimit {
			return nil, ErrQuotaPoolCountLimitReached
		}
	}

	if err := DB.Create(record).Error; err != nil {
		return nil, err
	}
	if err := IncreaseUserQuota(userId, quotaAwarded, true); err != nil {
		DB.Delete(record)
		return nil, err
	}
	return record, nil
}
