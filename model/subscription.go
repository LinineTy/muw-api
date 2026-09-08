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
	"gorm.io/gorm/clause"
)

// Subscription duration units
const (
	SubscriptionDurationYear   = "year"
	SubscriptionDurationMonth  = "month"
	SubscriptionDurationDay    = "day"
	SubscriptionDurationHour   = "hour"
	SubscriptionDurationCustom = "custom"
)

// 动态重置窗口时长单位（ResetWindow.Unit）。周按 7 天、月按日历 AddDate 计算。
const (
	SubscriptionWindowUnitHour  = "hour"
	SubscriptionWindowUnitDay   = "day"
	SubscriptionWindowUnitWeek  = "week"
	SubscriptionWindowUnitMonth = "month"
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

	// 动态重置窗口列表（JSON 数组文本），唯一额度模型：必须非空（全部窗口额度 0 = 无限），
	// 空串由校验层拒绝。TEXT 列不带字面 DEFAULT。
	ResetWindowsRaw string `json:"reset_windows" gorm:"column:reset_windows;type:text"`

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

// ResetWindow 是订阅的动态重置窗口定义：每 unit 个 value 周期内最多消耗 limit 额度。
// 窗口订阅相对（锚定订阅生效日/最近重置点）；窗口时长 ≥ 剩余有效期的窗口订阅内不刷新，
// 其 limit 成为本订阅的封顶上限。
type ResetWindow struct {
	Unit  string `json:"unit"` // hour/day/week/month
	Value int    `json:"value"`
	Limit int64  `json:"limit"`
}

// WindowState 是某个窗口在订阅上的独立消费状态，与套餐 reset_windows 按 index 对应。
// cycle_start_at == 0 && next_reset_at == 0 = 从未武装；next_reset_at == 0 && cycle_start_at > 0
// = 封顶态（下一次重置超出 EndTime，计数持续累计不刷新）。
type WindowState struct {
	Idx          int   `json:"idx"`
	CycleUsed    int64 `json:"cycle_used"`
	CycleStartAt int64 `json:"cycle_start_at"`
	NextResetAt  int64 `json:"next_reset_at"`
}

// ResetWindows 解析套餐的动态重置窗口列表（JSON 数组）；空串或损坏数据返回 nil
// （调用方按无窗口 = 无限额度处理）。TEXT 列不能带字面 DEFAULT（MySQL error 1101），
// 零值（空串）由应用层处理，参照 AllowedGroups。
func (p *SubscriptionPlan) ResetWindows() []ResetWindow {
	if p == nil || strings.TrimSpace(p.ResetWindowsRaw) == "" {
		return nil
	}
	var windows []ResetWindow
	if err := common.UnmarshalJsonStr(p.ResetWindowsRaw, &windows); err != nil {
		return nil
	}
	return windows
}

// WindowStates 解析订阅的动态窗口消费状态；空/损坏时返回 nil。
func (s *UserSubscription) WindowStates() []WindowState {
	if s == nil || strings.TrimSpace(s.WindowState) == "" {
		return nil
	}
	var states []WindowState
	if err := common.UnmarshalJsonStr(s.WindowState, &states); err != nil {
		return nil
	}
	return states
}

// SetWindowStates 序列化窗口状态并写回（nil/空列表写空串）。
func (s *UserSubscription) SetWindowStates(states []WindowState) {
	if len(states) == 0 {
		s.WindowState = ""
		return
	}
	data, err := common.Marshal(states)
	if err != nil {
		s.WindowState = ""
		return
	}
	s.WindowState = string(data)
}

// ResetWindowsEqual 判断两份 reset_windows 原始文本是否表示相同的窗口列表。
// 语义比较（解析后逐项比对）而非字节比较：管理端保存套餐时前端会重新序列化
// （键序/空白/美元额度浮点往返都可能造成字节差异），若用字符串判等，仅改标题也会
// 误触发「改动即重置」清空该套餐全部活跃订阅的窗口计数。解析失败时退回字节比较，
// 保守不判等，避免畸形数据误重置。
func ResetWindowsEqual(a, b string) bool {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" && b == "" {
		return true
	}
	aw, aok := parseResetWindowsStrict(a)
	bw, bok := parseResetWindowsStrict(b)
	if !aok || !bok {
		return a == b
	}
	return slices.Equal(aw, bw)
}

func parseResetWindowsStrict(raw string) ([]ResetWindow, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, true
	}
	var windows []ResetWindow
	if err := common.UnmarshalJsonStr(raw, &windows); err != nil {
		return nil, false
	}
	return windows, true
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

	// 订单种类（订阅 / 固定分组）。group_pin 订单完成时创建 GroupPin（固定分组钉）
	// 而非订阅，PinProductId 指向 group_pin_products 行；PlanId 此时不使用。
	Kind         string `json:"kind" gorm:"type:varchar(20);not null;default:'subscription'"`
	PinProductId int    `json:"pin_product_id" gorm:"type:int;not null;default:0"`
}

// SubscriptionOrderKind 订单种类常量。
const (
	OrderKindSubscription = "subscription"
	OrderKindGroupPin     = "group_pin"
)

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

// GetUserSubscriptionOrders 分页查询某用户的订阅订单（可选按 trade_no 搜索 + status/payment_method 过滤）。
func GetUserSubscriptionOrders(userId int, pageInfo *common.PageInfo, keyword string, status string, method string) (orders []SubscriptionOrder, total int64, err error) {
	query := DB.Model(&SubscriptionOrder{}).Where("user_id = ?", userId)
	if keyword != "" {
		pattern, perr := tradeNoLikePattern(keyword)
		if perr != nil {
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}
	query = applyOrderStatusMethodFilter(query, status, method)
	if err = query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&orders).Error; err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}

// GetAllSubscriptionOrders 管理员分页查询全平台订阅订单（可选按 trade_no 搜索 + status/payment_method 过滤）。
func GetAllSubscriptionOrders(pageInfo *common.PageInfo, keyword string, status string, method string) (orders []SubscriptionOrder, total int64, err error) {
	query := DB.Model(&SubscriptionOrder{})
	if keyword != "" {
		pattern, perr := tradeNoLikePattern(keyword)
		if perr != nil {
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}
	query = applyOrderStatusMethodFilter(query, status, method)
	if err = query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&orders).Error; err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}

// User subscription instance
type UserSubscription struct {
	Id     int `json:"id"`
	UserId int `json:"user_id" gorm:"index;index:idx_user_sub_active,priority:1"`
	PlanId int `json:"plan_id" gorm:"index"`

	// 单期账本：PeriodUsed 是当前预付期（购买/最近一次续费）内的累计消耗（quota units），
	// 续费清零重开。退款 clamp 用它折算已消耗价值，防"烧爆额度→降级退款"套利。
	// 展示额度来自窗口（buildLimitRows），本字段是账本不是额度。
	PeriodUsed int64 `json:"period_used" gorm:"column:period_used;type:bigint;not null;default:0"`

	StartTime int64  `json:"start_time" gorm:"bigint"`
	EndTime   int64  `json:"end_time" gorm:"bigint;index;index:idx_user_sub_active,priority:3"`
	Status    string `json:"status" gorm:"type:varchar(32);index;index:idx_user_sub_active,priority:2"` // active/expired/cancelled

	Source string `json:"source" gorm:"type:varchar(32);default:'order'"` // order/admin/balance

	// 自然日历周/月展示计数（供钱包卡「订阅抵扣」按日历月统计；动态模型下不作额度
	// 上限，仅展示）。legacy 移除后只保留展示语义。
	WeekStartAt  int64 `json:"week_start_at" gorm:"type:bigint;not null;default:0"`
	WeekUsed     int64 `json:"week_used" gorm:"type:bigint;not null;default:0"`
	MonthStartAt int64 `json:"month_start_at" gorm:"type:bigint;not null;default:0"`
	MonthUsed    int64 `json:"month_used" gorm:"type:bigint;not null;default:0"`

	// 动态窗口消费状态（JSON 数组文本，与套餐 reset_windows 按 index 对应）。
	// 每个订阅都是动态窗口订阅（唯一模型）；状态缺失时按满额处理，由 advance 补齐。
	WindowState string `json:"window_state" gorm:"type:text"`

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

	// 续费条款快照（购买时写入、续费不刷新，JSON 文本）。续费价格/周期时长/单期额度/
	// 累计上限都取快照，保证"续费走旧条款"，不受套餐后续编辑影响。空 = 无快照（存量
	// 订阅），续费与升降配估值回退到套餐当前条款。
	RenewTerms string `json:"renew_terms" gorm:"type:text"`

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
	// 套餐快照（含已禁用套餐）：用户侧列表据此渲染套餐名/限额等详情，即使套餐被停售
	// 也不会退化成 #id。未命中（套餐已被删除）时省略。
	Plan *SubscriptionPlan `json:"plan,omitempty"`
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

// RenewTermsSnapshot 记录购买时的套餐条款。续费价格、周期时长、累计上限均取快照，
// 保证"续费走旧条款"，不受套餐后续编辑影响。
type RenewTermsSnapshot struct {
	DurationSeconds      int64   `json:"duration_seconds"`
	PriceAmount          float64 `json:"price_amount"`
	MaxCumulativeSeconds int64   `json:"max_cumulative_seconds"`
}

// planDurationSeconds 返回套餐单个周期从 startUnix 起的时长（秒）。月/年按日历算术，
// 时长依赖起始日期，快照落地时按购买时刻精确计算。
func planDurationSeconds(plan *SubscriptionPlan, startUnix int64) int64 {
	if plan == nil {
		return 0
	}
	endUnix, err := calcPlanEndTime(time.Unix(startUnix, 0), plan)
	if err != nil {
		return 0
	}
	return endUnix - startUnix
}

// SnapshotRenewTerms 把当前套餐条款写入订阅快照（购买时调用）。续费/升降配估值据此
// 使用旧条款；计算失败时清空快照，让后续回退到套餐当前条款。
func (s *UserSubscription) SnapshotRenewTerms(plan *SubscriptionPlan, startUnix int64) {
	if s == nil || plan == nil {
		return
	}
	terms := RenewTermsSnapshot{
		DurationSeconds:      planDurationSeconds(plan, startUnix),
		PriceAmount:          plan.PriceAmount,
		MaxCumulativeSeconds: plan.MaxCumulativeSeconds,
	}
	data, err := common.Marshal(terms)
	if err != nil || terms.DurationSeconds <= 0 {
		s.RenewTerms = ""
		return
	}
	s.RenewTerms = string(data)
}

// RenewTermsOrPlan 返回订阅的续费条款快照；无快照（存量订阅）时回退到套餐当前条款，
// 周期时长按订阅的 StartTime 估算。
func (s *UserSubscription) RenewTermsOrPlan(plan *SubscriptionPlan) RenewTermsSnapshot {
	fallback := RenewTermsSnapshot{
		PriceAmount:          plan.PriceAmount,
		MaxCumulativeSeconds: plan.MaxCumulativeSeconds,
	}
	if s == nil {
		fallback.DurationSeconds = planDurationSeconds(plan, 0)
		return fallback
	}
	if s.RenewTerms != "" {
		var terms RenewTermsSnapshot
		if err := common.UnmarshalJsonStr(s.RenewTerms, &terms); err == nil && terms.DurationSeconds > 0 {
			return terms
		}
	}
	fallback.DurationSeconds = planDurationSeconds(plan, s.StartTime)
	return fallback
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

// advanceSubscriptionWindows advances the dynamic reset windows and the calendar
// week/month display counters for a subscription to now, resetting each
// independent usage counter at its own boundary. Returns whether anything changed;
// the caller must persist the subscription when it returns true. 动态模型下
// week_used/month_used 仅作展示统计（钱包卡「订阅抵扣」），不作额度上限。
func advanceSubscriptionWindows(sub *UserSubscription, plan *SubscriptionPlan, now int64) bool {
	if sub == nil || plan == nil {
		return false
	}
	changed := false
	if advanceDynamicWindows(sub, plan.ResetWindows(), now) {
		changed = true
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

// advanceWindowState 推进单个动态窗口的状态机，返回是否变更。
//   - 状态 1：从未武装（cycle_start_at==0 && next_reset_at==0）→ 从 now 武装。
//   - 状态 2：封顶态（next_reset_at==0 && cycle_start_at>0）→ 重算边界；续费让 EndTime
//     变长后窗口可能恢复重置；若边界已过（晚续费）则立即重置（HOLE A 修正，消除
//     "续费后第一次预扣误拒"的一次性滞后）；仍超出 EndTime 则保持封顶（计数持续累计）。
//   - 状态 3：next_reset_at 到期 → 清零并重武装（重武装后可能回封顶态）。
func advanceWindowState(w ResetWindow, s *WindowState, now int64, endUnix int64) bool {
	if w.Limit <= 0 {
		return false // limit<=0 视为无此窗口上限，不参与推进
	}
	if s.NextResetAt == 0 && s.CycleStartAt == 0 {
		s.CycleUsed = 0
		s.CycleStartAt = now
		s.NextResetAt = calcWindowNextReset(w, now, endUnix)
		return true
	}
	if s.NextResetAt == 0 && s.CycleStartAt > 0 {
		b := calcWindowNextReset(w, s.CycleStartAt, endUnix)
		if b == 0 {
			return false // 仍超出 EndTime：保持封顶，累计不刷新
		}
		if b > now {
			s.NextResetAt = b // 续费后恢复为正常重置窗口
			return true
		}
		s.CycleUsed = 0
		s.CycleStartAt = now
		s.NextResetAt = calcWindowNextReset(w, now, endUnix)
		return true
	}
	if s.NextResetAt > 0 && s.NextResetAt <= now {
		s.CycleUsed = 0
		s.CycleStartAt = now
		s.NextResetAt = calcWindowNextReset(w, now, endUnix)
		return true
	}
	return false
}

// advanceDynamicWindows 推进订阅的全部动态窗口：缺失的窗口状态按序补齐（防 index
// 越界），任一窗口变更则序列化回写。
func advanceDynamicWindows(sub *UserSubscription, windows []ResetWindow, now int64) bool {
	if sub == nil {
		return false
	}
	states := sub.WindowStates()
	changed := false
	for i := range windows {
		if windows[i].Limit <= 0 {
			continue
		}
		for len(states) <= i {
			states = append(states, WindowState{Idx: len(states)})
		}
		if advanceWindowState(windows[i], &states[i], now, sub.EndTime) {
			changed = true
		}
	}
	if len(states) > len(windows) {
		states = states[:len(windows)] // 防御：窗口被删后丢弃残留状态（正常由转换重置处理）
	}
	if changed {
		sub.SetWindowStates(states)
	}
	return changed
}

// addWindowUsage 把 amount 累加到订阅的全部动态窗口计数（预扣成功时调用）。
func addWindowUsage(sub *UserSubscription, windows []ResetWindow, amount int64) {
	states := sub.WindowStates()
	for i := range windows {
		if i >= len(states) {
			continue
		}
		states[i].CycleUsed += amount
	}
	sub.SetWindowStates(states)
}

// calcWindowNextReset 返回动态窗口 w 从 baseUnix 起的下一次重置时刻（秒）。月按日历
// AddDate（与 calcPlanEndTime 一致，订阅相对锚定）、周=7天、天=24小时、小时=1小时。
// 若边界超出订阅 EndTime 返回 0 = 封顶（该窗口订阅内不再重置，limit 即本订阅总上限）。
func calcWindowNextReset(w ResetWindow, baseUnix int64, endUnix int64) int64 {
	if baseUnix <= 0 || w.Value <= 0 || endUnix <= 0 {
		return 0
	}
	base := time.Unix(baseUnix, 0)
	var next time.Time
	switch w.Unit {
	case SubscriptionWindowUnitMonth:
		next = base.AddDate(0, w.Value, 0)
	case SubscriptionWindowUnitWeek:
		next = base.Add(time.Duration(w.Value) * 7 * 24 * time.Hour)
	case SubscriptionWindowUnitDay:
		next = base.Add(time.Duration(w.Value) * 24 * time.Hour)
	case SubscriptionWindowUnitHour:
		next = base.Add(time.Duration(w.Value) * time.Hour)
	default:
		return 0
	}
	if next.Unix() > endUnix {
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

// DeleteSubscriptionPlan permanently removes a subscription plan. Only records that
// still resolve the plan by id at runtime block deletion: active subscriptions
// (billing, quota reset and renewal) and pending orders (payment callback). Historical
// records (expired/cancelled/deleted subscriptions, completed/expired orders) only
// affect display and fall back to the plan id, so they do not block. This lets admins
// delete a plan once its remaining subscriptions/orders have been cleaned up.
func DeleteSubscriptionPlan(planId int) (string, error) {
	if planId <= 0 {
		return "", errors.New("invalid plan id")
	}
	var plan SubscriptionPlan
	if err := DB.Where("id = ?", planId).First(&plan).Error; err != nil {
		return "", err
	}
	var activeSubCount int64
	if err := DB.Model(&UserSubscription{}).
		Where("plan_id = ? AND status = ? AND end_time > ?", planId, "active", common.GetTimestamp()).
		Count(&activeSubCount).Error; err != nil {
		return "", err
	}
	if activeSubCount > 0 {
		return "", errors.New("该套餐仍有活跃订阅，无法删除，请先作废相关订阅")
	}
	var pendingOrderCount int64
	if err := DB.Model(&SubscriptionOrder{}).
		Where("plan_id = ? AND status = ?", planId, common.TopUpStatusPending).
		Count(&pendingOrderCount).Error; err != nil {
		return "", err
	}
	if pendingOrderCount > 0 {
		return "", errors.New("该套餐仍有未完成订单，无法删除，请先处理相关订单")
	}
	if err := DB.Delete(&plan).Error; err != nil {
		return "", err
	}
	InvalidateSubscriptionPlanCache(planId)
	return "删除成功", nil
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
	// 其他活跃订阅赋予的最高优先级组（降级终点不得低于它——有订阅撑着就降到那个组）。
	// 撑组判定（legacy 行为：有其他活跃升级订阅就保组）无条件生效；两处优先级数值
	// 比较仅在运营配置了组优先级时生效——未配置全为 0，"同级拦"会把"过期回退"
	// 误伤成"永不回退"，用户被永久卡在升级组（2026-09-09 main 存量回归）。
	prioritiesEnabled := SubscriptionGroupPrioritiesEnabled()
	var otherSubs []UserSubscription
	if err := tx.Where("user_id = ? AND status = ? AND end_time > ? AND id <> ? AND upgrade_group <> ''",
		sub.UserId, "active", now, sub.Id).
		Order("end_time desc, id desc").
		Find(&otherSubs).Error; err != nil {
		return "", err
	}
	bestGroup, bestPriority := "", -1
	for _, other := range otherSubs {
		if p := GroupPriority(strings.TrimSpace(other.UpgradeGroup)); p > bestPriority {
			bestGroup, bestPriority = strings.TrimSpace(other.UpgradeGroup), p
		}
	}
	// 当前组正被其他活跃订阅撑着 → 不降（v2+v1 共存、v1 过期保持 v2）。
	if bestGroup == currentGroup {
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
	// 其他订阅撑着比显式目标更高的组 → 降到那个组（v2 过期、v1 还活着 → 回 v1 而非底组）。
	if prioritiesEnabled && bestPriority > GroupPriority(target) {
		target = bestGroup
	}
	// 目标优先级 ≥ 当前 → 不降（同级也拦：过期还组不换同档组；防错配把人往高处"降"）。
	if prioritiesEnabled && GroupPriority(target) >= GroupPriority(currentGroup) {
		return "", nil
	}
	if err := tx.Model(&User{}).Where("id = ?", sub.UserId).
		Update("group", target).Error; err != nil {
		return "", err
	}
	return target, nil
}

// subscriptionAnchorGroup 返回订阅当前贡献的用户组锚点（空串 = 不贡献）：
// 仅 active 订阅贡献其 upgrade_group（订阅生效期间拿到的档）；expired/cancelled/deleted
// 一律不贡献——"到期仍固定在档"的诉求由固定分组钉（GroupPin，见 group_pin.go）承载，
// 订阅行自身不再有钉子语义。
func subscriptionAnchorGroup(s *UserSubscription) string {
	if s == nil {
		return ""
	}
	up := strings.TrimSpace(s.UpgradeGroup)
	if up == "" {
		return ""
	}
	if s.Status == "active" {
		return up
	}
	return ""
}

// subscriptionDrainGroup 返回订阅结束导致"彻底无锚"时的断档兜底组（仅锚点态使用）。
// 按 downgrade_group → prev_user_group 回退；无降级目标/基底的阶梯订阅落 default
// 兜底（防幽灵高档）。完全非阶梯订阅（三字段全空）返回空串 = 不移动组，避免清掉
// 非订阅来源的手动分组。
func subscriptionDrainGroup(s *UserSubscription) string {
	if s == nil {
		return ""
	}
	down := strings.TrimSpace(s.DowngradeGroup)
	prev := strings.TrimSpace(s.PrevUserGroup)
	if down == "" && prev == "" {
		if strings.TrimSpace(s.UpgradeGroup) == "" {
			return ""
		}
		return "default"
	}
	if down != "" {
		return down
	}
	return prev
}

// settleUserSubscriptionGroupTx 是锚点态（已配置组优先级）下订阅生命周期事件后的组收敛：
// 组 = 现存最高锚点（active 订阅 upgrade_group + active 固定分组钉，见 subscriptionAnchorGroup
// 与 activeGroupPinGroupTx）；现存无锚点（彻底断档）时按 drainTarget 兜底，且只允许
// "真降"（目标优先级 < 当前，同级也拦——防错配把人在过期时平移到/抬到不该去的组）。
// drainTarget 由调用方按事件语义给定（订阅结束 = subscriptionDrainGroup(ended)；
// 解除固定分组钉 = 最近 ended 订阅的 drain 或 default），空串 = 断档时不移动组。
// 返回收敛后的组与是否变更；未变更不写库。事务内调用，只用 tx；调用方变更后刷用户组缓存。
func settleUserSubscriptionGroupTx(tx *gorm.DB, userId int, drainTarget string) (string, bool, error) {
	if tx == nil || userId <= 0 {
		return "", false, errors.New("invalid settle args")
	}
	if !common.SubscriptionGroupUpgradeEnabled || !SubscriptionGroupPrioritiesEnabled() {
		return "", false, nil
	}
	var subs []UserSubscription
	if err := tx.Where("user_id = ?", userId).Find(&subs).Error; err != nil {
		return "", false, err
	}
	bestGroup, bestPriority := "", -1
	for i := range subs {
		if g := subscriptionAnchorGroup(&subs[i]); g != "" {
			if p := GroupPriority(g); p > bestPriority {
				bestGroup, bestPriority = g, p
			}
		}
	}
	// 固定分组钉：永不消失的锚（不受订阅生命周期影响），与订阅锚点取 max。
	if g, err := activeGroupPinGroupTx(tx, userId); err != nil {
		return "", false, err
	} else if g != "" {
		if p := GroupPriority(g); p > bestPriority {
			bestGroup, bestPriority = g, p
		}
	}
	currentGroup, err := getUserGroupByIdTx(tx, userId)
	if err != nil {
		return "", false, err
	}
	target := bestGroup
	fromDrain := false
	if target == "" {
		target = drainTarget
		fromDrain = true
	}
	if target == "" || target == currentGroup {
		return currentGroup, false, nil
	}
	if fromDrain && GroupPriority(target) >= GroupPriority(currentGroup) {
		return currentGroup, false, nil
	}
	if err := tx.Model(&User{}).Where("id = ?", userId).Update("group", target).Error; err != nil {
		return "", false, err
	}
	return target, true, nil
}

// applyGroupAfterSubscriptionEndTx 是订阅生命周期结束（到期/取消/作废/删除）后收敛用户组
// 的单一入口，按运营是否配置组优先级分流：
//   - 未配置（legacy 态）：downgradeUserGroupForSubscriptionTx 逐订阅 legacy 回退
//     （按 down/prev 回退；有其他活跃升级订阅撑组则保组），数值优先级比较全部关闭。
//   - 已配置（锚点态）：settleUserSubscriptionGroupTx 全局锚点重算——active 订阅锚点 +
//     固定分组钉取 max，彻底断档按 ended 降级目标兜底。
//
// 返回收敛后的组（变更时非空）与是否变更。调用方在变更后负责刷用户组缓存。
func applyGroupAfterSubscriptionEndTx(tx *gorm.DB, sub *UserSubscription, now int64) (string, bool, error) {
	if tx == nil || sub == nil {
		return "", false, errors.New("invalid group-apply args")
	}
	if !common.SubscriptionGroupUpgradeEnabled {
		return "", false, nil
	}
	if !SubscriptionGroupPrioritiesEnabled() {
		target, err := downgradeUserGroupForSubscriptionTx(tx, sub, now)
		if err != nil {
			return "", false, err
		}
		return target, target != "", nil
	}
	return settleUserSubscriptionGroupTx(tx, sub.UserId, subscriptionDrainGroup(sub))
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
	upgradeGroup := ""
	prevGroup := ""
	if common.SubscriptionGroupUpgradeEnabled {
		upgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
		if upgradeGroup != "" {
			currentGroup, err := getUserGroupByIdTx(tx, userId)
			if err != nil {
				return nil, err
			}
			// 组优先级（统一 ≥ 语义）：目标组优先级 ≥ 当前组才改组。
			// 低级订阅不拉低当前组（v2 用户买 v1 订阅保持 v2，订阅额度照常生效）；
			// 同级放行（跟随用户主动选择）；高买低照常升级。
			if currentGroup != upgradeGroup && GroupPriority(upgradeGroup) >= GroupPriority(currentGroup) {
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
		UserId:              userId,
		PlanId:              plan.Id,
		StartTime:           nowUnixAtCreate,
		EndTime:             endUnix,
		Status:              "active",
		Source:              source,
		WeekStartAt:         weekStartUnix(now),
		WeekUsed:            0,
		MonthStartAt:        monthStartUnix(now),
		MonthUsed:           0,
		UpgradeGroup:        upgradeGroup,
		PrevUserGroup:       prevGroup,
		DowngradeGroup:      strings.TrimSpace(plan.DowngradeGroup),
		AllowWalletOverflow: allowWalletOverflow,
		ExclusiveGroup:      strings.TrimSpace(plan.ExclusiveGroup),
		TierPriority:        plan.Priority,
		CreatedAt:           common.GetTimestamp(),
		UpdatedAt:           common.GetTimestamp(),
	}
	// 快照当前套餐条款：续费/升降配估值后续都按"旧条款"走，不受套餐编辑影响。
	sub.SnapshotRenewTerms(plan, nowUnixAtCreate)
	// 动态窗口模型：初始化各窗口状态（计数 0、从购买时刻锚定；窗口 ≥ 剩余有效期时
	// next_reset_at=0 进入封顶态，limit 即本订阅总上限；全部窗口额度为 0 = 无限）。
	if windows := plan.ResetWindows(); len(windows) > 0 {
		states := make([]WindowState, 0, len(windows))
		for i, w := range windows {
			states = append(states, WindowState{
				Idx:          i,
				CycleUsed:    0,
				CycleStartAt: nowUnixAtCreate,
				NextResetAt:  calcWindowNextReset(w, nowUnixAtCreate, endUnix),
			})
		}
		sub.SetWindowStates(states)
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

// refreshSubscriptionStamp 把订阅到期标记（全部活跃订阅中最大的 end_time）写进用户缓存，
// TokenAuth 据此惰性判断该用户是否有订阅已到期。无活跃订阅时清除标记（写 0）。
// 仅需在订阅生命周期事件（购买/续费/取消/过期）后调用；Redis 未启用或缓存缺失时为空操作，
// 缺失/陈旧只退化为维护任务兜底，不破坏正确性。
func refreshSubscriptionStamp(userId int) {
	if !common.RedisEnabled || userId <= 0 {
		return
	}
	var maxEnd int64
	if err := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ?", userId, "active").
		Select("COALESCE(MAX(end_time), 0)").Scan(&maxEnd).Error; err != nil {
		common.SysError(fmt.Sprintf("failed to compute subscription stamp for user %d: %v", userId, err))
		return
	}
	if maxEnd <= 0 {
		maxEnd = 0
	}
	if err := updateUserCacheField(userId, "SubsEndAt", maxEnd); err != nil {
		common.SysLog(fmt.Sprintf("failed to write subscription stamp cache for user %d: %v", userId, err))
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
		var itemTitle string
		var plan *SubscriptionPlan
		var pinProduct *GroupPinProduct
		var err error
		if order.Kind == OrderKindGroupPin {
			// 固定分组订单：加载商品，完成时建钉而非订阅。
			pinProduct, err = GetGroupPinProductById(order.PinProductId)
			if err != nil {
				return err
			}
			itemTitle = pinProduct.Title
		} else {
			plan, err = GetSubscriptionPlanById(order.PlanId)
			if err != nil {
				return err
			}
			if !plan.Enabled {
				// still allow completion for already purchased orders
			}
			itemTitle = plan.Title
		}
		// 锁定用户行：并发完成同一用户的不同订单（包括多实例部署下）时，
		// 使 CreateUserSubscriptionFromPlanTx 的 MaxPurchasePerUser 检查按用户串行。
		var userRow User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", order.UserId).First(&userRow).Error; err != nil {
			return err
		}
		if order.Kind == OrderKindGroupPin {
			changed, err := PinUserGroupTx(tx, order.UserId, pinProduct.Group, GroupPinSourcePurchase, pinProduct.Title, order.UserId)
			if err != nil {
				return err
			}
			if changed {
				upgradeGroup = pinProduct.Group
			}
		} else if order.ExtendSubscriptionId > 0 {
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
		logPlanTitle = itemTitle
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
		// 购买与续费都会改变活跃订阅的到期时间，到期标记须同步（续费不升组也要刷）。
		refreshSubscriptionStamp(logUserId)
		msg := fmt.Sprintf("订阅购买成功，套餐: %s，支付金额: %.2f，支付方式: %s", logPlanTitle, logMoney, logPaymentMethod)
		RecordTopupLogWithPayment(logUserId, msg, logPaymentMethod)
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
		// 与 CompleteSubscriptionOrder 一致：先锁用户行，再做购买次数检查。
		var userRow User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", userId).First(&userRow).Error; err != nil {
			return err
		}
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
	refreshSubscriptionStamp(userId)
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
		Ceil()
	return common.WalletQuotaFromDecimalStrict(quota)
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

// invalidateSubscriptionTx cancels a subscription immediately and converges the
// user group if needed (see applyGroupAfterSubscriptionEndTx). The subscription
// must already be locked by the caller.
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
	target, changed, err := applyGroupAfterSubscriptionEndTx(tx, sub, now)
	if err != nil {
		return "", err
	}
	if !changed {
		return "", nil
	}
	return target, nil
}

// calcSubscriptionRemainingValue returns the prorated monetary value of a
// subscription based on the fraction of time remaining. Quota already consumed is
// intentionally ignored here — the period-ledger clamp 在升降配入口（PurchaseWithStrategy）
// 另行生效，避免"烧爆当期额度后降级仍按时间全额退款"的套利。
func calcSubscriptionRemainingValue(sub *UserSubscription, plan *SubscriptionPlan) (float64, error) {
	return calcSubscriptionRemainingValueAt(sub, plan, GetDBTimestamp())
}

// calcSubscriptionRemainingValueAt 是 calcSubscriptionRemainingValue 的可注入时钟版本。
// 事务内必须传应用时钟 now：GetDBTimestamp() 是一次全局 DB 往返，在事务内需要第二个
// 连接——单连接池（SQLite 测试库）直接死锁，生产上也引入跨连接时钟漂移。
func calcSubscriptionRemainingValueAt(sub *UserSubscription, plan *SubscriptionPlan, now int64) (float64, error) {
	if sub == nil || plan == nil {
		return 0, errors.New("invalid subscription or plan")
	}
	// 用续费条款快照的周期时长和价格估值：续费只延长 end_time 不更新 start_time，
	// 若用 end-start 当分母会被历史续费拉伸、稀释当前套餐价值（升级多扣/降级少退）。
	// 存量订阅（无快照）回退到套餐当前条款。
	terms := sub.RenewTermsOrPlan(plan)
	if terms.DurationSeconds <= 0 {
		return 0, nil
	}
	remain := sub.EndTime - now
	if remain < 0 {
		remain = 0
	}
	return terms.PriceAmount * float64(remain) / float64(terms.DurationSeconds), nil
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
	// 续费目标（subscriptionId > 0）不得是已到期取消的订阅：epay 在创建订单前就拦下，
	// 避免订单已支付后回调才发现不能续（RenewSubscriptionTx 的兜底拦截会把它变成坏账）。
	if subscriptionId > 0 {
		var target UserSubscription
		if err := DB.Where("id = ? AND user_id = ?", subscriptionId, userId).First(&target).Error; err != nil {
			return errors.New("订阅不存在")
		}
		if target.CancelAtEnd {
			return errors.New("订阅已到期取消，无法续费")
		}
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
		// 禁用套餐：存量订阅仍可续费（subscriptionId > 0），但禁止新购与升降配
		// （subscriptionId == 0，含互斥组内切换）。同组判定在前，确保升降配也被拦。
		if !plan.Enabled && subscriptionId == 0 {
			return errors.New("套餐未启用")
		}
		nowUnix := common.GetTimestamp()
		if subscriptionId > 0 {
			// Renewal of an explicit subscription.
			if sameGroup.Id > 0 && sameGroup.Id != subscriptionId {
				return errors.New("目标订阅与互斥组冲突，请先处理同组其他订阅")
			}
			quota, chargedPrice, err := renewSubscriptionWithBalanceTx(tx, userId, plan, subscriptionId, now)
			if err != nil {
				return err
			}
			chargedQuota = quota
			logTitle = plan.Title
			logMoney = chargedPrice
			message = "续费成功"
			return createBalanceOrderTx(tx, userId, planId, subscriptionId, chargedPrice, quota, "SUBREN", nowUnix)
		}
		if sameGroup.Id > 0 {
			// Prorated switch: upgrade (pay difference) or downgrade (refund difference).
			oldPlan, err := getSubscriptionPlanByIdTx(tx, sameGroup.PlanId)
			if err != nil {
				return err
			}
			value, err := calcSubscriptionRemainingValueAt(&sameGroup, oldPlan, now)
			if err != nil {
				return err
			}
			// 单期账本 clamp：按时间折算的剩余价值不得超过"当前预付期未消耗的预付"
			// （快照价格 − period_used 折算已消耗价值）。否则用户可烧爆当期额度后降级，
			// 按时间比例拿回接近全款的退款（消耗即时、退款线性 = 套利）。clamp 对升级
			// 方向同样生效：已超耗的订阅切换时剩余价值为 0，补差价按新套餐全价计。
			terms := sameGroup.RenewTermsOrPlan(oldPlan)
			if cap := terms.PriceAmount - float64(sameGroup.PeriodUsed)/common.QuotaPerUnit; value > cap {
				value = cap
			}
			if value < 0 {
				value = 0
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
			// Create the new subscription first, then retire the old one. 组变更由
			// 作废旧订阅时的收敛统一收口：升级方向 create 已升（PrevUserGroup 非空），
			// 同组降级方向旧订阅作废后锚点只剩新订阅 → 收敛把组切到新订阅档位。
			subscription, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, PaymentMethodBalance)
			if err != nil {
				return err
			}
			if subscription.PrevUserGroup != "" {
				upgradeGroupChanged = true
			}
			if target, err := invalidateSubscriptionTx(tx, &sameGroup, now); err != nil {
				return err
			} else if target != "" {
				upgradeGroupChanged = true
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
	refreshSubscriptionStamp(userId)
	if upgradeGroupChanged {
		refreshSubscriptionUserGroupCache(userId, "subscription purchase")
	}
	msg := fmt.Sprintf("订阅操作成功，套餐: %s，金额: %.2f，扣除额度: %d，退还额度: %d",
		logTitle, logMoney, chargedQuota, creditedQuota)
	RecordTopupLogWithPayment(userId, msg, PaymentMethodBalance)
	return message, nil
}

// RenewSubscriptionTx extends an existing active subscription by one plan period.
// The subscription must already be locked by the caller. Renewal appends the plan
// duration to EndTime (from the later of EndTime/now). 各窗口 next_reset_at 刻意不动：
// 续费只延长订阅，窗口照常按各自 cadence 推进（advanceSubscriptionWindows 在到期边界
// 清零重武装），提前续费不会吞掉已排期的下一次重置。
func RenewSubscriptionTx(tx *gorm.DB, sub *UserSubscription, plan *SubscriptionPlan, now int64) error {
	if tx == nil || sub == nil || plan == nil {
		return errors.New("invalid renew args")
	}
	if sub.Status != "active" {
		return errors.New("订阅已失效，无法续费")
	}
	// 到期取消（cancel_at_end）后的订阅不允许任何续费：余额续费、epay 续费回调、
	// 自动续费任务都汇聚到这里，一处拦截全链路生效。事务回滚保证已扣余额不损失。
	if sub.CancelAtEnd {
		return errors.New("订阅已到期取消，无法续费")
	}
	// 续费条款取购买时的快照（旧条款），不受套餐后续编辑影响。
	terms := sub.RenewTermsOrPlan(plan)
	if terms.DurationSeconds <= 0 {
		return errors.New("套餐时长配置错误")
	}
	start := time.Unix(sub.EndTime, 0)
	if start.Before(time.Unix(now, 0)) {
		start = time.Unix(now, 0)
	}
	endUnix := start.Unix() + terms.DurationSeconds
	// Prevent stacking subscription time indefinitely: the total remaining time
	// (end_time - now) after renewal must not exceed the snapshot cap.
	if terms.MaxCumulativeSeconds > 0 && endUnix-now > terms.MaxCumulativeSeconds {
		return errors.New("已达该套餐最长可续时长，无法继续续费")
	}
	sub.EndTime = endUnix
	// 单期账本：续费开启新的预付期，period_used 清零重开。退款 clamp 按"当前预付期
	// 快照价格 − period_used 折算已消耗"封顶，清零保证续费后的退款不会误用上一期的
	// 消耗；提前续费的误差方向是少退（用户当期未用完的预付不作退款），不会放大退款。
	// 注意：不改各窗口 next_reset_at——续费只延长订阅，重置窗口照常按各自 cadence 推进
	// （动态窗口的"封顶态重算"由 advanceSubscriptionWindows 在续费后的下一次预扣时惰性
	// 处理）；若在此重新武装，会吞掉已排期的下一次重置（用户损失一个周期的重置额度）。
	// A user-initiated renewal overrides a pending cancel-at-end and clears any
	// previous auto-renew failure so the task may retry.
	sub.CancelAtEnd = false
	sub.AutoRenewFailed = false
	sub.PeriodUsed = 0
	return tx.Save(sub).Error
}

// renewSubscriptionWithBalanceTx deducts the snapshot (old-terms) price from the
// user's wallet and renews the target subscription inside the given transaction.
// Returns the charged quota and the price actually used.
func renewSubscriptionWithBalanceTx(tx *gorm.DB, userId int, plan *SubscriptionPlan, subscriptionId int, now int64) (int, float64, error) {
	if plan == nil {
		return 0, 0, errors.New("plan is nil")
	}
	// 先读订阅（无锁）拿续费条款快照：价格/时长/总额度取快照而非套餐当前值。
	// 快照购买时写入且续费不刷新，正常流程下不变；无锁读避免调整 user→sub 锁序。
	var snapshotSub UserSubscription
	if err := tx.Where("id = ? AND user_id = ?", subscriptionId, userId).First(&snapshotSub).Error; err != nil {
		return 0, 0, errors.New("订阅不存在")
	}
	// 订阅必须属于该套餐，防手工构造 plan_id 用其他套餐条款续费。
	if snapshotSub.PlanId != plan.Id {
		return 0, 0, errors.New("订阅与套餐不匹配")
	}
	terms := snapshotSub.RenewTermsOrPlan(plan)
	if terms.DurationSeconds <= 0 {
		return 0, 0, errors.New("套餐时长配置错误")
	}
	if terms.PriceAmount < 0 {
		return 0, 0, errors.New("套餐价格不能为负数")
	}
	// 余额支付门沿用套餐当前配置（策略性开关，不算续费条款）。
	if plan.AllowBalancePay != nil && !*plan.AllowBalancePay {
		return 0, 0, errors.New("该套餐不允许使用余额兑换")
	}
	requiredQuota, err := calcSubscriptionBalanceQuota(terms.PriceAmount)
	if err != nil {
		return 0, 0, err
	}
	var user User
	if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
		return 0, 0, err
	}
	if requiredQuota > 0 && user.Quota < requiredQuota {
		return 0, 0, errors.New("余额不足")
	}
	if requiredQuota > 0 {
		if err := tx.Model(&User{}).Where("id = ?", userId).
			Update("quota", gorm.Expr("quota - ?", requiredQuota)).Error; err != nil {
			return 0, 0, err
		}
	}
	var sub UserSubscription
	if err := lockForUpdate(tx).
		Where("id = ? AND user_id = ?", subscriptionId, userId).
		First(&sub).Error; err != nil {
		return 0, 0, errors.New("订阅不存在")
	}
	if err := RenewSubscriptionTx(tx, &sub, plan, now); err != nil {
		return 0, 0, err
	}
	return requiredQuota, terms.PriceAmount, nil
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
	refreshSubscriptionStamp(userId)
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
	UserId       int
	ChargedQuota int
	PlanTitle    string
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
			quota, chargedPrice, rerr := renewSubscriptionWithBalanceTx(tx, locked.UserId, plan, locked.Id, now)
			if rerr != nil {
				// Flag the failure so the task stops retrying until the user acts.
				flagAutoRenewFailed(tx, locked.Id)
				return nil
			}
			charged = quota
			renewed = true
			return createBalanceOrderTx(tx, locked.UserId, plan.Id, locked.Id, chargedPrice, quota, "SUBAUTO", common.GetTimestamp())
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
		refreshSubscriptionStamp(s.UserId)
		msg := fmt.Sprintf("订阅自动续费成功，套餐: %s，扣除额度: %d", s.PlanTitle, s.ChargedQuota)
		RecordTopupLogWithPayment(s.UserId, msg, PaymentMethodBalance)
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
	planIds := make([]int, 0, len(subs))
	for _, sub := range subs {
		planIds = append(planIds, sub.PlanId)
	}
	// 一条 IN 查询把所有订阅的套餐（不过滤 enabled）取出来，含已停售/禁用套餐。
	plans := make(map[int]*SubscriptionPlan, len(planIds))
	var found []SubscriptionPlan
	if err := DB.Where("id IN ?", planIds).Find(&found).Error; err == nil {
		for i := range found {
			found[i].NormalizeDefaults()
			plans[found[i].Id] = &found[i]
		}
	}
	result := make([]SubscriptionSummary, 0, len(subs))
	for _, sub := range subs {
		subCopy := sub
		summary := SubscriptionSummary{Subscription: &subCopy}
		if p, ok := plans[sub.PlanId]; ok {
			summary.Plan = p
		}
		result = append(result, summary)
	}
	return result
}

// AdminUserSubscriptionSummary enriches a UserSubscription with owner and plan
// info for the admin global subscriptions view. Plan carries the full plan
// snapshot (including reset_windows) so the admin table can render per-window
// rolling usage; it is omitted when the plan is gone.
type AdminUserSubscriptionSummary struct {
	Subscription *UserSubscription `json:"subscription"`
	Username     string            `json:"username"`
	Email        string            `json:"email"`
	DisplayName  string            `json:"display_name"`
	PlanTitle    string            `json:"plan_title"`
	Plan         *SubscriptionPlan `json:"plan,omitempty"`
}

// subscriptionSortColumns maps the admin subscriptions table's sortable column
// ids (frontend column ids) to their physical columns. `usage` is computed
// (total - used) and deliberately excluded.
var subscriptionSortColumns = map[string]string{
	"id":         "id",
	"user":       "user_id",
	"plan":       "plan_id",
	"status":     "status",
	"start_time": "start_time",
	"end_time":   "end_time",
}

type SubscriptionSortOptions struct {
	SortBy    string
	SortOrder string
}

func NewSubscriptionSortOptions(sortBy string, sortOrder string) SubscriptionSortOptions {
	normalizedSortBy := strings.ToLower(strings.TrimSpace(sortBy))
	normalizedSortOrder := strings.ToLower(strings.TrimSpace(sortOrder))
	if _, ok := subscriptionSortColumns[normalizedSortBy]; !ok {
		normalizedSortBy = "end_time"
		normalizedSortOrder = "desc"
	} else if normalizedSortOrder != "asc" {
		normalizedSortOrder = "desc"
	}

	return SubscriptionSortOptions{
		SortBy:    normalizedSortBy,
		SortOrder: normalizedSortOrder,
	}
}

func (options SubscriptionSortOptions) Apply(query *gorm.DB) *gorm.DB {
	columnName, ok := subscriptionSortColumns[options.SortBy]
	if !ok {
		columnName = "end_time"
	}
	q := query.Order(clause.OrderByColumn{
		Column: clause.Column{Name: columnName},
		Desc:   options.SortOrder != "asc",
	})
	if columnName != "id" {
		q = q.Order(clause.OrderByColumn{
			Column: clause.Column{Name: "id"},
			Desc:   true,
		})
	}
	return q
}

// GetAllSubscriptionsByAdmin returns a paginated, filterable list of all user
// subscriptions across all users. Filters: status (active/expired/cancelled),
// userKeyword (username/email/display_name substring or user id), planId.
// Keeps the {subscription:{...}} wrapper convention so existing frontend types
// (UserSubscriptionRecord) can be reused alongside the enriched fields.
func GetAllSubscriptionsByAdmin(status string, userKeyword string, planId int, startIdx int, num int, sortOptions SubscriptionSortOptions) ([]AdminUserSubscriptionSummary, int64, error) {
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
	if err := sortOptions.Apply(base).Limit(num).Offset(startIdx).Find(&subs).Error; err != nil {
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

	// Bulk-fetch plan snapshots so the admin table can render rolling-window usage
	// (plan reset_windows + subscription window_state). Mirrors buildSubscriptionSummaries.
	planIds := make([]int, 0, len(subs))
	for _, sub := range subs {
		planIds = append(planIds, sub.PlanId)
	}
	planMap := make(map[int]*SubscriptionPlan, len(planIds))
	var foundPlans []SubscriptionPlan
	if err := DB.Where("id IN ?", planIds).Find(&foundPlans).Error; err == nil {
		for i := range foundPlans {
			foundPlans[i].NormalizeDefaults()
			planMap[foundPlans[i].Id] = &foundPlans[i]
		}
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
		if plan, ok := planMap[sub.PlanId]; ok {
			item.PlanTitle = plan.Title
			item.Plan = plan
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
		target, changed, err := applyGroupAfterSubscriptionEndTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if changed {
			cacheGroup = target
			downgradeGroup = target
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if userId > 0 {
		refreshSubscriptionStamp(userId)
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
		if err := tx.Model(&sub).Updates(map[string]interface{}{
			"status":     "deleted",
			"end_time":   now,
			"updated_at": now,
		}).Error; err != nil {
			return err
		}
		// 先标记 deleted 再收敛组：锚点态下 cancelled/deleted 不贡献锚点，顺序敏感。
		target, changed, err := applyGroupAfterSubscriptionEndTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if changed {
			cacheGroup = target
			downgradeGroup = target
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if userId > 0 {
		refreshSubscriptionStamp(userId)
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
		if err := tx.Where("id = ?", userSubscriptionId).Delete(&UserSubscription{}).Error; err != nil {
			return err
		}
		// 先删行再收敛组：行已不在，锚点判定不把它算进去（锚点态下彻底删除一个
		// 钉子/非钉子订阅都会释放其贡献）。
		target, changed, err := applyGroupAfterSubscriptionEndTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if changed {
			cacheGroup = target
			downgradeGroup = target
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if userId > 0 {
		refreshSubscriptionStamp(userId)
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
	windows := plan.ResetWindows()
	if len(windows) == 0 {
		return errors.New("动态窗口至少需要配置一个窗口")
	}
	// 动态模型：重置全部窗口——计数清零、从 now 锚定；advance 决定是否顺延下次
	// 重置（否则保留原窗口的 next_reset_at）。
	oldStates := sub.WindowStates()
	states := make([]WindowState, 0, len(windows))
	for i := range windows {
		next := calcWindowNextReset(windows[i], now, sub.EndTime)
		if !advanceResetTime && i < len(oldStates) && oldStates[i].NextResetAt > 0 {
			next = oldStates[i].NextResetAt
		}
		states = append(states, WindowState{Idx: i, CycleUsed: 0, CycleStartAt: now, NextResetAt: next})
	}
	sub.SetWindowStates(states)
	return tx.Save(sub).Error
}

// ApplyPlanWindowsToActiveSubscriptions 用套餐当前的动态窗口列表重置其全部活跃订阅的
// 窗口状态（计数清零、从 now 锚定），返回受影响订阅数。管理端把套餐保存出/改动
// reset_windows 时调用（"改动即重置"策略：窗口列表变化 = 重定义配额，不映射旧计数）。
func ApplyPlanWindowsToActiveSubscriptions(tx *gorm.DB, plan *SubscriptionPlan, now int64) (int64, error) {
	if tx == nil || plan == nil || plan.Id <= 0 {
		return 0, errors.New("invalid args")
	}
	windows := plan.ResetWindows()
	if len(windows) == 0 {
		return 0, nil
	}
	var subs []UserSubscription
	if err := lockForUpdate(tx).
		Where("plan_id = ? AND status = ? AND end_time > ?", plan.Id, "active", now).
		Find(&subs).Error; err != nil {
		return 0, err
	}
	count := int64(0)
	for i := range subs {
		states := make([]WindowState, 0, len(windows))
		for j, w := range windows {
			states = append(states, WindowState{
				Idx:          j,
				CycleUsed:    0,
				CycleStartAt: now,
				NextResetAt:  calcWindowNextReset(w, now, subs[i].EndTime),
			})
		}
		subs[i].SetWindowStates(states)
		if err := tx.Save(&subs[i]).Error; err != nil {
			return 0, err
		}
		count++
	}
	return count, nil
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
	// PeriodUsedBefore / PeriodUsedAfter 是单期账本（当前预付期累计消耗）的预扣前后值，
	// 仅作展示/审计。
	PeriodUsedBefore int64
	PeriodUsedAfter  int64
	// Remaining 是预扣后的窗口剩余额度（subscriptionRemaining 的 min-over-windows；
	// 无限额度 = math.MaxInt64）。告警/消费日志据此展示真实剩余，替代已移除的总额模型。
	Remaining int64
}

// expireUserSubscriptionsTx marks all of a user's due active subscriptions as
// expired and downgrades the group when the subscription had elevated it.
// Returns the number of subscriptions expired and the downgrade target (empty
// when the group did not change). Caller owns the transaction; group cache and
// subscription stamp refresh belong to the caller after commit.
func expireUserSubscriptionsTx(tx *gorm.DB, userId int, now int64) (int, string, error) {
	if tx == nil || userId <= 0 {
		return 0, "", errors.New("invalid expire args")
	}
	res := tx.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ? AND end_time > 0 AND end_time <= ?", userId, "active", now).
		Updates(map[string]interface{}{
			"status":     "expired",
			"updated_at": common.GetTimestamp(),
		})
	if res.Error != nil {
		return 0, "", res.Error
	}
	expired := int(res.RowsAffected)
	if expired == 0 || !common.SubscriptionGroupUpgradeEnabled {
		// 组升降级功能关闭：到期只标记状态，不改用户组。
		return expired, "", nil
	}
	// Find the most recently expired subscription that defines a group transition
	// (an explicit downgrade target or an upgrade snapshot to revert). 组变更判定
	// 统一委托 applyGroupAfterSubscriptionEndTx（legacy/锚点两态分流）：
	// legacy 态逐订阅回退（down/prev，有其它活跃升级订阅撑组则保组）；锚点态全局重算
	// （钉子永久、非钉子释放，断档按 ended 降级目标兜底）——lastExpired 仅作锚点态
	// 彻底断档时的兜底候选，锚点本身以全量现存订阅重算。
	var lastExpired UserSubscription
	expiredQuery := tx.Where("user_id = ? AND status = ? AND (downgrade_group <> '' OR upgrade_group <> '')",
		userId, "expired").
		Order("end_time desc, id desc").
		Limit(1).
		Find(&lastExpired)
	if expiredQuery.Error != nil || expiredQuery.RowsAffected == 0 {
		return expired, "", nil
	}
	target, changed, err := applyGroupAfterSubscriptionEndTx(tx, &lastExpired, now)
	if err != nil {
		return expired, "", err
	}
	if !changed {
		return expired, "", nil
	}
	return expired, target, nil
}

// LazyExpireUserSubscriptions 在请求路径惰性处理该用户已到期的活跃订阅：标记 expired
// 并按订阅回退分组。与 ExpireDueSubscriptions（维护任务）互补——任务受 tick 间隔约束，
// 惰性路径让降级在到期后的下一次请求即生效。幂等：并发请求时后到者 UPDATE 0 行即跳过
// 回退，只顺带把到期标记修复正确。Redis 未启用时同样会标记过期并回退，仅跳过缓存刷新。
func LazyExpireUserSubscriptions(userId int) (bool, error) {
	if userId <= 0 {
		return false, errors.New("invalid userId")
	}
	now := GetDBTimestamp()
	downgraded := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		_, target, err := expireUserSubscriptionsTx(tx, userId, now)
		if err != nil {
			return err
		}
		if target != "" {
			downgraded = true
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	// 无条件刷新到期标记：标记可能是过时的（订阅已续费/已被处理），顺手修复为当前真值。
	refreshSubscriptionStamp(userId)
	if downgraded {
		refreshSubscriptionUserGroupCache(userId, "lazy subscription expiration")
	}
	return downgraded, nil
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
			expired, target, err := expireUserSubscriptionsTx(tx, userId, now)
			if err != nil {
				return err
			}
			expiredCount += expired
			cacheGroup = target
			return nil
		})
		if err != nil {
			return expiredCount, err
		}
		refreshSubscriptionStamp(userId)
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
// the caller has already advanced its windows. All windows limit<=0 (unlimited)
// yields math.MaxInt64. Returns math.MaxInt64 when nothing limits the subscription.
func subscriptionRemaining(sub *UserSubscription, plan *SubscriptionPlan) int64 {
	if sub == nil || plan == nil {
		return 0
	}
	return subscriptionRemainingWindows(sub, plan.ResetWindows())
}

// subscriptionRemainingWindows 返回动态模型的剩余额度：所有窗口剩余的最小值。
// 窗口状态缺失（advance 尚未补齐）时按满额计；无窗口/全 limit<=0 返回 MaxInt64（无限）。
func subscriptionRemainingWindows(sub *UserSubscription, windows []ResetWindow) int64 {
	if len(windows) == 0 {
		return math.MaxInt64
	}
	states := sub.WindowStates()
	remaining := int64(math.MaxInt64)
	for i, w := range windows {
		if w.Limit <= 0 {
			continue
		}
		if i >= len(states) {
			if w.Limit < remaining {
				remaining = w.Limit
			}
			continue
		}
		if r := w.Limit - states[i].CycleUsed; r < remaining {
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
			returnValue.PeriodUsedBefore = sub.PeriodUsed
			returnValue.PeriodUsedAfter = sub.PeriodUsed
			plan, _ := getSubscriptionPlanByIdTx(tx, sub.PlanId)
			returnValue.Remaining = subscriptionRemaining(&sub, plan)
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
			windows := plan.ResetWindows()
			if advanceSubscriptionWindows(&sub, plan, now) {
				if err := tx.Save(&sub).Error; err != nil {
					return err
				}
			}
			if subscriptionRemaining(&sub, plan) < amount {
				continue
			}
			usedBefore := sub.PeriodUsed
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
					returnValue.PeriodUsedBefore = sub.PeriodUsed
					returnValue.PeriodUsedAfter = sub.PeriodUsed
					plan, _ := getSubscriptionPlanByIdTx(tx, sub.PlanId)
					returnValue.Remaining = subscriptionRemaining(&sub, plan)
					return nil
				}
				return err
			}
			sub.PeriodUsed += amount
			// 累加到全部窗口计数（PeriodUsed 是单期账本，续费清零）；自然周/月计数同步累加，
			// 供钱包卡「订阅抵扣」按日历月统计（不作上限）。
			addWindowUsage(&sub, windows, amount)
			sub.WeekUsed += amount
			sub.MonthUsed += amount
			if err := tx.Save(&sub).Error; err != nil {
				return err
			}
			returnValue.UserSubscriptionId = sub.Id
			returnValue.PreConsumed = amount
			returnValue.PeriodUsedBefore = usedBefore
			returnValue.PeriodUsedAfter = sub.PeriodUsed
			returnValue.Remaining = subscriptionRemaining(&sub, plan)
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
		if err := PostConsumeUserSubscriptionDelta(tx, record.UserId, record.UserSubscriptionId, -record.PreConsumed); err != nil {
			return err
		}
		record.Status = "refunded"
		return tx.Save(&record).Error
	})
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

// PostConsumeUserSubscriptionDelta updates subscription usage by delta (positive consume
// more, negative refund). db 指定执行事务的连接：传 nil 使用全局 DB；调用方若已处于事务内，
// 应传入外层 tx，让 delta 更新作为 savepoint 嵌套在同一个连接上，保证与事务一起提交/回滚。
// 切勿在外层事务中再对全局 DB 另开事务（不同连接）：SQLite+WAL 下会因读快照过期触发
// SQLITE_BUSY_SNAPSHOT（database is locked），MySQL 下则破坏外层事务原子性。
//
// userId 用于死订阅兜底：预扣发生在请求开始，结算可能晚于订阅切换/取消/过期甚至被管理端
// 物理删除。此时订阅窗口与账本已冻结，delta 若继续写入死行，正 delta（补扣）会静默蒸发
// （平台少收），负 delta（退款）退进死订阅拿不回来。统一转钱包结算，保证用户实际消耗与
// 余额变动一致。db==nil（顶层事务提交后）同步钱包缓存；嵌套事务时由外层负责缓存。
func PostConsumeUserSubscriptionDelta(db *gorm.DB, userId int, userSubscriptionId int, delta int64) error {
	if userId <= 0 {
		return errors.New("invalid userId")
	}
	if userSubscriptionId <= 0 {
		return errors.New("invalid userSubscriptionId")
	}
	if delta == 0 {
		return nil
	}
	if db == nil {
		db = DB
	}
	walletDelta := int64(0)
	err := db.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		err := lockForUpdate(tx).
			Where("id = ?", userSubscriptionId).
			First(&sub).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				walletDelta = delta
				return applyDeltaToWalletTx(tx, userId, delta)
			}
			return err
		}
		if sub.Status != "active" {
			walletDelta = delta
			return applyDeltaToWalletTx(tx, userId, delta)
		}
		plan, _ := getSubscriptionPlanByIdTx(tx, sub.PlanId)
		var windows []ResetWindow
		if plan != nil {
			windows = plan.ResetWindows()
		}
		// 动态模型：对窗口计数反向回填（正数补扣、负数退还）。PeriodUsed 是单期账本，
		// 同步 delta 修正并 clamp 非负。
		sub.PeriodUsed = clampNonNegative(sub.PeriodUsed + delta)
		states := sub.WindowStates()
		changed := false
		for i := range windows {
			if i >= len(states) {
				continue
			}
			states[i].CycleUsed = clampNonNegative(states[i].CycleUsed + delta)
			changed = true
		}
		if changed {
			sub.SetWindowStates(states)
		}
		// 自然周/月展示计数同步按差额修正，保持日历月统计准确。
		sub.WeekUsed = clampNonNegative(sub.WeekUsed + delta)
		sub.MonthUsed = clampNonNegative(sub.MonthUsed + delta)
		return tx.Save(&sub).Error
	})
	if err != nil {
		return err
	}
	if db == DB && walletDelta != 0 {
		// 顶层事务已提交，同步钱包缓存（嵌套事务时由外层调用方负责）。
		syncWalletQuotaCache(userId, walletDelta)
	}
	return nil
}

// applyDeltaToWalletTx 在事务内按 delta 调整钱包余额：正 delta 扣款（补扣在途消耗），
// 负 delta 入账（退还超额预扣）。与 WalletFunding.Settle 的语义一致。
func applyDeltaToWalletTx(tx *gorm.DB, userId int, delta int64) error {
	if delta > 0 {
		return tx.Model(&User{}).Where("id = ?", userId).
			Update("quota", gorm.Expr("quota - ?", delta)).Error
	}
	return tx.Model(&User{}).Where("id = ?", userId).
		Update("quota", gorm.Expr("quota + ?", -delta)).Error
}

// syncWalletQuotaCache 按 delta 方向同步钱包缓存（正 delta=扣款，负 delta=入账）。
func syncWalletQuotaCache(userId int, delta int64) {
	var err error
	if delta > 0 {
		err = cacheDecrUserQuota(userId, delta)
	} else {
		err = cacheIncrUserQuota(userId, -delta)
	}
	if err != nil {
		common.SysLog("failed to sync user quota cache after wallet settlement: " + err.Error())
	}
}

func clampNonNegative(v int64) int64 {
	if v < 0 {
		return 0
	}
	return v
}
