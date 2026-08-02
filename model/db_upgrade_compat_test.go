package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openLegacyUpgradeDB 打开一个独立的内存 SQLite，用于模拟「旧结构 → 当前 AutoMigrate」
// 的升级路径，避免污染全局 DB。
func openLegacyUpgradeDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	return db
}

// legacySubscriptionPlan 复刻旧版 subscription_plans 结构：缺少 is_recommended、
// reset_amount_limit、weekly_amount_limit、monthly_amount_limit、
// max_cumulative_seconds、exclusive_group、allowed_groups 这些当前版本新增列。
type legacySubscriptionPlan struct {
	Id           int
	Title        string  `gorm:"type:varchar(128);not null"`
	PriceAmount  float64
	Enabled      bool
	UpgradeGroup string `gorm:"type:varchar(64);default:''"`
	CreatedAt    int64   `gorm:"bigint"`
	UpdatedAt    int64   `gorm:"bigint"`
}

func (legacySubscriptionPlan) TableName() string { return "subscription_plans" }

// legacyUserSubscription 复刻旧版 user_subscriptions：缺少 auto_renew、priority、
// exclusive_group 及周期限额等当前版本新增列。
type legacyUserSubscription struct {
	Id        int
	UserId    int
	PlanId    int
	AmountUsed int64
	Status    string
	EndTime   int64
	CreatedAt int64
}

func (legacyUserSubscription) TableName() string { return "user_subscriptions" }

// legacySubscriptionOrder 复刻旧版 subscription_orders：缺少 extend_subscription_id。
type legacySubscriptionOrder struct {
	Id      int
	UserId  int
	PlanId  int
	TradeNo string
	Status  string
}

func (legacySubscriptionOrder) TableName() string { return "subscription_orders" }

func assertHasColumn(t *testing.T, db *gorm.DB, model any, column string) {
	t.Helper()
	assert.True(t, db.Migrator().HasColumn(model, column), "column %s missing after upgrade", column)
}

func TestAutoMigrateUpgradesLegacySubscriptionPlans(t *testing.T) {
	db := openLegacyUpgradeDB(t)
	require.NoError(t, db.AutoMigrate(&legacySubscriptionPlan{}))
	require.NoError(t, db.Create(&legacySubscriptionPlan{Title: "legacy-plan", PriceAmount: 9.99, Enabled: true, CreatedAt: 1000}).Error)

	require.NoError(t, db.AutoMigrate(&SubscriptionPlan{}))

	for _, col := range []string{"is_recommended", "reset_amount_limit", "weekly_amount_limit", "monthly_amount_limit", "max_cumulative_seconds", "exclusive_group", "allowed_groups"} {
		assertHasColumn(t, db, &SubscriptionPlan{}, col)
	}

	// 旧数据原样保留。
	var plan SubscriptionPlan
	require.NoError(t, db.Where("title = ?", "legacy-plan").First(&plan).Error)
	assert.Equal(t, 9.99, plan.PriceAmount)
	assert.True(t, plan.Enabled)
}

func TestAutoMigrateUpgradesLegacyUserSubscriptionsAndOrders(t *testing.T) {
	db := openLegacyUpgradeDB(t)
	require.NoError(t, db.AutoMigrate(&legacyUserSubscription{}, &legacySubscriptionOrder{}))
	require.NoError(t, db.Create(&legacyUserSubscription{UserId: 1, PlanId: 2, AmountUsed: 10, Status: "active", EndTime: 5000, CreatedAt: 1000}).Error)
	require.NoError(t, db.Create(&legacySubscriptionOrder{UserId: 1, PlanId: 2, TradeNo: "TN-1", Status: "paid"}).Error)

	require.NoError(t, db.AutoMigrate(&UserSubscription{}, &SubscriptionOrder{}))

	for _, col := range []string{"exclusive_group", "auto_renew", "auto_renew_failed", "cycle_start_at", "cycle_used", "next_cycle_reset_at", "week_start_at", "week_used", "month_start_at", "month_used", "priority", "cancel_at_end", "tier_priority"} {
		assertHasColumn(t, db, &UserSubscription{}, col)
	}
	assertHasColumn(t, db, &SubscriptionOrder{}, "extend_subscription_id")

	var sub UserSubscription
	require.NoError(t, db.Where("plan_id = ?", 2).First(&sub).Error)
	assert.Equal(t, "active", sub.Status)
	assert.EqualValues(t, 10, sub.AmountUsed)

	var order SubscriptionOrder
	require.NoError(t, db.Where("trade_no = ?", "TN-1").First(&order).Error)
	assert.Equal(t, "paid", order.Status)
}

// legacyUser 复刻旧版 users：缺少 linux_do_trust_level、group_auto、avatar、
// avatar_custom 这些当前版本新增列，其余结构与当前 model 一致。
type legacyUser struct {
	Id          int
	Username    string  `gorm:"unique;index"`
	Password    string  `gorm:"not null"`
	Role        int
	Status      int
	Group       string  `gorm:"type:varchar(64);default:'default'"`
	Quota       int64   `gorm:"type:int;default:0"`
	AuthVersion int64   `gorm:"type:bigint;not null;default:1"`
	AccessToken *string `gorm:"uniqueIndex"`
	AffCode     *string `gorm:"uniqueIndex"`
}

func (legacyUser) TableName() string { return "users" }

func TestAutoMigrateUpgradesLegacyUsers(t *testing.T) {
	db := openLegacyUpgradeDB(t)
	require.NoError(t, db.AutoMigrate(&legacyUser{}))
	require.NoError(t, db.Create(&legacyUser{Username: "legacy-user", Password: "x", Role: common.RoleCommonUser}).Error)

	require.NoError(t, db.AutoMigrate(&User{}))

	for _, col := range []string{"linux_do_trust_level", "group_auto", "avatar", "avatar_custom"} {
		assertHasColumn(t, db, &User{}, col)
	}

	var user User
	require.NoError(t, db.Where("username = ?", "legacy-user").First(&user).Error)
	assert.Equal(t, "legacy-user", user.Username)
}

func TestAutoMigrateCreatesNewTablesKeepsOrphan(t *testing.T) {
	db := openLegacyUpgradeDB(t)
	// 旧库残留的孤儿表 checkins（当前无 model 引用）及其数据。
	require.NoError(t, db.Exec(
		"CREATE TABLE checkins (id integer PRIMARY KEY, user_id integer NOT NULL, checkin_date varchar(10) NOT NULL, quota_awarded integer NOT NULL)",
	).Error)
	require.NoError(t, db.Exec("INSERT INTO checkins (user_id, checkin_date, quota_awarded) VALUES (1, '2026-07-01', 100)").Error)

	// 当前版本新增的表，旧库没有。
	require.NoError(t, db.AutoMigrate(&QuotaClaimRecord{}, &QuotaClaimLock{}, &ChannelTestRecord{}))

	assert.True(t, db.Migrator().HasTable(&QuotaClaimRecord{}))
	assert.True(t, db.Migrator().HasTable(&QuotaClaimLock{}))
	assert.True(t, db.Migrator().HasTable(&ChannelTestRecord{}))

	// AutoMigrate 不删表：孤儿表保留，数据不动。
	assert.True(t, db.Migrator().HasTable("checkins"))
	var cnt int64
	require.NoError(t, db.Raw("SELECT COUNT(*) FROM checkins").Scan(&cnt).Error)
	assert.EqualValues(t, 1, cnt)
}

// TestEnsureSubscriptionPlanRecommendedBackfill 覆盖升级后存量行为：MySQL/PG 加
// is_recommended 新列（无 DB 默认值）后存量行是 NULL，回填统一为 0。
func TestEnsureSubscriptionPlanRecommendedBackfill(t *testing.T) {
	require.NoError(t, DB.Migrator().DropTable("subscription_plans"))
	require.NoError(t, DB.AutoMigrate(&SubscriptionPlan{}))
	plan := &SubscriptionPlan{Title: "legacy", PriceAmount: 1, Enabled: true}
	require.NoError(t, DB.Create(plan).Error)
	// 模拟升级加列后的 NULL 存量值。
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", plan.Id).Update("is_recommended", nil).Error)

	require.NoError(t, ensureSubscriptionPlanRecommendedBackfill())

	var got bool
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", plan.Id).Pluck("is_recommended", &got).Error)
	assert.False(t, got)
}
