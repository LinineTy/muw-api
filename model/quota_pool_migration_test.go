package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// OldQuotaClaimRecord 复刻旧版额度池表结构（含 pool_id NOT NULL 列）。
// 1f76f405 收敛后 struct 删除了这两列，但 AutoMigrate 只加列不删列，
// 存量库残留的 pool_id NOT NULL 会让新的 insert 触发 SQLITE_CONSTRAINT_NOTNULL。
type OldQuotaClaimRecord struct {
	Id        int
	UserId    int    `gorm:"not null;index"`
	PoolId    int    `gorm:"not null;index"`
	Quota     int
	PeriodKey string `gorm:"type:varchar(16);index"`
	ClaimedAt int64  `gorm:"bigint"`
}

func (OldQuotaClaimRecord) TableName() string { return "quota_claim_records" }

func quotaClaimRecordsHasColumn(t *testing.T, column string) int64 {
	t.Helper()
	var count int64
	require.NoError(t, DB.Raw(
		"SELECT COUNT(*) FROM pragma_table_info('quota_claim_records') WHERE name = ?",
		column,
	).Scan(&count).Error)
	return count
}

func TestEnsureQuotaClaimRecordsClean_DropsLegacyColumns(t *testing.T) {
	require.NoError(t, DB.Migrator().DropTable("quota_claim_records"))
	require.NoError(t, DB.Migrator().CreateTable(&OldQuotaClaimRecord{}))

	// 模拟存量库升级：AutoMigrate 先为旧表补上新列（不会删旧列）
	require.NoError(t, DB.AutoMigrate(&QuotaClaimRecord{}))
	require.EqualValues(t, 1, quotaClaimRecordsHasColumn(t, "pool_id"))
	require.EqualValues(t, 1, quotaClaimRecordsHasColumn(t, "period_key"))
	require.EqualValues(t, 1, quotaClaimRecordsHasColumn(t, "pool_period_key"))

	require.NoError(t, ensureQuotaClaimRecordsClean())

	require.Zero(t, quotaClaimRecordsHasColumn(t, "pool_id"))
	require.Zero(t, quotaClaimRecordsHasColumn(t, "period_key"))
	require.EqualValues(t, 1, quotaClaimRecordsHasColumn(t, "pool_period_key"))

	// 清理后的表可正常写入新版记录（回归 1299 报错）
	record := &QuotaClaimRecord{
		UserId:        1299,
		PoolPeriodKey: "2026-08-01",
		UserPeriodKey: "2026-08-01",
		Quota:         100,
		Kind:          "claim",
		ClaimedAt:     1,
	}
	require.NoError(t, DB.Create(record).Error)
	assert.NotZero(t, record.Id)
}

func TestEnsureQuotaClaimRecordsClean_NoopOnNewSchema(t *testing.T) {
	require.NoError(t, DB.Migrator().DropTable("quota_claim_records"))
	require.NoError(t, DB.Migrator().CreateTable(&QuotaClaimRecord{}))

	require.NoError(t, ensureQuotaClaimRecordsClean())

	require.Zero(t, quotaClaimRecordsHasColumn(t, "pool_id"))
	// 新表的新增列应保留
	require.EqualValues(t, 1, quotaClaimRecordsHasColumn(t, "kind"))
}
