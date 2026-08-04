package model

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/samber/hot"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// Subscription duration units
const (
	SubscriptionDurationYear   = "year"
	SubscriptionDurationMonth  = "month"
	SubscriptionDurationDay    = "day"
	SubscriptionDurationHour   = "hour"
	SubscriptionDurationCustom = "custom"
)

// Subscription quota reset period
const (
	SubscriptionResetNever   = "never"
	SubscriptionResetDaily   = "daily"
	SubscriptionResetWeekly  = "weekly"
	SubscriptionResetMonthly = "monthly"
	SubscriptionResetCustom  = "custom"
)

var (
	ErrSubscriptionOrderNotFound      = errors.New("subscription order not found")
	ErrSubscriptionOrderStatusInvalid = errors.New("subscription order status invalid")
)

const (
	subscriptionPlanCacheNamespace     = "new-api:subscription_plan:v1"
	subscriptionPlanInfoCacheNamespace = "new-api:subscription_plan_info:v1"
)

var (
	subscriptionPlanCacheOnce     sync.Once
	subscriptionPlanInfoCacheOnce sync.Once

	subscriptionPlanCache     *cachex.HybridCache[SubscriptionPlan]
	subscriptionPlanInfoCache *cachex.HybridCache[SubscriptionPlanInfo]
)

func subscriptionPlanCacheTTL() time.Duration {
	ttlSeconds := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_CACHE_TTL", 300)
	if ttlSeconds <= 0 {
		ttlSeconds = 300
	}
	return time.Duration(ttlSeconds) * time.Second
}

func subscriptionPlanInfoCacheTTL() time.Duration {
	ttlSeconds := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_INFO_CACHE_TTL", 120)
	if ttlSeconds <= 0 {
		ttlSeconds = 120
	}
	return time.Duration(ttlSeconds) * time.Second
}

func subscriptionPlanCacheCapacity() int {
	capacity := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_CACHE_CAP", 5000)
	if capacity <= 0 {
		capacity = 5000
	}
	return capacity
}

func subscriptionPlanInfoCacheCapacity() int {
	capacity := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_INFO_CACHE_CAP", 10000)
	if capacity <= 0 {
		capacity = 10000
	}
	return capacity
}

func getSubscriptionPlanCache() *cachex.HybridCache[SubscriptionPlan] {
	subscriptionPlanCacheOnce.Do(func() {
		ttl := subscriptionPlanCacheTTL()
		subscriptionPlanCache = cachex.NewHybridCache[SubscriptionPlan](cachex.HybridCacheConfig[SubscriptionPlan]{
			Namespace: cachex.Namespace(subscriptionPlanCacheNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[SubscriptionPlan]{},
			Memory: func() *hot.HotCache[string, SubscriptionPlan] {
				return hot.NewHotCache[string, SubscriptionPlan](hot.LRU, subscriptionPlanCacheCapacity()).
					WithTTL(ttl).
					WithJanitor().
					Build()
			},
		})
	})
	return subscriptionPlanCache
}

func getSubscriptionPlanInfoCache() *cachex.HybridCache[SubscriptionPlanInfo] {
	subscriptionPlanInfoCacheOnce.Do(func() {
		ttl := subscriptionPlanInfoCacheTTL()
		subscriptionPlanInfoCache = cachex.NewHybridCache[SubscriptionPlanInfo](cachex.HybridCacheConfig[SubscriptionPlanInfo]{
			Namespace: cachex.Namespace(subscriptionPlanInfoCacheNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[SubscriptionPlanInfo]{},
			Memory: func() *hot.HotCache[string, SubscriptionPlanInfo] {
				return hot.NewHotCache[string, SubscriptionPlanInfo](hot.LRU, subscriptionPlanInfoCacheCapacity()).
					WithTTL(ttl).
					WithJanitor().
					Build()
			},
		})
	})
	return subscriptionPlanInfoCache
}

func subscriptionPlanCacheKey(id int) string {
	if id <= 0 {
		return ""
	}
	return strconv.Itoa(id)
}

func InvalidateSubscriptionPlanCache(planId int) {
	if planId <= 0 {
		return
	}
	cache := getSubscriptionPlanCache()
	_, _ = cache.DeleteMany([]string{subscriptionPlanCacheKey(planId)})
	infoCache := getSubscriptionPlanInfoCache()
	_ = infoCache.Purge()
}

// Subscription plan
type SubscriptionPlan struct {
	Id int `json:"id"`

	Title    string `json:"title" gorm:"type:varchar(128);not null"`
	Subtitle string `json:"subtitle" gorm:"type:varchar(255);default:''"`

	// Display money amount (follow existing code style: float64 for money).
	// No default:0 tag — MySQL stores decimal defaults as '0.000000', which GORM
	// compares against '0' and re-issues MODIFY COLUMN on every startup.
	PriceAmount float64 `json:"price_amount" gorm:"type:decimal(10,6);not null"`
	Currency    string  `json:"currency" gorm:"type:varchar(8);not null;default:'USD'"`

	DurationUnit  string `json:"duration_unit" gorm:"type:varchar(16);not null;default:'month'"`
	DurationValue int    `json:"duration_value" gorm:"type:int;not null;default:1"`
	CustomSeconds int64  `json:"custom_seconds" gorm:"type:bigint;not null;default:0"`

	Enabled   bool `json:"enabled"`
	SortOrder int  `json:"sort_order" gorm:"type:int;default:0"`

	// Tier priority within a mutual-exclusion group (higher = higher tier). Used to
	// decide upgrade/downgrade direction when switching between plans in the same
	// ExclusiveGroup; equal priorities fall back to PriceAmount comparison.
	Priority int `json:"priority" gorm:"type:int;not null;default:0"`

	// Recommended plan shown with a highlighted badge on the user-facing catalog
	IsRecommended bool `json:"is_recommended"`

	AllowBalancePay *bool `json:"allow_balance_pay"`

	// Allow falling back to wallet balance after subscription quota is exhausted (empty = true)
	AllowWalletOverflow *bool `json:"allow_wallet_overflow"`

	// Max purchases per user (0 = unlimited)
	MaxPurchasePerUser int `json:"max_purchase_per_user" gorm:"type:int;default:0"`

	// Upgrade user group after purchase (empty = no change)
	UpgradeGroup string `json:"upgrade_group" gorm:"type:varchar(64);default:''"`

	// Downgrade user group on expiry (empty = revert to the group held before purchase)
	DowngradeGroup string `json:"downgrade_group" gorm:"type:varchar(64);default:''"`

	// Total quota (amount in quota units, 0 = unlimited)
	TotalAmount int64 `json:"total_amount" gorm:"type:bigint;not null;default:0"`

	// Quota reset period for plan
	QuotaResetPeriod        string `json:"quota_reset_period" gorm:"type:varchar(16);default:'never'"`
	QuotaResetCustomSeconds int64  `json:"quota_reset_custom_seconds" gorm:"type:bigint;default:0"`

	// Per-cycle quota limit (0 = no limit). When set and a reset period exists, the
	// cycle caps usage each reset window while TotalAmount stays a cumulative cap.
	ResetAmountLimit int64 `json:"reset_amount_limit" gorm:"type:bigint;not null;default:0"`

	// Natural calendar week/month quota caps (0 = no cap). Independent of the
	// subscription-relative reset period; they can be combined and apply to the
	// current calendar week / month regardless of when the subscription started.
	WeeklyAmountLimit  int64 `json:"weekly_amount_limit" gorm:"type:bigint;not null;default:0"`
	MonthlyAmountLimit int64 `json:"monthly_amount_limit" gorm:"type:bigint;not null;default:0"`

	// Max cumulative remaining seconds after a renewal (0 = unlimited). Prevents
	// stacking subscription time indefinitely.
	MaxCumulativeSeconds int64 `json:"max_cumulative_seconds" gorm:"type:bigint;not null;default:0"`

	// Mutual exclusion group. Subscriptions from plans in the same non-empty group
	// cannot coexist; buying another plan in the group triggers a prorated switch.
	ExclusiveGroup string `json:"exclusive_group" gorm:"type:varchar(64);default:''"`

	// User group whitelist (JSON array of group names, e.g. ["vip","pro"]).
	// Empty means any group may subscribe. TEXT column cannot carry a literal
	// DEFAULT in MySQL (error 1101), so the zero value (empty string) is applied
	// by the application layer.
	AllowedGroups string `json:"allowed_groups" gorm:"type:text"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (p *SubscriptionPlan) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	p.CreatedAt = now
	p.UpdatedAt = now
	return nil
}

func (p *SubscriptionPlan) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

func (p *SubscriptionPlan) NormalizeDefaults() {
	if p.AllowBalancePay == nil {
		p.AllowBalancePay = common.GetPointer(true)
	}
	if p.AllowWalletOverflow == nil {
		p.AllowWalletOverflow = common.GetPointer(true)
	}
}

// Subscription order (payment -> webhook -> create UserSubscription)
type SubscriptionOrder struct {
	Id     int     `json:"id"`
	UserId int     `json:"user_id" gorm:"index"`
	PlanId int     `json:"plan_id" gorm:"index"`
	Money  float64 `json:"money"`

	TradeNo         string `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	Status          string `json:"status"`
	CreateTime      int64  `json:"create_time"`
	CompleteTime    int64  `json:"complete_time"`

	ProviderPayload string `json:"provider_payload" gorm:"type:text"`

	// When > 0, completing this order renews/extends the target subscription
	// instead of creating a new one. 0 = create a new subscription.
	ExtendSubscriptionId int `json:"extend_subscription_id" gorm:"type:int;not null;default:0"`
}

func (o *SubscriptionOrder) Insert() error {
	if o.CreateTime == 0 {
		o.CreateTime = common.GetTimestamp()
	}
	return DB.Create(o).Error
}

func (o *SubscriptionOrder) Update() error {
	return DB.Save(o).Error
}

func GetSubscriptionOrderByTradeNo(tradeNo string) *SubscriptionOrder {
	if tradeNo == "" {
		return nil
	}
	var order SubscriptionOrder
	if err := DB.Where("trade_no = ?", tradeNo).First(&order).Error; err != nil {
		return nil
	}
	return &order
}

// User subscription instance
type UserSubscription struct {
	Id     int `json:"id"`
	UserId int `json:"user_id" gorm:"index;index:idx_user_sub_active,priority:1"`
	PlanId int `json:"plan_id" gorm:"index"`

	// Quota windows use independent monotonic counters — no snapshot derivation.
	// Each counter is only reset by its own window boundary, so the calendar
	// week/month caps survive the subscription-relative reset period and no cap
	// silently disables the others.
	AmountTotal int64 `json:"amount_total" gorm:"type:bigint;not null;default:0"`
	AmountUsed  int64 `json:"amount_used" gorm:"type:bigint;not null;default:0"`

	StartTime int64  `json:"start_time" gorm:"bigint"`
	EndTime   int64  `json:"end_time" gorm:"bigint;index;index:idx_user_sub_active,priority:3"`
	Status    string `json:"status" gorm:"type:varchar(32);index;index:idx_user_sub_active,priority:2"` // active/expired/cancelled

	Source string `json:"source" gorm:"type:varchar(32);default:'order'"` // order/admin/balance

	// Reset-cycle window (only meaningful when the plan has a reset period).
	CycleStartAt     int64 `json:"cycle_start_at" gorm:"type:bigint;not null;default:0"`
	CycleUsed        int64 `json:"cycle_used" gorm:"type:bigint;not null;default:0"`
	NextCycleResetAt int64 `json:"next_cycle_reset_at" gorm:"type:bigint;not null;default:0;index"`

	// Natural calendar week/month windows (only meaningful when the plan caps them).
	WeekStartAt  int64 `json:"week_start_at" gorm:"type:bigint;not null;default:0"`
	WeekUsed     int64 `json:"week_used" gorm:"type:bigint;not null;default:0"`
	MonthStartAt int64 `json:"month_start_at" gorm:"type:bigint;not null;default:0"`
	MonthUsed    int64 `json:"month_used" gorm:"type:bigint;not null;default:0"`

	UpgradeGroup  string `json:"upgrade_group" gorm:"type:varchar(64);default:''"`
	PrevUserGroup string `json:"prev_user_group" gorm:"type:varchar(64);default:''"`

	// Downgrade target group on expiry (snapshot from plan; empty = revert to PrevUserGroup)
	DowngradeGroup string `json:"downgrade_group" gorm:"type:varchar(64);default:''"`

	// Whether wallet fallback is allowed after this subscription's quota is exhausted (snapshot from plan)
	AllowWalletOverflow bool `json:"allow_wallet_overflow"`

	// Whether the subscription renews automatically with wallet balance near expiry.
	AutoRenew bool `json:"auto_renew"`

	// Set when the last automatic renewal attempt failed (e.g. insufficient balance).
	AutoRenewFailed bool `json:"auto_renew_failed"`

	// Consumption priority, smaller value is consumed first.
	Priority int `json:"priority" gorm:"type:int;not null;default:0"`

	// Cancel at the end of the current period: keeps the subscription active until
	// EndTime then lets it expire naturally (display only; group downgrade on expiry
	// is already handled by ExpireDueSubscriptions).
	CancelAtEnd bool `json:"cancel_at_end"`

	// Mutual exclusion group snapshot from plan (empty = not exclusive).
	ExclusiveGroup string `json:"exclusive_group" gorm:"type:varchar(64);default:''"`

	// Plan tier-priority snapshot at purchase, so upgrade/downgrade direction stays
	// stable even if the plan's Priority is edited later.
	TierPriority int `json:"tier_priority" gorm:"type:int;not null;default:0"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (s *UserSubscription) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	s.CreatedAt = now
	s.UpdatedAt = now
	return nil
}

func (s *UserSubscription) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

type SubscriptionSummary struct {
	Subscription *UserSubscription `json:"subscription"`
}

type SubscriptionResetResult struct {
	PlanId           int    `json:"plan_id"`
	MatchedCount     int    `json:"matched_count"`
	ResetCount       int    `json:"reset_count"`
	UserCount        int    `json:"user_count"`
	AdvanceResetTime bool   `json:"advance_reset_time"`
	PlanTitle        string `json:"-"`
	AffectedUserIds  []int  `json:"-"`
}

func calcPlanEndTime(start time.Time, plan *SubscriptionPlan) (int64, error) {
	if plan == nil {
		return 0, errors.New("plan is nil")
	}
	if plan.DurationValue <= 0 && plan.DurationUnit != SubscriptionDurationCustom {
		return 0, errors.New("duration_value must be > 0")
	}
	switch plan.DurationUnit {
	case SubscriptionDurationYear:
		return start.AddDate(plan.DurationValue, 0, 0).Unix(), nil
	case SubscriptionDurationMonth:
		return start.AddDate(0, plan.DurationValue, 0).Unix(), nil
	case SubscriptionDurationDay:
		return start.Add(time.Duration(plan.DurationValue) * 24 * time.Hour).Unix(), nil
	case SubscriptionDurationHour:
		return start.Add(time.Duration(plan.DurationValue) * time.Hour).Unix(), nil
	case SubscriptionDurationCustom:
		if plan.CustomSeconds <= 0 {
			return 0, errors.New("custom_seconds must be > 0")
		}
		return start.Add(time.Duration(plan.CustomSeconds) * time.Second).Unix(), nil
	default:
		return 0, fmt.Errorf("invalid duration_unit: %s", plan.DurationUnit)
	}
}

func NormalizeResetPeriod(period string) string {
	switch strings.TrimSpace(period) {
	case SubscriptionResetDaily, SubscriptionResetWeekly, SubscriptionResetMonthly, SubscriptionResetCustom:
		return strings.TrimSpace(period)
	default:
		return SubscriptionResetNever
	}
}

// weekStartUnix returns the UNIX timestamp of the Monday 00:00 that starts the
// calendar week containing t (Monday-based ISO week).
func weekStartUnix(t time.Time) int64 {
	daysSinceMonday := (int(t.Weekday()) + 6) % 7 // Sunday=0 -> 6, Monday=0
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location()).
		AddDate(0, 0, -daysSinceMonday).Unix()
}

// monthStartUnix returns the UNIX timestamp of the 1st 00:00 of the calendar
// month containing t.
func monthStartUnix(t time.Time) int64 {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location()).Unix()
}

// advanceSubscriptionWindows advances the reset-cycle and calendar week/month
// windows for a subscription to now, resetting each independent usage counter at
// its own boundary. Returns whether any window changed; the caller must persist
// the subscription when it returns true, otherwise stale counters could bypass
// the caps. The calendar week/month counters survive the subscription-relative
// reset period because they are never reset here except by their own rollover.
func advanceSubscriptionWindows(sub *UserSubscription, plan *SubscriptionPlan, now int64) bool {
	if sub == nil || plan == nil {
		return false
	}
	changed := false
	if period := NormalizeResetPeriod(plan.QuotaResetPeriod); period != SubscriptionResetNever {
		if sub.NextCycleResetAt > 0 && sub.NextCycleResetAt <= now {
			sub.CycleUsed = 0
			sub.CycleStartAt = now
			sub.NextCycleResetAt = calcNextResetTime(time.Unix(now, 0), plan, sub.EndTime)
			changed = true
		} else if sub.NextCycleResetAt == 0 {
			// Plan has a reset period but the window was never armed (fresh or
			// legacy row): grant a full cycle from now.
			sub.CycleUsed = 0
			sub.CycleStartAt = now
			sub.NextCycleResetAt = calcNextResetTime(time.Unix(now, 0), plan, sub.EndTime)
			changed = true
		}
	}
	nowT := time.Unix(now, 0)
	weekStart := weekStartUnix(nowT)
	if sub.WeekStartAt < weekStart {
		sub.WeekStartAt = weekStart
		sub.WeekUsed = 0
		changed = true
	}
	monthStart := monthStartUnix(nowT)
	if sub.MonthStartAt < monthStart {
		sub.MonthStartAt = monthStart
		sub.MonthUsed = 0
		changed = true
	}
	return changed
}

func calcNextResetTime(base time.Time, plan *SubscriptionPlan, endUnix int64) int64 {
	if plan == nil {
		return 0
	}
	period := NormalizeResetPeriod(plan.QuotaResetPeriod)
	if period == SubscriptionResetNever {
		return 0
	}
	var next time.Time
	switch period {
	case SubscriptionResetDaily:
		next = time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, base.Location()).
			AddDate(0, 0, 1)
	case SubscriptionResetWeekly:
		// Align to next Monday 00:00
		weekday := int(base.Weekday()) // Sunday=0
		// Convert to Monday=1..Sunday=7
		if weekday == 0 {
			weekday = 7
		}
		daysUntil := 8 - weekday
		next = time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, base.Location()).
			AddDate(0, 0, daysUntil)
	case SubscriptionResetMonthly:
		// Align to first day of next month 00:00
		next = time.Date(base.Year(), base.Month(), 1, 0, 0, 0, 0, base.Location()).
			AddDate(0, 1, 0)
	case SubscriptionResetCustom:
		if plan.QuotaResetCustomSeconds <= 0 {
			return 0
		}
		next = base.Add(time.Duration(plan.QuotaResetCustomSeconds) * time.Second)
	default:
		return 0
	}
	if endUnix > 0 && next.Unix() > endUnix {
		return 0
	}
	return next.Unix()
}

func GetSubscriptionPlanById(id int) (*SubscriptionPlan, error) {
	return getSubscriptionPlanByIdTx(nil, id)
}

func getSubscriptionPlanByIdTx(tx *gorm.DB, id int) (*SubscriptionPlan, error) {
	if id <= 0 {
		return nil, errors.New("invalid plan id")
	}
	key := subscriptionPlanCacheKey(id)
	if key != "" {
		if cached, found, err := getSubscriptionPlanCache().Get(key); err == nil && found {
			cached.NormalizeDefaults()
			return &cached, nil
		}
	}
	var plan SubscriptionPlan
	query := DB
	if tx != nil {
		query = tx
	}
	if err := query.Where("id = ?", id).First(&plan).Error; err != nil {
		return nil, err
	}
	plan.NormalizeDefaults()
	_ = getSubscriptionPlanCache().SetWithTTL(key, plan, subscriptionPlanCacheTTL())
	return &plan, nil
}

func CountUserSubscriptionsByPlan(userId int, planId int) (int64, error) {
	if userId <= 0 || planId <= 0 {
		return 0, errors.New("invalid userId or planId")
	}
	var count int64
	if err := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND plan_id = ?", userId, planId).
		Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func getUserGroupByIdTx(tx *gorm.DB, userId int) (string, error) {
	if userId <= 0 {
		return "", errors.New("invalid userId")
	}
	if tx == nil {
		tx = DB
	}
	var group string
	if err := lockForUpdate(tx).Model(&User{}).Where("id = ?", userId).Select(commonGroupCol).Find(&group).Error; err != nil {
		return "", err
	}
	return group, nil
}

func downgradeUserGroupForSubscriptionTx(tx *gorm.DB, sub *UserSubscription, now int64) (string, error) {
	if tx == nil || sub == nil {
		return "", errors.New("invalid downgrade args")
	}
	if !common.SubscriptionGroupUpgradeEnabled {
		return "", nil
	}
	downgradeGroup := strings.TrimSpace(sub.DowngradeGroup)
	upgradeGroup := strings.TrimSpace(sub.UpgradeGroup)
	// Nothing to do if neither an explicit downgrade target nor an upgrade snapshot exists.
	if downgradeGroup == "" && upgradeGroup == "" {
		return "", nil
	}
	currentGroup, err := getUserGroupByIdTx(tx, sub.UserId)
	if err != nil {
		return "", err
	}
	// If another active upgraded subscription exists, keep the current group.
	var activeSub UserSubscription
	activeQuery := tx.Where("user_id = ? AND status = ? AND end_time > ? AND id <> ? AND upgrade_group <> ''",
		sub.UserId, "active", now, sub.Id).
		Order("end_time desc, id desc").
		Limit(1).
		Find(&activeSub)
	if activeQuery.Error == nil && activeQuery.RowsAffected > 0 {
		return "", nil
	}
	// Determine the downgrade target: an explicit downgrade group takes precedence,
	// otherwise revert to the group held before purchase (legacy behavior).
	target := downgradeGroup
	if target == "" {
		// Legacy behavior: only revert when the subscription actually elevated the user.
		if currentGroup != upgradeGroup {
			return "", nil
		}
		target = strings.TrimSpace(sub.PrevUserGroup)
	}
	if target == "" || target == currentGroup {
		return "", nil
	}
	if err := tx.Model(&User{}).Where("id = ?", sub.UserId).
		Update("group", target).Error; err != nil {
		return "", err
	}
	return target, nil
}

func CreateUserSubscriptionFromPlanTx(tx *gorm.DB, userId int, plan *SubscriptionPlan, source string) (*UserSubscription, error) {
	if tx == nil {
		return nil, errors.New("tx is nil")
	}
	if plan == nil || plan.Id == 0 {
		return nil, errors.New("invalid plan")
	}
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	if plan.MaxPurchasePerUser > 0 {
		var count int64
		if err := tx.Model(&UserSubscription{}).
			Where("user_id = ? AND plan_id = ?", userId, plan.Id).
			Count(&count).Error; err != nil {
			return nil, err
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			return nil, errors.New("已达到该套餐购买上限")
		}
	}
	nowUnix := common.GetTimestamp() // app time: GetDBTimestamp() would need a second
	// connection, deadlocking when this runs inside a transaction on SQLite.
	now := time.Unix(nowUnix, 0)
	endUnix, err := calcPlanEndTime(now, plan)
	if err != nil {
		return nil, err
	}
	if plan.MaxCumulativeSeconds > 0 && endUnix-nowUnix > plan.MaxCumulativeSeconds {
		return nil, errors.New("该套餐单次最长时长超过累计上限")
	}
	resetBase := now
	nextCycleReset := calcNextResetTime(resetBase, plan, endUnix)
	cycleStartAt := int64(0)
	if nextCycleReset > 0 {
		cycleStartAt = now.Unix()
	}
	upgradeGroup := ""
	prevGroup := ""
	if common.SubscriptionGroupUpgradeEnabled {
		upgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
		if upgradeGroup != "" {
			currentGroup, err := getUserGroupByIdTx(tx, userId)
			if err != nil {
				return nil, err
			}
			if currentGroup != upgradeGroup {
				prevGroup = currentGroup
				if err := tx.Model(&User{}).Where("id = ?", userId).
					Update("group", upgradeGroup).Error; err != nil {
					return nil, err
				}
			}
		}
	}
	allowWalletOverflow := true
	if plan.AllowWalletOverflow != nil {
		allowWalletOverflow = *plan.AllowWalletOverflow
	}
	nowUnixAtCreate := now.Unix()
	sub := &UserSubscription{
		UserId:           userId,
		PlanId:           plan.Id,
		AmountTotal:      plan.TotalAmount,
		AmountUsed:       0,
		StartTime:        nowUnixAtCreate,
		EndTime:          endUnix,
		Status:           "active",
		Source:           source,
		CycleStartAt:     cycleStartAt,
		CycleUsed:        0,
		NextCycleResetAt: nextCycleReset,
		WeekStartAt:      weekStartUnix(now),
		WeekUsed:         0,
		MonthStartAt:     monthStartUnix(now),
		MonthUsed:        0,
		UpgradeGroup:     upgradeGroup,
		PrevUserGroup:    prevGroup,
		DowngradeGroup:   strings.TrimSpace(plan.DowngradeGroup),
		AllowWalletOverflow: allowWalletOverflow,
		ExclusiveGroup:   strings.TrimSpace(plan.ExclusiveGroup),
		TierPriority:     plan.Priority,
		CreatedAt:        common.GetTimestamp(),
		UpdatedAt:        common.GetTimestamp(),
	}
	if err := tx.Create(sub).Error; err != nil {
		return nil, err
	}
	return sub, nil
}

func refreshSubscriptionUserGroupCache(userId int, operation string) {
	if err := RefreshUserGroupCache(userId); err != nil {
		common.SysError(fmt.Sprintf("failed to refresh user group cache after %s for user %d: %v", operation, userId, err))
	}
}

// Complete a subscription order (idempotent). Creates a UserSubscription snapshot from the plan.
// expectedPaymentProvider guards against cross-gateway callback attacks (empty skips the check).
// actualPaymentMethod updates the order's PaymentMethod to reflect the real payment type used (empty skips update).
func CompleteSubscriptionOrder(tradeNo string, providerPayload string, expectedPaymentProvider string, actualPaymentMethod string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}
	var logUserId int
	var logPlanTitle string
	var logMoney float64
	var logPaymentMethod string
	var upgradeGroup string
	now := GetDBTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if expectedPaymentProvider != "" && order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status == common.TopUpStatusSuccess {
			return nil
		}
		if order.Status != common.TopUpStatusPending {
			return ErrSubscriptionOrderStatusInvalid
		}
		plan, err := GetSubscriptionPlanById(order.PlanId)
		if err != nil {
			return err
		}
		if !plan.Enabled {
			// still allow completion for already purchased orders
		}
		if order.ExtendSubscriptionId > 0 {
			// Renewal: extend the target subscription instead of creating a new one.
			var target UserSubscription
			if err := lockForUpdate(tx).
				Where("id = ? AND user_id = ?", order.ExtendSubscriptionId, order.UserId).
				First(&target).Error; err != nil {
				return errors.New("续费目标订阅不存在")
			}
			if err := RenewSubscriptionTx(tx, &target, plan, now); err != nil {
				return err
			}
		} else {
			subscription, err := CreateUserSubscriptionFromPlanTx(tx, order.UserId, plan, "order")
			if err != nil {
				return err
			}
			if subscription.PrevUserGroup != "" {
				upgradeGroup = strings.TrimSpace(subscription.UpgradeGroup)
			}
		}
		if err := upsertSubscriptionTopUpTx(tx, &order); err != nil {
			return err
		}
		order.Status = common.TopUpStatusSuccess
		order.CompleteTime = common.GetTimestamp()
		if providerPayload != "" {
			order.ProviderPayload = providerPayload
		}
		if actualPaymentMethod != "" && order.PaymentMethod != actualPaymentMethod {
			order.PaymentMethod = actualPaymentMethod
		}
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logPlanTitle = plan.Title
		logMoney = order.Money
		logPaymentMethod = order.PaymentMethod
		return nil
	})
	if err != nil {
		return err
	}
	if upgradeGroup != "" && logUserId > 0 {
		refreshSubscriptionUserGroupCache(logUserId, "subscription payment completion")
	}
	if logUserId > 0 {
		msg := fmt.Sprintf("订阅购买成功，套餐: %s，支付金额: %.2f，支付方式: %s", logPlanTitle, logMoney, logPaymentMethod)
		RecordLog(logUserId, LogTypeTopup, msg)
	}
	return nil
}

func upsertSubscriptionTopUpTx(tx *gorm.DB, order *SubscriptionOrder) error {
	if tx == nil || order == nil {
		return errors.New("invalid subscription order")
	}
	now := common.GetTimestamp()
	var topup TopUp
	if err := tx.Where("trade_no = ?", order.TradeNo).First(&topup).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			topup = TopUp{
				UserId:        order.UserId,
				Amount:        0,
				Money:         order.Money,
				TradeNo:       order.TradeNo,
				PaymentMethod: order.PaymentMethod,
				CreateTime:    order.CreateTime,
				CompleteTime:  now,
				Status:        common.TopUpStatusSuccess,
			}
			return tx.Create(&topup).Error
		}
		return err
	}
	topup.Money = order.Money
	if topup.PaymentMethod == "" {
		topup.PaymentMethod = order.PaymentMethod
	} else if topup.PaymentMethod != order.PaymentMethod {
		return ErrPaymentMethodMismatch
	}
	if topup.CreateTime == 0 {
		topup.CreateTime = order.CreateTime
	}
	topup.CompleteTime = now
	topup.Status = common.TopUpStatusSuccess
	return tx.Save(&topup).Error
}

func ExpireSubscriptionOrder(tradeNo string, expectedPaymentProvider string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if expectedPaymentProvider != "" && order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status != common.TopUpStatusPending {
			return nil
		}
		order.Status = common.TopUpStatusExpired
		order.CompleteTime = common.GetTimestamp()
		return tx.Save(&order).Error
	})
}

// Admin bind (no payment). Creates a UserSubscription from a plan.
func AdminBindSubscription(userId int, planId int, sourceNote string) (string, error) {
	if userId <= 0 || planId <= 0 {
		return "", errors.New("invalid userId or planId")
	}
	plan, err := GetSubscriptionPlanById(planId)
	if err != nil {
		return "", err
	}
	groupChanged := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		if common.SubscriptionMaxSimultaneous > 0 {
			var activeCount int64
			if err := tx.Model(&UserSubscription{}).
				Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", common.GetTimestamp()).
				Count(&activeCount).Error; err != nil {
				return err
			}
			if activeCount >= int64(common.SubscriptionMaxSimultaneous) {
				return fmt.Errorf("该用户同时持有的订阅数已达上限 %d", common.SubscriptionMaxSimultaneous)
			}
		}
		subscription, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, "admin")
		if err == nil {
			groupChanged = subscription.PrevUserGroup != ""
		}
		return err
	})
	if err != nil {
		return "", err
	}
	if groupChanged {
		refreshSubscriptionUserGroupCache(userId, "admin subscription creation")
		return fmt.Sprintf("用户分组将升级到 %s", plan.UpgradeGroup), nil
	}
	return "", nil
}

func calcSubscriptionBalanceQuota(priceAmount float64) (int, error) {
	if priceAmount <= 0 {
		return 0, nil
	}
	if common.QuotaPerUnit <= 0 {
		return 0, errors.New("额度单位配置错误")
	}
	quota := decimal.NewFromFloat(priceAmount).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
		Ceil().
		IntPart()
	return int(quota), nil
}

// createBalanceOrderTx records a successful wallet-based subscription order.
func createBalanceOrderTx(tx *gorm.DB, userId, planId, extendSubId int, money float64, chargedQuota int, prefix string, now int64) error {
	tradeNo := fmt.Sprintf("%sUSR%dNO%s%d", prefix, userId, common.GetRandomString(6), time.Now().UnixNano())
	order := &SubscriptionOrder{
		UserId:               userId,
		PlanId:               planId,
		Money:                money,
		TradeNo:              tradeNo,
		PaymentMethod:        PaymentMethodBalance,
		PaymentProvider:      PaymentProviderBalance,
		Status:               common.TopUpStatusSuccess,
		CreateTime:           now,
		CompleteTime:         now,
		ProviderPayload:      fmt.Sprintf("charged_quota=%d", chargedQuota),
		ExtendSubscriptionId: extendSubId,
	}
	return tx.Create(order).Error
}

// invalidateSubscriptionTx cancels a subscription immediately and downgrades the
// user group if needed. The subscription must already be locked by the caller.
func invalidateSubscriptionTx(tx *gorm.DB, sub *UserSubscription, now int64) (string, error) {
	if tx == nil || sub == nil {
		return "", errors.New("invalid invalidate args")
	}
	if err := tx.Model(sub).Updates(map[string]interface{}{
		"status":     "cancelled",
		"end_time":   now,
		"updated_at": common.GetTimestamp(),
	}).Error; err != nil {
		return "", err
	}
	return downgradeUserGroupForSubscriptionTx(tx, sub, now)
}

// calcSubscriptionRemainingValue returns the prorated monetary value of a
// subscription based on the fraction of time remaining. Quota already consumed is
// intentionally ignored.
func calcSubscriptionRemainingValue(sub *UserSubscription, plan *SubscriptionPlan) (float64, error) {
	if sub == nil || plan == nil {
		return 0, errors.New("invalid subscription or plan")
	}
	total := sub.EndTime - sub.StartTime
	if total <= 0 {
		return 0, nil
	}
	remain := sub.EndTime - GetDBTimestamp()
	if remain < 0 {
		remain = 0
	}
	if remain > total {
		remain = total
	}
	return plan.PriceAmount * float64(remain) / float64(total), nil
}

// userGroupAllowed reports whether a user group may subscribe to a plan. An empty
// whitelist (empty string, malformed JSON, or an empty JSON array) allows every group.
func userGroupAllowed(plan *SubscriptionPlan, group string) bool {
	if plan == nil || strings.TrimSpace(plan.AllowedGroups) == "" || strings.TrimSpace(group) == "" {
		return true
	}
	var groups []string
	if err := common.UnmarshalJsonStr(plan.AllowedGroups, &groups); err != nil {
		return true
	}
	// A legacy "[]" stored by an old frontend must not reject every group.
	return len(groups) == 0 || slices.Contains(groups, group)
}

// NormalizeSubscriptionPlanAllowedGroups collapses an allowed-groups whitelist to ""
// when it is empty (including a legacy "[]" JSON array), so the "empty = all groups
// allowed" invariant holds no matter how a frontend serialized the selection.
func NormalizeSubscriptionPlanAllowedGroups(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var groups []string
	if err := common.UnmarshalJsonStr(raw, &groups); err != nil {
		return raw // malformed JSON is treated as unrestricted at runtime; leave it
	}
	if len(groups) == 0 {
		return ""
	}
	return raw
}

// comparePlanTier compares the tier of two plans: >0 when a is higher, <0 when
// lower, 0 when equal. Tier is the plan Priority (higher = higher tier), with
// PriceAmount as a tiebreaker when priorities are equal. Used to label a mutual
// exclusion switch as an upgrade or downgrade.
func comparePlanTier(a, b *SubscriptionPlan) int {
	if a == nil || b == nil {
		return 0
	}
	if a.Priority != b.Priority {
		if a.Priority > b.Priority {
			return 1
		}
		return -1
	}
	if a.PriceAmount != b.PriceAmount {
		if a.PriceAmount > b.PriceAmount {
			return 1
		}
		return -1
	}
	return 0
}

// subscriptionEffectiveGroup resolves the mutual-exclusion group a subscription
// effectively belongs to: the snapshot stored at purchase wins, and when that is
// empty (rows created before the plan joined a group, or admin/DB-inserted rows)
// the plan's current group is used. The fallback keeps exclusivity and
// upgrade/downgrade detection correct for rows whose snapshot is missing.
func subscriptionEffectiveGroup(sub *UserSubscription, plan *SubscriptionPlan) string {
	if sub == nil {
		return ""
	}
	if g := strings.TrimSpace(sub.ExclusiveGroup); g != "" {
		return g
	}
	if plan == nil {
		return ""
	}
	return strings.TrimSpace(plan.ExclusiveGroup)
}

// effectiveSubscriptionExclusiveGroupTx resolves a subscription's mutual-exclusion
// group using the given DB/tx to look up the plan when the row snapshot is empty.
func effectiveSubscriptionExclusiveGroupTx(tx *gorm.DB, sub *UserSubscription) string {
	if sub == nil {
		return ""
	}
	plan, err := getSubscriptionPlanByIdTx(tx, sub.PlanId)
	if err != nil {
		plan = nil
	}
	return subscriptionEffectiveGroup(sub, plan)
}

// ValidateSubscriptionPurchaseGate checks the plan-level purchase gates for a user:
// the group whitelist and the exclusivity-group conflict. Returns an error when the
// purchase/renewal should be blocked. Used by the Epay path (which cannot run inside
// the balance strategy transaction).
func ValidateSubscriptionPurchaseGate(userId int, plan *SubscriptionPlan, subscriptionId int) error {
	if plan == nil {
		return errors.New("plan is nil")
	}
	userGroup, err := getUserGroupByIdTx(nil, userId)
	if err != nil {
		return err
	}
	if !userGroupAllowed(plan, userGroup) {
		return errors.New("该套餐仅限特定用户组订阅")
	}
	if plan.ExclusiveGroup != "" && common.SubscriptionExclusiveGroupEnabled {
		now := GetDBTimestamp()
		// The snapshot on a row can be empty (admin/DB-assigned before the plan
		// joined a group), so fall back to the plan's current group via
		// effectiveSubscriptionExclusiveGroupTx instead of a bare SQL filter.
		var subs []UserSubscription
		if err := DB.Where("user_id = ? AND status = ? AND end_time > ?",
			userId, "active", now).Find(&subs).Error; err != nil {
			return err
		}
		conflict := false
		for i := range subs {
			if subs[i].Id == subscriptionId {
				continue
			}
			if effectiveSubscriptionExclusiveGroupTx(nil, &subs[i]) == plan.ExclusiveGroup {
				conflict = true
				break
			}
		}
		if conflict {
			if subscriptionId > 0 {
				return errors.New("目标订阅与互斥组冲突，请先处理同组其他订阅")
			}
			return errors.New("该套餐与您现有的订阅互斥，请使用余额升降配")
		}
	}
	return nil
}

// PurchaseWithStrategy routes a wallet purchase to a full purchase, a renewal or a
// prorated upgrade/downgrade switch based on the plan's exclusivity group and the
// optional subscriptionId. Returns a human-readable summary message.
func PurchaseWithStrategy(userId int, planId int, subscriptionId int) (string, error) {
	if userId <= 0 || planId <= 0 {
		return "", errors.New("invalid userId or planId")
	}
	var logTitle string
	var logMoney float64
	var chargedQuota int
	var creditedQuota int64
	var upgradeGroupChanged bool
	var message string
	err := DB.Transaction(func(tx *gorm.DB) error {
		// App time: a DB-time round trip inside the transaction would need a second
		// connection, deadlocking on a single-connection SQLite pool.
		now := common.GetTimestamp()
		plan, err := getSubscriptionPlanByIdTx(tx, planId)
		if err != nil {
			return err
		}
		if !plan.Enabled {
			return errors.New("套餐未启用")
		}
		if plan.PriceAmount < 0 {
			return errors.New("套餐价格不能为负数")
		}
		userGroup, err := getUserGroupByIdTx(tx, userId)
		if err != nil {
			return err
		}
		if !userGroupAllowed(plan, userGroup) {
			return errors.New("该套餐仅限特定用户组订阅")
		}
		// Same exclusivity-group active subscription (if any). Skipped entirely when
		// the mutual-exclusion feature is disabled, so users may hold several plans.
		// The snapshot on a row can be empty (admin/DB-assigned before the plan
		// joined a group), so match via effectiveSubscriptionExclusiveGroupTx.
		var sameGroup UserSubscription
		if plan.ExclusiveGroup != "" && common.SubscriptionExclusiveGroupEnabled {
			var candidates []UserSubscription
			if err := lockForUpdate(tx).
				Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
				Order("end_time asc, id asc").
				Find(&candidates).Error; err != nil {
				return err
			}
			for i := range candidates {
				if effectiveSubscriptionExclusiveGroupTx(tx, &candidates[i]) == plan.ExclusiveGroup {
					sameGroup = candidates[i]
					break
				}
			}
		}
		nowUnix := common.GetTimestamp()
		if subscriptionId > 0 {
			// Renewal of an explicit subscription.
			if sameGroup.Id > 0 && sameGroup.Id != subscriptionId {
				return errors.New("目标订阅与互斥组冲突，请先处理同组其他订阅")
			}
			quota, err := renewSubscriptionWithBalanceTx(tx, userId, plan, subscriptionId, now)
			if err != nil {
				return err
			}
			chargedQuota = quota
			logTitle = plan.Title
			logMoney = plan.PriceAmount
			message = "续费成功"
			return createBalanceOrderTx(tx, userId, planId, subscriptionId, plan.PriceAmount, quota, "SUBREN", nowUnix)
		}
		if sameGroup.Id > 0 {
			// Prorated switch: upgrade (pay difference) or downgrade (refund difference).
			oldPlan, err := getSubscriptionPlanByIdTx(tx, sameGroup.PlanId)
			if err != nil {
				return err
			}
			value, err := calcSubscriptionRemainingValue(&sameGroup, oldPlan)
			if err != nil {
				return err
			}
			diff := plan.PriceAmount - value
			var user User
			if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
				return err
			}
			if diff > 0 {
				quota, err := calcSubscriptionBalanceQuota(diff)
				if err != nil {
					return err
				}
				if user.Quota < quota {
					return errors.New("余额不足，无法补差额")
				}
				if err := tx.Model(&User{}).Where("id = ?", userId).
					Update("quota", gorm.Expr("quota - ?", quota)).Error; err != nil {
					return err
				}
				chargedQuota = quota
			} else if diff < 0 {
				credit, err := calcSubscriptionBalanceQuota(-diff)
				if err != nil {
					return err
				}
				if err := tx.Model(&User{}).Where("id = ?", userId).
					Update("quota", gorm.Expr("quota + ?", credit)).Error; err != nil {
					return err
				}
				creditedQuota = int64(credit)
			}
			// Create the new subscription first, then retire the old one so the
			// downgrade logic keeps the elevated group from the new subscription.
			subscription, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, PaymentMethodBalance)
			if err != nil {
				return err
			}
			if subscription.PrevUserGroup != "" {
				upgradeGroupChanged = true
			}
			if _, err := invalidateSubscriptionTx(tx, &sameGroup, now); err != nil {
				return err
			}
			logTitle = plan.Title
			logMoney = diff
			switch tier := comparePlanTier(plan, oldPlan); {
			case tier > 0:
				message = fmt.Sprintf("已升级到 %s，补差额 %.2f", plan.Title, diff)
			case tier < 0:
				message = fmt.Sprintf("已降级到 %s，退还差额 %.2f", plan.Title, -diff)
			default:
				message = fmt.Sprintf("已切换到 %s", plan.Title)
			}
			return createBalanceOrderTx(tx, userId, planId, sameGroup.Id, diff, chargedQuota, "SUBSW", nowUnix)
		}
		// Full purchase.
		if plan.AllowBalancePay != nil && !*plan.AllowBalancePay {
			return errors.New("该套餐不允许使用余额兑换")
		}
		if common.SubscriptionMaxSimultaneous > 0 {
			var activeCount int64
			if err := tx.Model(&UserSubscription{}).
				Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
				Count(&activeCount).Error; err != nil {
				return err
			}
			if activeCount >= int64(common.SubscriptionMaxSimultaneous) {
				return fmt.Errorf("同时持有的订阅数已达上限 %d", common.SubscriptionMaxSimultaneous)
			}
		}
		quota, err := calcSubscriptionBalanceQuota(plan.PriceAmount)
		if err != nil {
			return err
		}
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		if quota > 0 && user.Quota < quota {
			return errors.New("余额不足")
		}
		if quota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("quota", gorm.Expr("quota - ?", quota)).Error; err != nil {
				return err
			}
		}
		subscription, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, PaymentMethodBalance)
		if err != nil {
			return err
		}
		if subscription.PrevUserGroup != "" {
			upgradeGroupChanged = true
		}
		chargedQuota = quota
		logTitle = plan.Title
		logMoney = plan.PriceAmount
		message = "购买成功"
		return createBalanceOrderTx(tx, userId, planId, 0, plan.PriceAmount, quota, "SUBBAL", nowUnix)
	})
	if err != nil {
		return "", err
	}
	if chargedQuota > 0 {
		if err := cacheDecrUserQuota(userId, int64(chargedQuota)); err != nil {
			common.SysLog("failed to decrease user quota cache after subscription purchase: " + err.Error())
		}
	}
	if creditedQuota > 0 {
		if err := cacheIncrUserQuota(userId, creditedQuota); err != nil {
			common.SysLog("failed to increase user quota cache after subscription downgrade refund: " + err.Error())
		}
	}
	if upgradeGroupChanged {
		refreshSubscriptionUserGroupCache(userId, "subscription purchase")
	}
	msg := fmt.Sprintf("订阅操作成功，套餐: %s，金额: %.2f，扣除额度: %d，退还额度: %d",
		logTitle, logMoney, chargedQuota, creditedQuota)
	RecordLog(userId, LogTypeTopup, msg)
	return message, nil
}

// RenewSubscriptionTx extends an existing active subscription by one plan period.
// The subscription must already be locked by the caller. Renewal appends the plan
// duration to EndTime (from the later of EndTime/now) and accumulates TotalAmount.
// The quota reset cycle is deliberately left untouched: it continues on its natural
// calendar schedule (advanceSubscriptionWindows resets CycleUsed when the boundary
// arrives), so renewing before a reset never swallows that reset.
func RenewSubscriptionTx(tx *gorm.DB, sub *UserSubscription, plan *SubscriptionPlan, now int64) error {
	if tx == nil || sub == nil || plan == nil {
		return errors.New("invalid renew args")
	}
	if sub.Status != "active" {
		return errors.New("订阅已失效，无法续费")
	}
	start := time.Unix(sub.EndTime, 0)
	if start.Before(time.Unix(now, 0)) {
		start = time.Unix(now, 0)
	}
	endUnix, err := calcPlanEndTime(start, plan)
	if err != nil {
		return err
	}
	// Prevent stacking subscription time indefinitely: the total remaining time
	// (end_time - now) after renewal must not exceed the plan cap.
	if plan.MaxCumulativeSeconds > 0 && endUnix-now > plan.MaxCumulativeSeconds {
		return errors.New("已达该套餐最长可续时长，无法继续续费")
	}
	sub.EndTime = endUnix
	sub.AmountTotal += plan.TotalAmount
	// 注意：不改 CycleStartAt/NextCycleResetAt——续费只延长订阅，重置周期照常按
	// 自然日历推进；若在此重新武装下次重置，会吞掉已排期的下一次重置（用户损失
	// 一个周期的重置额度）。
	// A user-initiated renewal overrides a pending cancel-at-end and clears any
	// previous auto-renew failure so the task may retry.
	sub.CancelAtEnd = false
	sub.AutoRenewFailed = false
	return tx.Save(sub).Error
}

// renewSubscriptionWithBalanceTx deducts the plan price from the user's wallet and
// renews the target subscription inside the given transaction.
func renewSubscriptionWithBalanceTx(tx *gorm.DB, userId int, plan *SubscriptionPlan, subscriptionId int, now int64) (int, error) {
	if plan == nil {
		return 0, errors.New("plan is nil")
	}
	if !plan.Enabled {
		return 0, errors.New("套餐未启用")
	}
	if plan.PriceAmount < 0 {
		return 0, errors.New("套餐价格不能为负数")
	}
	if plan.AllowBalancePay != nil && !*plan.AllowBalancePay {
		return 0, errors.New("该套餐不允许使用余额兑换")
	}
	requiredQuota, err := calcSubscriptionBalanceQuota(plan.PriceAmount)
	if err != nil {
		return 0, err
	}
	var user User
	if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
		return 0, err
	}
	if requiredQuota > 0 && user.Quota < requiredQuota {
		return 0, errors.New("余额不足")
	}
	if requiredQuota > 0 {
		if err := tx.Model(&User{}).Where("id = ?", userId).
			Update("quota", gorm.Expr("quota - ?", requiredQuota)).Error; err != nil {
			return 0, err
		}
	}
	var sub UserSubscription
	if err := lockForUpdate(tx).
		Where("id = ? AND user_id = ?", subscriptionId, userId).
		First(&sub).Error; err != nil {
		return 0, errors.New("订阅不存在")
	}
	if err := RenewSubscriptionTx(tx, &sub, plan, now); err != nil {
		return 0, err
	}
	return requiredQuota, nil
}

// UserCancelSubscription cancels a user subscription in one of two modes:
//   - immediate: ends the subscription now and downgrades the user group.
//   - end_period: keeps the subscription active until EndTime, disables auto-renew
//     and lets it expire naturally at the end of the period.
func UserCancelSubscription(userId int, subscriptionId int, mode string) (string, error) {
	if userId <= 0 || subscriptionId <= 0 {
		return "", errors.New("invalid userId or subscriptionId")
	}
	mode = strings.TrimSpace(mode)
	if mode != "immediate" && mode != "end_period" {
		return "", errors.New("无效的取消模式")
	}
	now := GetDBTimestamp()
	cacheGroup := ""
	var downgradeGroup string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ? AND user_id = ?", subscriptionId, userId).
			First(&sub).Error; err != nil {
			return errors.New("订阅不存在")
		}
		if sub.Status != "active" {
			return errors.New("订阅已失效")
		}
		if mode == "immediate" {
			target, err := invalidateSubscriptionTx(tx, &sub, now)
			if err != nil {
				return err
			}
			if target != "" {
				cacheGroup = target
				downgradeGroup = target
			}
			return nil
		}
		// end_period: keep active until the end, disable auto-renew.
		return tx.Model(&sub).Updates(map[string]interface{}{
			"auto_renew":    false,
			"cancel_at_end": true,
			"updated_at":    common.GetTimestamp(),
		}).Error
	})
	if err != nil {
		return "", err
	}
	if cacheGroup != "" {
		refreshSubscriptionUserGroupCache(userId, "subscription cancellation")
	}
	if downgradeGroup != "" {
		return fmt.Sprintf("订阅已取消，用户分组已回退到 %s", downgradeGroup), nil
	}
	if mode == "end_period" {
		return "订阅将于到期后自动失效", nil
	}
	return "订阅已取消", nil
}

// SetSubscriptionPriority makes the target subscription the most preferred
// (lowest priority value) among the user's active subscriptions.
func SetSubscriptionPriority(userId int, subscriptionId int) error {
	if !common.SubscriptionPriorityEnabled {
		return errors.New("订阅消费优先级功能未启用")
	}
	if userId <= 0 || subscriptionId <= 0 {
		return errors.New("invalid userId or subscriptionId")
	}
	now := GetDBTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ? AND user_id = ? AND status = ? AND end_time > ?", subscriptionId, userId, "active", now).
			First(&sub).Error; err != nil {
			return errors.New("订阅不存在或已失效")
		}
		// The most preferred subscription gets priority 0; others shift down by one.
		if err := tx.Model(&UserSubscription{}).
			Where("user_id = ? AND status = ? AND end_time > ? AND id <> ?", userId, "active", now, subscriptionId).
			Update("priority", gorm.Expr("priority + 1")).Error; err != nil {
			return err
		}
		return tx.Model(&sub).Update("priority", 0).Error
	})
}

// GetExpiringSubscriptions returns active subscriptions expiring within the next
// days days, ordered by expiry, enriched with the plan title.
func GetExpiringSubscriptions(userId int, days int) ([]AdminUserSubscriptionSummary, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	if days <= 0 {
		days = 7
	}
	now := GetDBTimestamp()
	cutoff := now + int64(days)*86400
	var subs []UserSubscription
	if err := DB.Where("user_id = ? AND status = ? AND end_time > ? AND end_time <= ?",
		userId, "active", now, cutoff).
		Order("end_time asc, id asc").Find(&subs).Error; err != nil {
		return nil, err
	}
	result := make([]AdminUserSubscriptionSummary, 0, len(subs))
	for _, sub := range subs {
		subCopy := sub
		item := AdminUserSubscriptionSummary{Subscription: &subCopy}
		if plan, err := GetSubscriptionPlanById(sub.PlanId); err == nil && plan != nil {
			item.PlanTitle = plan.Title
		}
		result = append(result, item)
	}
	return result, nil
}

type autoRenewSuccess struct {
	UserId      int
	ChargedQuota int
	PlanTitle   string
}

// flagAutoRenewFailed marks a subscription's auto-renew attempt as failed so the
// maintenance task stops retrying it every tick until the user acts.
func flagAutoRenewFailed(tx *gorm.DB, subId int) {
	_ = tx.Model(&UserSubscription{}).Where("id = ?", subId).
		Updates(map[string]interface{}{
			"auto_renew_failed": true,
			"updated_at":        common.GetTimestamp(),
		}).Error
}

// AutoRenewDueSubscriptions automatically renews subscriptions that are active,
// have auto-renew enabled and are within 24h of expiry. The renewal is paid from
// the user's wallet balance; on failure the subscription is flagged so the task
// does not retry every tick. Renewing extends EndTime, so it is naturally idempotent.
func AutoRenewDueSubscriptions(limit int) (int, error) {
	if !common.SubscriptionAutoRenewEnabled {
		return 0, nil
	}
	if limit <= 0 {
		limit = 200
	}
	now := GetDBTimestamp()
	deadline := now + 24*3600
	var subs []UserSubscription
	if err := DB.Where("status = ? AND end_time > ? AND end_time <= ? AND auto_renew = ? AND auto_renew_failed = ?",
		"active", now, deadline, true, false).
		Order("end_time asc, id asc").Limit(limit).Find(&subs).Error; err != nil {
		return 0, err
	}
	successes := make([]autoRenewSuccess, 0, len(subs))
	for _, sub := range subs {
		subCopy := sub
		plan, err := getSubscriptionPlanByIdTx(nil, sub.PlanId)
		if err != nil || plan == nil {
			continue
		}
		var charged int
		renewed := false
		err = DB.Transaction(func(tx *gorm.DB) error {
			var locked UserSubscription
			if err := lockForUpdate(tx).
				Where("id = ? AND auto_renew = ? AND auto_renew_failed = ?", subCopy.Id, true, false).
				First(&locked).Error; err != nil {
				return nil // already handled by another worker
			}
			// The user group whitelist still applies to auto-renewal.
			if userGroup, gerr := getUserGroupByIdTx(tx, locked.UserId); gerr != nil {
				return gerr
			} else if !userGroupAllowed(plan, userGroup) {
				flagAutoRenewFailed(tx, locked.Id)
				return nil
			}
			quota, rerr := renewSubscriptionWithBalanceTx(tx, locked.UserId, plan, locked.Id, now)
			if rerr != nil {
				// Flag the failure so the task stops retrying until the user acts.
				flagAutoRenewFailed(tx, locked.Id)
				return nil
			}
			charged = quota
			renewed = true
			return createBalanceOrderTx(tx, locked.UserId, plan.Id, locked.Id, plan.PriceAmount, quota, "SUBAUTO", common.GetTimestamp())
		})
		if err != nil {
			return len(successes), err
		}
		if renewed {
			successes = append(successes, autoRenewSuccess{
				UserId:       subCopy.UserId,
				ChargedQuota: charged,
				PlanTitle:    plan.Title,
			})
		}
	}
	for _, s := range successes {
		if s.ChargedQuota > 0 {
			if err := cacheDecrUserQuota(s.UserId, int64(s.ChargedQuota)); err != nil {
				common.SysLog("failed to decrease user quota cache after auto renewal: " + err.Error())
			}
		}
		msg := fmt.Sprintf("订阅自动续费成功，套餐: %s，扣除额度: %d", s.PlanTitle, s.ChargedQuota)
		RecordLog(s.UserId, LogTypeTopup, msg)
	}
	return len(successes), nil
}

// GetAllActiveUserSubscriptions returns all active subscriptions for a user.
func GetAllActiveUserSubscriptions(userId int) ([]SubscriptionSummary, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	now := common.GetTimestamp()
	var subs []UserSubscription
	err := DB.Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
		Order("end_time desc, id desc").
		Find(&subs).Error
	if err != nil {
		return nil, err
	}
	return buildSubscriptionSummaries(subs), nil
}

// HasActiveUserSubscription returns whether the user has any active subscription.
// This is a lightweight existence check to avoid heavy pre-consume transactions.
func HasActiveUserSubscription(userId int) (bool, error) {
	if userId <= 0 {
		return false, errors.New("invalid userId")
	}
	now := common.GetTimestamp()
	var count int64
	if err := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// CountActiveUserSubscriptions returns the number of active subscriptions a user holds.
func CountActiveUserSubscriptions(userId int) (int64, error) {
	if userId <= 0 {
		return 0, errors.New("invalid userId")
	}
	now := common.GetTimestamp()
	var count int64
	if err := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
		Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

// UserActiveSubscriptionsAllowWalletOverflow returns whether wallet balance may be used
// after the user's subscription quota is exhausted. A single active subscription that
// disallows wallet overflow (allow_wallet_overflow = false) blocks the fallback.
func UserActiveSubscriptionsAllowWalletOverflow(userId int) (bool, error) {
	if userId <= 0 {
		return false, errors.New("invalid userId")
	}
	now := common.GetTimestamp()
	var strictCount int64
	if err := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ? AND end_time > ? AND allow_wallet_overflow = ?",
			userId, "active", now, false).
		Count(&strictCount).Error; err != nil {
		return false, err
	}
	return strictCount == 0, nil
}

// GetAllUserSubscriptions returns all subscriptions (active and expired) for a user.
func GetAllUserSubscriptions(userId int) ([]SubscriptionSummary, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	var subs []UserSubscription
	// 管理端软删除（status = deleted）的订阅只保留在管理历史里，不出现在用户侧列表。
	err := DB.Where("user_id = ? AND status <> ?", userId, "deleted").
		Order("end_time desc, id desc").
		Find(&subs).Error
	if err != nil {
		return nil, err
	}
	return buildSubscriptionSummaries(subs), nil
}

func buildSubscriptionSummaries(subs []UserSubscription) []SubscriptionSummary {
	if len(subs) == 0 {
		return []SubscriptionSummary{}
	}
	result := make([]SubscriptionSummary, 0, len(subs))
	for _, sub := range subs {
		subCopy := sub
		result = append(result, SubscriptionSummary{
			Subscription: &subCopy,
		})
	}
	return result
}

// AdminUserSubscriptionSummary enriches a UserSubscription with owner and plan
// info for the admin global subscriptions view.
type AdminUserSubscriptionSummary struct {
	Subscription *UserSubscription `json:"subscription"`
	Username     string            `json:"username"`
	Email        string            `json:"email"`
	DisplayName  string            `json:"display_name"`
	PlanTitle    string            `json:"plan_title"`
}

// GetAllSubscriptionsByAdmin returns a paginated, filterable list of all user
// subscriptions across all users. Filters: status (active/expired/cancelled),
// userKeyword (username/email/display_name substring or user id), planId.
// Keeps the {subscription:{...}} wrapper convention so existing frontend types
// (UserSubscriptionRecord) can be reused alongside the enriched fields.
func GetAllSubscriptionsByAdmin(status string, userKeyword string, planId int, startIdx int, num int) ([]AdminUserSubscriptionSummary, int64, error) {
	if num <= 0 || num > searchHardLimit {
		num = searchHardLimit
	}
	if startIdx < 0 {
		startIdx = 0
	}

	base := DB.Model(&UserSubscription{})
	if status != "" {
		// 支持逗号分隔多状态，例如 status=deleted,cancelled,expired（历史订阅视图）。
		statuses := strings.Split(status, ",")
		base = base.Where("status IN ?", statuses)
	}
	if planId > 0 {
		base = base.Where("plan_id = ?", planId)
	}
	if userKeyword != "" {
		// Mirror SearchUsers: substring match on identity fields, plus exact user_id for numeric input.
		cond := "user_id IN (SELECT id FROM users WHERE username LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!')"
		args := []interface{}{"%" + userKeyword + "%", "%" + userKeyword + "%", "%" + userKeyword + "%"}
		if keywordInt, err := strconv.Atoi(userKeyword); err == nil {
			cond = "user_id = ? OR " + cond
			args = append([]interface{}{keywordInt}, args...)
		}
		base = base.Where("("+cond+")", args...)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var subs []UserSubscription
	if err := base.Order("end_time desc, id desc").Limit(num).Offset(startIdx).Find(&subs).Error; err != nil {
		return nil, 0, err
	}
	if len(subs) == 0 {
		return []AdminUserSubscriptionSummary{}, total, nil
	}

	// Bulk-fetch owner info (two-step + map, same pattern as GetAllLogs channel hydration).
	userIds := make(map[int]struct{}, len(subs))
	for _, sub := range subs {
		userIds[sub.UserId] = struct{}{}
	}
	idList := make([]int, 0, len(userIds))
	for id := range userIds {
		idList = append(idList, id)
	}
	var users []User
	if err := DB.Select("id, username, email, display_name").Where("id IN ?", idList).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	userMap := make(map[int]User, len(users))
	for _, u := range users {
		userMap[u.Id] = u
	}

	result := make([]AdminUserSubscriptionSummary, 0, len(subs))
	for _, sub := range subs {
		subCopy := sub
		item := AdminUserSubscriptionSummary{
			Subscription: &subCopy,
		}
		if u, ok := userMap[sub.UserId]; ok {
			item.Username = u.Username
			item.Email = u.Email
			item.DisplayName = u.DisplayName
		}
		if plan, err := GetSubscriptionPlanById(sub.PlanId); err == nil && plan != nil {
			item.PlanTitle = plan.Title
		}
		result = append(result, item)
	}
	return result, total, nil
}

// AdminInvalidateUserSubscription marks a user subscription as cancelled and ends it immediately.
func AdminInvalidateUserSubscription(userSubscriptionId int) (string, error) {
	if userSubscriptionId <= 0 {
		return "", errors.New("invalid userSubscriptionId")
	}
	now := common.GetTimestamp()
	cacheGroup := ""
	downgradeGroup := ""
	var userId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ?", userSubscriptionId).First(&sub).Error; err != nil {
			return err
		}
		userId = sub.UserId
		if err := tx.Model(&sub).Updates(map[string]interface{}{
			"status":     "cancelled",
			"end_time":   now,
			"updated_at": now,
		}).Error; err != nil {
			return err
		}
		target, err := downgradeUserGroupForSubscriptionTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if target != "" {
			cacheGroup = target
			downgradeGroup = target
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if cacheGroup != "" && userId > 0 {
		refreshSubscriptionUserGroupCache(userId, "admin subscription update")
	}
	if downgradeGroup != "" {
		return fmt.Sprintf("用户分组将回退到 %s", downgradeGroup), nil
	}
	return "", nil
}

// AdminDeleteUserSubscription soft-deletes a user subscription: the record is
// kept (status becomes "deleted") so it stays visible in the admin history view,
// and the user's group is downgraded as if the subscription had ended.
func AdminDeleteUserSubscription(userSubscriptionId int) (string, error) {
	if userSubscriptionId <= 0 {
		return "", errors.New("invalid userSubscriptionId")
	}
	now := common.GetTimestamp()
	cacheGroup := ""
	downgradeGroup := ""
	var userId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ?", userSubscriptionId).First(&sub).Error; err != nil {
			return err
		}
		userId = sub.UserId
		target, err := downgradeUserGroupForSubscriptionTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if target != "" {
			cacheGroup = target
			downgradeGroup = target
		}
		if err := tx.Model(&sub).Updates(map[string]interface{}{
			"status":     "deleted",
			"end_time":   now,
			"updated_at": now,
		}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if cacheGroup != "" && userId > 0 {
		refreshSubscriptionUserGroupCache(userId, "admin subscription deletion")
	}
	if downgradeGroup != "" {
		return fmt.Sprintf("用户分组将回退到 %s", downgradeGroup), nil
	}
	return "", nil
}

// AdminPurgeUserSubscription permanently deletes a user subscription row so it is
// gone from every view including the history list. Only non-active subscriptions
// (deleted/cancelled/expired) may be purged; an active subscription must be
// invalidated first so the user's group downgrade is not bypassed.
func AdminPurgeUserSubscription(userSubscriptionId int) (string, error) {
	if userSubscriptionId <= 0 {
		return "", errors.New("invalid userSubscriptionId")
	}
	now := common.GetTimestamp()
	cacheGroup := ""
	downgradeGroup := ""
	var userId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ?", userSubscriptionId).First(&sub).Error; err != nil {
			return err
		}
		if sub.Status == "active" {
			return errors.New("无法彻底删除活跃订阅，请先作废")
		}
		userId = sub.UserId
		target, err := downgradeUserGroupForSubscriptionTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if target != "" {
			cacheGroup = target
			downgradeGroup = target
		}
		if err := tx.Where("id = ?", userSubscriptionId).Delete(&UserSubscription{}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if cacheGroup != "" && userId > 0 {
		refreshSubscriptionUserGroupCache(userId, "admin subscription purge")
	}
	if downgradeGroup != "" {
		return fmt.Sprintf("用户分组将回退到 %s", downgradeGroup), nil
	}
	return "", nil
}

func resetUserSubscriptionTx(tx *gorm.DB, sub *UserSubscription, plan *SubscriptionPlan, now int64, advanceResetTime bool) error {
	if tx == nil || sub == nil || plan == nil {
		return errors.New("invalid reset args")
	}
	period := NormalizeResetPeriod(plan.QuotaResetPeriod)
	if period == SubscriptionResetNever {
		// No reset period: a manual reset grants the full TotalAmount again.
		sub.AmountUsed = 0
	} else {
		// Reset cycle: grant a fresh cycle, keep the cumulative AmountUsed.
		sub.CycleUsed = 0
		sub.CycleStartAt = now
	}
	if advanceResetTime {
		sub.NextCycleResetAt = calcNextResetTime(time.Unix(now, 0), plan, sub.EndTime)
	}
	return tx.Save(sub).Error
}

func buildSubscriptionResetResult(plan *SubscriptionPlan, subs []UserSubscription, advanceResetTime bool) *SubscriptionResetResult {
	userIds := make([]int, 0, len(subs))
	seenUsers := make(map[int]struct{}, len(subs))
	for _, sub := range subs {
		if _, ok := seenUsers[sub.UserId]; ok {
			continue
		}
		seenUsers[sub.UserId] = struct{}{}
		userIds = append(userIds, sub.UserId)
	}
	return &SubscriptionResetResult{
		PlanId:           plan.Id,
		MatchedCount:     len(subs),
		ResetCount:       len(subs),
		UserCount:        len(userIds),
		AdvanceResetTime: advanceResetTime,
		PlanTitle:        plan.Title,
		AffectedUserIds:  userIds,
	}
}

func adminResetUserSubscriptionsByPlanTx(tx *gorm.DB, userId int, plan *SubscriptionPlan, now int64, advanceResetTime bool) (*SubscriptionResetResult, error) {
	if tx == nil || plan == nil {
		return nil, errors.New("invalid reset args")
	}
	var subs []UserSubscription
	if err := lockForUpdate(tx).
		Where("user_id = ? AND plan_id = ? AND status = ? AND end_time > ?", userId, plan.Id, "active", now).
		Order("end_time asc, id asc").
		Find(&subs).Error; err != nil {
		return nil, err
	}
	if len(subs) == 0 {
		return nil, errors.New("该用户没有有效的此套餐订阅")
	}
	for i := range subs {
		if err := resetUserSubscriptionTx(tx, &subs[i], plan, now, advanceResetTime); err != nil {
			return nil, err
		}
	}
	return buildSubscriptionResetResult(plan, subs, advanceResetTime), nil
}

func adminResetPlanSubscriptionsTx(tx *gorm.DB, plan *SubscriptionPlan, now int64, advanceResetTime bool) (*SubscriptionResetResult, error) {
	if tx == nil || plan == nil {
		return nil, errors.New("invalid reset args")
	}
	var subs []UserSubscription
	if err := lockForUpdate(tx).
		Where("plan_id = ? AND status = ? AND end_time > ?", plan.Id, "active", now).
		Order("user_id asc, end_time asc, id asc").
		Find(&subs).Error; err != nil {
		return nil, err
	}
	for i := range subs {
		if err := resetUserSubscriptionTx(tx, &subs[i], plan, now, advanceResetTime); err != nil {
			return nil, err
		}
	}
	return buildSubscriptionResetResult(plan, subs, advanceResetTime), nil
}

func AdminResetUserSubscriptionsByPlan(userId int, planId int, advanceResetTime bool) (*SubscriptionResetResult, error) {
	if userId <= 0 || planId <= 0 {
		return nil, errors.New("invalid userId or planId")
	}
	var result *SubscriptionResetResult
	now := GetDBTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		plan, err := getSubscriptionPlanByIdTx(tx, planId)
		if err != nil {
			return err
		}
		result, err = adminResetUserSubscriptionsByPlanTx(tx, userId, plan, now, advanceResetTime)
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func AdminResetPlanSubscriptions(planId int, advanceResetTime bool) (*SubscriptionResetResult, error) {
	if planId <= 0 {
		return nil, errors.New("invalid planId")
	}
	var result *SubscriptionResetResult
	now := GetDBTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		plan, err := getSubscriptionPlanByIdTx(tx, planId)
		if err != nil {
			return err
		}
		result, err = adminResetPlanSubscriptionsTx(tx, plan, now, advanceResetTime)
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

type SubscriptionPreConsumeResult struct {
	UserSubscriptionId int
	PreConsumed        int64
	AmountTotal        int64
	AmountUsedBefore   int64
	AmountUsedAfter    int64
}

// ExpireDueSubscriptions marks expired subscriptions and handles group downgrade.
func ExpireDueSubscriptions(limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	now := GetDBTimestamp()
	var subs []UserSubscription
	if err := DB.Where("status = ? AND end_time > 0 AND end_time <= ?", "active", now).
		Order("end_time asc, id asc").
		Limit(limit).
		Find(&subs).Error; err != nil {
		return 0, err
	}
	if len(subs) == 0 {
		return 0, nil
	}
	expiredCount := 0
	userIds := make(map[int]struct{}, len(subs))
	for _, sub := range subs {
		if sub.UserId > 0 {
			userIds[sub.UserId] = struct{}{}
		}
	}
	for userId := range userIds {
		cacheGroup := ""
		err := DB.Transaction(func(tx *gorm.DB) error {
			res := tx.Model(&UserSubscription{}).
				Where("user_id = ? AND status = ? AND end_time > 0 AND end_time <= ?", userId, "active", now).
				Updates(map[string]interface{}{
					"status":     "expired",
					"updated_at": common.GetTimestamp(),
				})
			if res.Error != nil {
				return res.Error
			}
			expiredCount += int(res.RowsAffected)

			if !common.SubscriptionGroupUpgradeEnabled {
				return nil // 组升降级功能关闭：到期只标记状态，不改用户组
			}

			// If there's an active upgraded subscription, keep current group.
			var activeSub UserSubscription
			activeQuery := tx.Where("user_id = ? AND status = ? AND end_time > ? AND upgrade_group <> ''",
				userId, "active", now).
				Order("end_time desc, id desc").
				Limit(1).
				Find(&activeSub)
			if activeQuery.Error == nil && activeQuery.RowsAffected > 0 {
				return nil
			}

			// Find the most recently expired subscription that defines a group transition
			// (an explicit downgrade target or an upgrade snapshot to revert).
			var lastExpired UserSubscription
			expiredQuery := tx.Where("user_id = ? AND status = ? AND (downgrade_group <> '' OR upgrade_group <> '')",
				userId, "expired").
				Order("end_time desc, id desc").
				Limit(1).
				Find(&lastExpired)
			if expiredQuery.Error != nil || expiredQuery.RowsAffected == 0 {
				return nil
			}
			currentGroup, err := getUserGroupByIdTx(tx, userId)
			if err != nil {
				return err
			}
			// An explicit downgrade group takes precedence; otherwise revert to the
			// group held before purchase (legacy behavior, only when the subscription
			// actually elevated the user).
			target := strings.TrimSpace(lastExpired.DowngradeGroup)
			if target == "" {
				upgradeGroup := strings.TrimSpace(lastExpired.UpgradeGroup)
				prevGroup := strings.TrimSpace(lastExpired.PrevUserGroup)
				if upgradeGroup == "" || prevGroup == "" {
					return nil
				}
				if currentGroup != upgradeGroup {
					return nil
				}
				target = prevGroup
			}
			if target == "" || target == currentGroup {
				return nil
			}
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("group", target).Error; err != nil {
				return err
			}
			cacheGroup = target
			return nil
		})
		if err != nil {
			return expiredCount, err
		}
		if cacheGroup != "" {
			refreshSubscriptionUserGroupCache(userId, "subscription expiration")
		}
	}
	return expiredCount, nil
}

// SubscriptionPreConsumeRecord stores idempotent pre-consume operations per request.
type SubscriptionPreConsumeRecord struct {
	Id                 int    `json:"id"`
	RequestId          string `json:"request_id" gorm:"type:varchar(64);uniqueIndex"`
	UserId             int    `json:"user_id" gorm:"index"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"index"`
	PreConsumed        int64  `json:"pre_consumed" gorm:"type:bigint;not null;default:0"`
	Status             string `json:"status" gorm:"type:varchar(32);index"` // consumed/refunded
	CreatedAt          int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt          int64  `json:"updated_at" gorm:"bigint;index"`
}

func (r *SubscriptionPreConsumeRecord) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	r.CreatedAt = now
	r.UpdatedAt = now
	return nil
}

func (r *SubscriptionPreConsumeRecord) BeforeUpdate(tx *gorm.DB) error {
	r.UpdatedAt = common.GetTimestamp()
	return nil
}

// subscriptionRemaining returns the quota still available on a subscription after
// the caller has already advanced its windows. Each cap is independent and only
// applies when configured, so a zero TotalAmount (unlimited) never disables the
// cycle/week/month caps and a reset period never erases calendar usage.
// Returns math.MaxInt64 when nothing limits the subscription.
func subscriptionRemaining(sub *UserSubscription, plan *SubscriptionPlan) int64 {
	remaining := int64(math.MaxInt64)
	period := NormalizeResetPeriod(plan.QuotaResetPeriod)
	// TotalAmount is a cumulative cap only when no reset period exists or when a
	// per-cycle cap is configured on top of it; otherwise it is the per-cycle grant.
	cumulativeTotal := period == SubscriptionResetNever || plan.ResetAmountLimit > 0
	if cumulativeTotal && sub.AmountTotal > 0 {
		if r := sub.AmountTotal - sub.AmountUsed; r < remaining {
			remaining = r
		}
	}
	if period != SubscriptionResetNever {
		grant := plan.ResetAmountLimit
		if grant <= 0 {
			grant = sub.AmountTotal
		}
		if grant > 0 {
			if r := grant - sub.CycleUsed; r < remaining {
				remaining = r
			}
		}
	}
	if plan.WeeklyAmountLimit > 0 {
		if r := plan.WeeklyAmountLimit - sub.WeekUsed; r < remaining {
			remaining = r
		}
	}
	if plan.MonthlyAmountLimit > 0 {
		if r := plan.MonthlyAmountLimit - sub.MonthUsed; r < remaining {
			remaining = r
		}
	}
	return remaining
}

// PreConsumeUserSubscription pre-consumes from any active subscription total quota.
func PreConsumeUserSubscription(requestId string, userId int, modelName string, quotaType int, amount int64) (*SubscriptionPreConsumeResult, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	if strings.TrimSpace(requestId) == "" {
		return nil, errors.New("requestId is empty")
	}
	if amount <= 0 {
		return nil, errors.New("amount must be > 0")
	}
	now := GetDBTimestamp()

	returnValue := &SubscriptionPreConsumeResult{}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var existing SubscriptionPreConsumeRecord
		query := tx.Where("request_id = ?", requestId).Limit(1).Find(&existing)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			if existing.Status == "refunded" {
				return errors.New("subscription pre-consume already refunded")
			}
			var sub UserSubscription
			if err := tx.Where("id = ?", existing.UserSubscriptionId).First(&sub).Error; err != nil {
				return err
			}
			returnValue.UserSubscriptionId = sub.Id
			returnValue.PreConsumed = existing.PreConsumed
			returnValue.AmountTotal = sub.AmountTotal
			returnValue.AmountUsedBefore = sub.AmountUsed
			returnValue.AmountUsedAfter = sub.AmountUsed
			return nil
		}

		var subs []UserSubscription
		if err := lockForUpdate(tx).
			Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
			Order("priority asc, end_time asc, id asc").
			Find(&subs).Error; err != nil {
			return errors.New("no active subscription")
		}
		if len(subs) == 0 {
			return errors.New("no active subscription")
		}
		for _, candidate := range subs {
			sub := candidate
			plan, err := getSubscriptionPlanByIdTx(tx, sub.PlanId)
			if err != nil {
				return err
			}
			if advanceSubscriptionWindows(&sub, plan, now) {
				if err := tx.Save(&sub).Error; err != nil {
					return err
				}
			}
			if subscriptionRemaining(&sub, plan) < amount {
				continue
			}
			usedBefore := sub.AmountUsed
			record := &SubscriptionPreConsumeRecord{
				RequestId:          requestId,
				UserId:             userId,
				UserSubscriptionId: sub.Id,
				PreConsumed:        amount,
				Status:             "consumed",
			}
			if err := tx.Create(record).Error; err != nil {
				var dup SubscriptionPreConsumeRecord
				if err2 := tx.Where("request_id = ?", requestId).First(&dup).Error; err2 == nil {
					if dup.Status == "refunded" {
						return errors.New("subscription pre-consume already refunded")
					}
					returnValue.UserSubscriptionId = sub.Id
					returnValue.PreConsumed = dup.PreConsumed
					returnValue.AmountTotal = sub.AmountTotal
					returnValue.AmountUsedBefore = sub.AmountUsed
					returnValue.AmountUsedAfter = sub.AmountUsed
					return nil
				}
				return err
			}
			sub.AmountUsed += amount
			sub.CycleUsed += amount
			sub.WeekUsed += amount
			sub.MonthUsed += amount
			if err := tx.Save(&sub).Error; err != nil {
				return err
			}
			returnValue.UserSubscriptionId = sub.Id
			returnValue.PreConsumed = amount
			returnValue.AmountTotal = sub.AmountTotal
			returnValue.AmountUsedBefore = usedBefore
			returnValue.AmountUsedAfter = sub.AmountUsed
			return nil
		}
		return fmt.Errorf("subscription quota insufficient, need=%d", amount)
	})
	if err != nil {
		return nil, err
	}
	return returnValue, nil
}

// RefundSubscriptionPreConsume is idempotent and refunds pre-consumed subscription quota by requestId.
func RefundSubscriptionPreConsume(requestId string) error {
	if strings.TrimSpace(requestId) == "" {
		return errors.New("requestId is empty")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var record SubscriptionPreConsumeRecord
		if err := lockForUpdate(tx).
			Where("request_id = ?", requestId).First(&record).Error; err != nil {
			return err
		}
		if record.Status == "refunded" {
			return nil
		}
		if record.PreConsumed <= 0 {
			record.Status = "refunded"
			return tx.Save(&record).Error
		}
		if err := PostConsumeUserSubscriptionDelta(tx, record.UserSubscriptionId, -record.PreConsumed); err != nil {
			return err
		}
		record.Status = "refunded"
		return tx.Save(&record).Error
	})
}

// ResetDueSubscriptions proactively advances the reset-cycle windows of
// subscriptions whose next_cycle_reset_at has passed. This only keeps admin views
// and notifications fresh; correctness does not depend on it because
// PreConsumeUserSubscription advances windows lazily before every cap check.
func ResetDueSubscriptions(limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	now := GetDBTimestamp()
	var subs []UserSubscription
	if err := DB.Where("next_cycle_reset_at > 0 AND next_cycle_reset_at <= ? AND status = ?", now, "active").
		Order("next_cycle_reset_at asc").
		Limit(limit).
		Find(&subs).Error; err != nil {
		return 0, err
	}
	if len(subs) == 0 {
		return 0, nil
	}
	resetCount := 0
	for _, sub := range subs {
		subCopy := sub
		plan, err := getSubscriptionPlanByIdTx(nil, sub.PlanId)
		if err != nil || plan == nil {
			continue
		}
		err = DB.Transaction(func(tx *gorm.DB) error {
			var locked UserSubscription
			if err := lockForUpdate(tx).
				Where("id = ? AND next_cycle_reset_at > 0 AND next_cycle_reset_at <= ?", subCopy.Id, now).
				First(&locked).Error; err != nil {
				return nil
			}
			if advanceSubscriptionWindows(&locked, plan, now) {
				if err := tx.Save(&locked).Error; err != nil {
					return err
				}
			}
			resetCount++
			return nil
		})
		if err != nil {
			return resetCount, err
		}
	}
	return resetCount, nil
}

// CleanupSubscriptionPreConsumeRecords removes old idempotency records to keep table small.
func CleanupSubscriptionPreConsumeRecords(olderThanSeconds int64) (int64, error) {
	if olderThanSeconds <= 0 {
		olderThanSeconds = 7 * 24 * 3600
	}
	cutoff := GetDBTimestamp() - olderThanSeconds
	res := DB.Where("updated_at < ?", cutoff).Delete(&SubscriptionPreConsumeRecord{})
	return res.RowsAffected, res.Error
}

type SubscriptionPlanInfo struct {
	PlanId    int
	PlanTitle string
}

func GetSubscriptionPlanInfoByUserSubscriptionId(userSubscriptionId int) (*SubscriptionPlanInfo, error) {
	if userSubscriptionId <= 0 {
		return nil, errors.New("invalid userSubscriptionId")
	}
	cacheKey := fmt.Sprintf("sub:%d", userSubscriptionId)
	if cached, found, err := getSubscriptionPlanInfoCache().Get(cacheKey); err == nil && found {
		return &cached, nil
	}
	var sub UserSubscription
	if err := DB.Where("id = ?", userSubscriptionId).First(&sub).Error; err != nil {
		return nil, err
	}
	plan, err := getSubscriptionPlanByIdTx(nil, sub.PlanId)
	if err != nil {
		return nil, err
	}
	info := &SubscriptionPlanInfo{
		PlanId:    sub.PlanId,
		PlanTitle: plan.Title,
	}
	_ = getSubscriptionPlanInfoCache().SetWithTTL(cacheKey, *info, subscriptionPlanInfoCacheTTL())
	return info, nil
}

// Update subscription used amount by delta (positive consume more, negative refund).
// db 指定执行事务的连接：传 nil 使用全局 DB；调用方若已处于事务内，应传入外层 tx，
// 让 delta 更新作为 savepoint 嵌套在同一个连接上，保证与事务一起提交/回滚。切勿在
// 外层事务中再对全局 DB 另开事务（不同连接）：SQLite+WAL 下会因读快照过期触发
// SQLITE_BUSY_SNAPSHOT（database is locked），MySQL 下则破坏外层事务原子性。
func PostConsumeUserSubscriptionDelta(db *gorm.DB, userSubscriptionId int, delta int64) error {
	if userSubscriptionId <= 0 {
		return errors.New("invalid userSubscriptionId")
	}
	if delta == 0 {
		return nil
	}
	if db == nil {
		db = DB
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ?", userSubscriptionId).
			First(&sub).Error; err != nil {
			return err
		}
		// AmountTotal is a cumulative cap only when the plan has no reset period or
		// has a per-cycle cap on top; otherwise usage legitimately exceeds it across
		// cycles, so the guard is skipped.
		cumulativeTotal := true
		if plan, err := getSubscriptionPlanByIdTx(tx, sub.PlanId); err == nil && plan != nil {
			period := NormalizeResetPeriod(plan.QuotaResetPeriod)
			cumulativeTotal = period == SubscriptionResetNever || plan.ResetAmountLimit > 0
		}
		newUsed := sub.AmountUsed + delta
		if newUsed < 0 {
			newUsed = 0
		}
		if cumulativeTotal && sub.AmountTotal > 0 && newUsed > sub.AmountTotal {
			return fmt.Errorf("subscription used exceeds total, used=%d total=%d", newUsed, sub.AmountTotal)
		}
		sub.AmountUsed = newUsed
		sub.CycleUsed = clampNonNegative(sub.CycleUsed+delta)
		sub.WeekUsed = clampNonNegative(sub.WeekUsed+delta)
		sub.MonthUsed = clampNonNegative(sub.MonthUsed+delta)
		return tx.Save(&sub).Error
	})
}

func clampNonNegative(v int64) int64 {
	if v < 0 {
		return 0
	}
	return v
}
