package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withQuotaPoolSetting(t *testing.T, setting operation_setting.QuotaPoolSetting) {
	t.Helper()
	original := *operation_setting.GetQuotaPoolSetting()
	*operation_setting.GetQuotaPoolSetting() = setting
	t.Cleanup(func() {
		*operation_setting.GetQuotaPoolSetting() = original
	})
}

// prepareQuotaClaimStatusTest 保证 quota_claim_records 表存在且干净，返回一个已插入领取记录的用户。
func prepareQuotaClaimStatusTest(t *testing.T, quota int) *User {
	t.Helper()
	require.NoError(t, DB.Migrator().DropTable("quota_claim_records"))
	require.NoError(t, DB.AutoMigrate(&QuotaClaimRecord{}))

	user := &User{Username: "qp_status_user", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	t.Cleanup(func() {
		DB.Where("user_id = ?", user.Id).Delete(&QuotaClaimRecord{})
		DB.Unscoped().Where("id = ?", user.Id).Delete(&User{})
	})

	if quota > 0 {
		now := time.Now()
		key := quotaPoolPeriodKey(QuotaPoolPeriodDaily, now)
		record := &QuotaClaimRecord{
			UserId:        user.Id,
			PoolPeriodKey: key,
			UserPeriodKey: key,
			Quota:         quota,
			Kind:          QuotaRecordKindClaim,
			ClaimedAt:     now.Unix(),
		}
		require.NoError(t, DB.Create(record).Error)
	}
	return user
}

func TestQuotaClaimStatus_AlwaysReportsPeriodStats(t *testing.T) {
	// 不配置任何上限，领取记录也应体现在次数/额度统计里
	withQuotaPoolSetting(t, operation_setting.QuotaPoolSetting{
		Enabled:      true,
		PoolPeriod:   QuotaPoolPeriodDaily,
		UserPeriod:   QuotaPoolPeriodDaily,
		AmountType:   QuotaPoolAmountFixed,
		Amount:       1000,
		BalanceMode:  QuotaPoolBalanceOff,
		UserPeriodCap: 0, // 未设上限
	})
	user := prepareQuotaClaimStatusTest(t, 3000)

	status, err := GetQuotaClaimStatus(user.Id)
	require.NoError(t, err)

	assert.Equal(t, 1, status.UserCount)
	assert.Equal(t, 3000, status.UserGranted)
	assert.False(t, status.UserCapReached, "未配置上限时不应触顶")
	assert.False(t, status.CountLimitReached)
}

func TestQuotaClaimStatus_UserCapReachedWhenResidualBelowMinClaim(t *testing.T) {
	// 已领 99800，cap=100000，剩余 200 < 最小单次发放 1000 → 应视为到顶
	withQuotaPoolSetting(t, operation_setting.QuotaPoolSetting{
		Enabled:        true,
		PoolPeriod:     QuotaPoolPeriodDaily,
		UserPeriod:     QuotaPoolPeriodDaily,
		AmountType:     QuotaPoolAmountRandom,
		MinAmount:      1000,
		MaxAmount:      10000,
		UserPeriodCap:  100000,
		BalanceMode:    QuotaPoolBalanceOff,
		UserPeriodCountLimit: 0,
	})
	user := prepareQuotaClaimStatusTest(t, 99800)

	status, err := GetQuotaClaimStatus(user.Id)
	require.NoError(t, err)

	assert.Equal(t, 99800, status.UserGranted)
	assert.True(t, status.UserCapReached, "剩余空间不足单次最小发放时应视为到顶")
}

func TestQuotaClaimStatus_UserCapNotReachedWhenResidualEqualsMinClaim(t *testing.T) {
	// 已领 99000，cap=100000，剩余 1000 == 最小发放 → 还能正好领一次，不算到顶
	withQuotaPoolSetting(t, operation_setting.QuotaPoolSetting{
		Enabled:       true,
		PoolPeriod:    QuotaPoolPeriodDaily,
		UserPeriod:    QuotaPoolPeriodDaily,
		AmountType:    QuotaPoolAmountFixed,
		Amount:        1000,
		UserPeriodCap: 100000,
		BalanceMode:   QuotaPoolBalanceOff,
	})
	user := prepareQuotaClaimStatusTest(t, 99000)

	status, err := GetQuotaClaimStatus(user.Id)
	require.NoError(t, err)

	assert.Equal(t, 99000, status.UserGranted)
	assert.False(t, status.UserCapReached, "剩余恰好等于单次发放时仍可领一次")
}
