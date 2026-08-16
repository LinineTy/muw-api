package model

import (
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openCreditScoreLogTestDB 用内存 SQLite 装配 DB 并迁移 User + CreditScoreLog 表。
func openCreditScoreLogTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &CreditScoreLog{}))
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
}

// TestMultiplierForRepeat 纯函数倍率阶梯：occurrence 取 from <= occurrence 中 from
// 最大的一档，低于最小 from 为 ×1，超出最后一档沿用其倍率；无效档（from<2、倍率
// 非正/NaN/Inf）被跳过，损坏配置不参与计算。
func TestMultiplierForRepeat(t *testing.T) {
	defaultTiers := []operation_setting.RepeatMultiplierTier{
		{From: 2, Multiplier: 2},
		{From: 3, Multiplier: 3},
	}
	multiTiers := []operation_setting.RepeatMultiplierTier{
		{From: 2, Multiplier: 1.5},
		{From: 3, Multiplier: 2},
		{From: 5, Multiplier: 3},
	}
	invalidTiers := []operation_setting.RepeatMultiplierTier{
		{From: 1, Multiplier: 9},  // from<2：第 1 次恒为 ×1，该档无效
		{From: 2, Multiplier: 0},  // 倍率非正：无效
		{From: 3, Multiplier: -2}, // 负倍率：无效
		{From: 4, Multiplier: 2},  // 有效
	}

	tests := []struct {
		name       string
		occurrence int
		tiers      []operation_setting.RepeatMultiplierTier
		want       float64
	}{
		{name: "no tiers always x1", occurrence: 3, tiers: nil, want: 1},
		{name: "empty tiers always x1", occurrence: 3, tiers: []operation_setting.RepeatMultiplierTier{}, want: 1},
		{name: "first occurrence always x1", occurrence: 1, tiers: defaultTiers, want: 1},
		{name: "second occurrence x2", occurrence: 2, tiers: defaultTiers, want: 2},
		{name: "third occurrence x3", occurrence: 3, tiers: defaultTiers, want: 3},
		{name: "last tier applies to later occurrences", occurrence: 8, tiers: defaultTiers, want: 3},
		{name: "decimal tier", occurrence: 2, tiers: multiTiers, want: 1.5},
		{name: "middle tier keeps its multiplier", occurrence: 4, tiers: multiTiers, want: 2},
		{name: "last tier", occurrence: 5, tiers: multiTiers, want: 3},
		{name: "last tier applies to later occurrences", occurrence: 9, tiers: multiTiers, want: 3},
		{name: "invalid tiers skipped", occurrence: 4, tiers: invalidTiers, want: 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, multiplierForRepeat(tt.occurrence, tt.tiers))
		})
	}

	// NaN/Inf 倍率档不 panic 且被跳过。
	nanInf := []operation_setting.RepeatMultiplierTier{
		{From: 2, Multiplier: math.NaN()},
		{From: 3, Multiplier: math.Inf(1)},
		{From: 4, Multiplier: 2},
	}
	assert.Equal(t, 1.0, multiplierForRepeat(2, nanInf))
	assert.Equal(t, 1.0, multiplierForRepeat(3, nanInf))
	assert.Equal(t, 2.0, multiplierForRepeat(4, nanInf))
}

// TestApplyCreditScoreDeductionRepeatTiers 事务内倍率：默认阶梯 第2次×2、第3次起×3 封顶；
// 小数倍率乘积四舍五入取整；关闭（nil）时恒为 ×1。
func TestApplyCreditScoreDeductionRepeatTiers(t *testing.T) {
	openCreditScoreLogTestDB(t)
	defaultTiers := []operation_setting.RepeatMultiplierTier{
		{From: 2, Multiplier: 2},
		{From: 3, Multiplier: 3},
	}
	windowStart := time.Now().Unix() - 24*3600

	t.Run("default tiers 2x then 3x cap", func(t *testing.T) {
		user := &User{Username: "rep-1", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-rep-1"}
		require.NoError(t, DB.Create(user).Error)

		// 第1~4次分别扣 5/10/15/15，余额逐次累计。
		wantApplied := []int{5, 10, 15, 15}
		wantBalance := []int{95, 85, 70, 55}
		for i := range wantApplied {
			applied, balance, err := ApplyCreditScoreDeduction(
				user.Id, "upstream_violation", 5, 650, defaultTiers, 0, windowStart,
				&CreditScoreLog{Source: "upstream_violation", Reason: "test-repeat"})
			require.NoError(t, err)
			assert.Equal(t, wantApplied[i], applied, "attempt %d applied", i+1)
			assert.Equal(t, wantBalance[i], balance, "attempt %d balance", i+1)
		}

		var count int64
		require.NoError(t, DB.Model(&CreditScoreLog{}).Count(&count).Error)
		assert.Equal(t, int64(4), count)
	})

	t.Run("decimal multiplier rounds half away from zero", func(t *testing.T) {
		user := &User{Username: "rep-2", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-rep-2"}
		require.NoError(t, DB.Create(user).Error)
		tiers := []operation_setting.RepeatMultiplierTier{{From: 2, Multiplier: 1.5}}

		applied1, _, err := ApplyCreditScoreDeduction(user.Id, "upstream_violation", 5, 650, tiers, 0, windowStart, &CreditScoreLog{Source: "upstream_violation", Reason: "t1"})
		require.NoError(t, err)
		assert.Equal(t, 5, applied1)

		// round(5 × 1.5) = round(7.5) = 8。
		applied2, _, err := ApplyCreditScoreDeduction(user.Id, "upstream_violation", 5, 650, tiers, 0, windowStart, &CreditScoreLog{Source: "upstream_violation", Reason: "t2"})
		require.NoError(t, err)
		assert.Equal(t, 8, applied2)
	})

	t.Run("disabled repeat deducts base only", func(t *testing.T) {
		user := &User{Username: "rep-3", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-rep-3"}
		require.NoError(t, DB.Create(user).Error)

		for i := 0; i < 3; i++ {
			applied, _, err := ApplyCreditScoreDeduction(
				user.Id, "local_keyword", 5, 650, nil, 0, windowStart, &CreditScoreLog{Source: "local_keyword", Reason: "t-disabled"})
			require.NoError(t, err)
			assert.Equal(t, 5, applied, "attempt %d should be base only", i+1)
		}
	})
}

// TestApplyCreditScoreRevert 打回：加回分数 + 标记原记录已打回 + 落恢复审计；二次打回幂等拒绝。
func TestApplyCreditScoreRevert(t *testing.T) {
	openCreditScoreLogTestDB(t)
	user := &User{Username: "rev-1", Password: "x", Role: common.RoleCommonUser, CreditScore: 90, AffCode: "aff-rev-1"}
	require.NoError(t, DB.Create(user).Error)
	sourceLog := &CreditScoreLog{
		UserId: user.Id, Source: "local_keyword", Points: -10, Balance: 90,
		Reason: "敏感词命中: test_sensitive",
	}
	require.NoError(t, DB.Create(sourceLog).Error)

	revertLog := &CreditScoreLog{Source: "admin_revert", Reason: "打回测试"}
	balance, err := ApplyCreditScoreRevert(sourceLog.Id, user.Id, 10, 650, revertLog)
	require.NoError(t, err)
	assert.Equal(t, 100, balance)

	// 原记录已标记打回；恢复审计明细已落。
	var updated CreditScoreLog
	require.NoError(t, DB.First(&updated, sourceLog.Id).Error)
	assert.NotZero(t, updated.RevertedAt, "original log should be marked reverted")

	var revertRows []CreditScoreLog
	require.NoError(t, DB.Where("source = ?", "admin_revert").Find(&revertRows).Error)
	require.Len(t, revertRows, 1)
	assert.Equal(t, 10, revertRows[0].Points)
	assert.Equal(t, 100, revertRows[0].Balance)

	// 幂等：二次打回同一记录被拒绝，分数不再增加。
	_, err = ApplyCreditScoreRevert(sourceLog.Id, user.Id, 10, 650, &CreditScoreLog{Source: "admin_revert", Reason: "x"})
	assert.ErrorIs(t, err, ErrCreditScoreLogAlreadyReverted)

	var finalUser User
	require.NoError(t, DB.First(&finalUser, user.Id).Error)
	assert.Equal(t, 100, finalUser.CreditScore)
}

// TestApplyCreditScoreRevertClampsToMax 打回加回分数 clamp 到满分，不超出。
func TestApplyCreditScoreRevertClampsToMax(t *testing.T) {
	openCreditScoreLogTestDB(t)
	user := &User{Username: "rev-2", Password: "x", Role: common.RoleCommonUser, CreditScore: 95, AffCode: "aff-rev-2"}
	require.NoError(t, DB.Create(user).Error)
	sourceLog := &CreditScoreLog{
		UserId: user.Id, Source: "local_keyword", Points: -5, Balance: 95, Reason: "敏感词命中: w",
	}
	require.NoError(t, DB.Create(sourceLog).Error)

	// maxScore=100：95+10 → clamp 到 100。
	balance, err := ApplyCreditScoreRevert(sourceLog.Id, user.Id, 10, 100, &CreditScoreLog{Source: "admin_revert"})
	require.NoError(t, err)
	assert.Equal(t, 100, balance)
}

// TestApplyCreditScoreRevertRejectsNonPositiveDelta 打回增量必须为正（恢复语义），拒绝 0/负值。
func TestApplyCreditScoreRevertRejectsNonPositiveDelta(t *testing.T) {
	openCreditScoreLogTestDB(t)
	user := &User{Username: "rev-3", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-rev-3"}
	require.NoError(t, DB.Create(user).Error)

	_, err := ApplyCreditScoreRevert(1, user.Id, 0, 100, &CreditScoreLog{Source: "admin_revert"})
	assert.Error(t, err)
	_, err = ApplyCreditScoreRevert(1, user.Id, -5, 100, &CreditScoreLog{Source: "admin_revert"})
	assert.Error(t, err)
}

// TestApplyCreditScoreDeductionExcludesReverted 已打回的扣分不计入 24h 同类违规次数，
// 避免误判扣分推高后续重复倍率；也不占用每日扣分上限额度。
func TestApplyCreditScoreDeductionExcludesReverted(t *testing.T) {
	openCreditScoreLogTestDB(t)
	user := &User{Username: "rep-rev", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-rep-rev"}
	require.NoError(t, DB.Create(user).Error)
	tiers := []operation_setting.RepeatMultiplierTier{
		{From: 2, Multiplier: 2},
		{From: 3, Multiplier: 3},
	}
	windowStart := time.Now().Unix() - 24*3600

	// 第 1 次 ×1，第 2 次 ×2。
	applied1, _, err := ApplyCreditScoreDeduction(user.Id, "local_keyword", 5, 650, tiers, 0, windowStart,
		&CreditScoreLog{Source: "local_keyword", Reason: "a"})
	require.NoError(t, err)
	assert.Equal(t, 5, applied1)
	applied2, _, err := ApplyCreditScoreDeduction(user.Id, "local_keyword", 5, 650, tiers, 0, windowStart,
		&CreditScoreLog{Source: "local_keyword", Reason: "b"})
	require.NoError(t, err)
	assert.Equal(t, 10, applied2)

	// 打回第 1 条扣分。
	var firstLog CreditScoreLog
	require.NoError(t, DB.Where("user_id = ?", user.Id).Order("id asc").First(&firstLog).Error)
	_, err = ApplyCreditScoreRevert(firstLog.Id, user.Id, 5, 650, &CreditScoreLog{Source: "admin_revert"})
	require.NoError(t, err)

	// 再扣第 3 次：未打回同类记录只有 1 条 → occurrence=2 → ×2（而非 ×3）。
	applied3, _, err := ApplyCreditScoreDeduction(user.Id, "local_keyword", 5, 650, tiers, 0, windowStart,
		&CreditScoreLog{Source: "local_keyword", Reason: "c"})
	require.NoError(t, err)
	assert.Equal(t, 10, applied3)
}

// TestApplyCreditScoreDeductionRevertedFreesDailyCap 打回后该扣分不再占用每日扣分上限。
func TestApplyCreditScoreDeductionRevertedFreesDailyCap(t *testing.T) {
	openCreditScoreLogTestDB(t)
	user := &User{Username: "rep-cap", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-rep-cap"}
	require.NoError(t, DB.Create(user).Error)
	windowStart := time.Now().Unix() - 24*3600

	// 每日上限 5：第一笔扣 5 后达到上限，第二笔被拦（applied=0）。
	applied1, _, err := ApplyCreditScoreDeduction(user.Id, "local_keyword", 5, 650, nil, 5, windowStart,
		&CreditScoreLog{Source: "local_keyword", Reason: "a"})
	require.NoError(t, err)
	assert.Equal(t, 5, applied1)
	applied2, _, err := ApplyCreditScoreDeduction(user.Id, "local_keyword", 5, 650, nil, 5, windowStart,
		&CreditScoreLog{Source: "local_keyword", Reason: "b"})
	require.NoError(t, err)
	assert.Equal(t, 0, applied2)

	// 打回第一笔：额度释放，再次扣分不再被上限拦截。
	var firstLog CreditScoreLog
	require.NoError(t, DB.Where("user_id = ?", user.Id).Order("id asc").First(&firstLog).Error)
	_, err = ApplyCreditScoreRevert(firstLog.Id, user.Id, 5, 650, &CreditScoreLog{Source: "admin_revert"})
	require.NoError(t, err)

	applied3, _, err := ApplyCreditScoreDeduction(user.Id, "local_keyword", 5, 650, nil, 5, windowStart,
		&CreditScoreLog{Source: "local_keyword", Reason: "c"})
	require.NoError(t, err)
	assert.Equal(t, 5, applied3)
}

// TestEnsureCreditScoreLogReverted 回归：已打最新 schema 版本戳、跳过 AutoMigrate 的存量库
// credit_score_logs 缺 reverted_at 列时，ensureCreditScoreLogReverted 幂等补列（否则打回/
// 扣分查询引用该列会报 SQL logic error: no such column）。
func TestEnsureCreditScoreLogReverted(t *testing.T) {
	db := openLegacyUpgradeDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE credit_score_logs (
		id integer PRIMARY KEY,
		user_id integer,
		source varchar(32),
		points integer,
		balance integer,
		request_id varchar(64),
		reason varchar(512),
		created_at bigint)`).Error)

	require.NoError(t, ensureCreditScoreLogReverted(db))
	assert.True(t, db.Migrator().HasColumn(&CreditScoreLog{}, "reverted_at"))

	// 幂等：已有列时 no-op 不报错。
	require.NoError(t, ensureCreditScoreLogReverted(db))
}

// TestApplyCreditScoreRevertHandlesNullColumn 回归：存量库 reverted_at 列值是 NULL
// （AutoMigrate 加列无默认值），打回必须能匹配（COALESCE），不能误报"已打回"。
func TestApplyCreditScoreRevertHandlesNullColumn(t *testing.T) {
	openCreditScoreLogTestDB(t)
	user := &User{Username: "rev-null", Password: "x", Role: common.RoleCommonUser, CreditScore: 90, AffCode: "aff-rev-null"}
	require.NoError(t, DB.Create(user).Error)
	sourceLog := &CreditScoreLog{
		UserId: user.Id, Source: "local_keyword", Points: -10, Balance: 90, Reason: "敏感词命中: w",
	}
	require.NoError(t, DB.Create(sourceLog).Error)
	// 模拟存量库：列值为 NULL 而非 0。
	require.NoError(t, DB.Exec("UPDATE credit_score_logs SET reverted_at = NULL WHERE id = ?", sourceLog.Id).Error)

	balance, err := ApplyCreditScoreRevert(sourceLog.Id, user.Id, 10, 650, &CreditScoreLog{Source: "admin_revert"})
	require.NoError(t, err)
	assert.Equal(t, 100, balance)
}

// TestApplyCreditScoreDeductionTreatsNullAsNotReverted 回归：存量 NULL 行按未打回处理，
// 计入 24h 重复倍率次数（COALESCE），裸 `reverted_at = 0` 会误排除。
func TestApplyCreditScoreDeductionTreatsNullAsNotReverted(t *testing.T) {
	openCreditScoreLogTestDB(t)
	user := &User{Username: "rep-null", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-rep-null"}
	require.NoError(t, DB.Create(user).Error)
	tiers := []operation_setting.RepeatMultiplierTier{
		{From: 2, Multiplier: 2},
		{From: 3, Multiplier: 3},
	}
	windowStart := time.Now().Unix() - 24*3600

	applied1, _, err := ApplyCreditScoreDeduction(user.Id, "local_keyword", 5, 650, tiers, 0, windowStart,
		&CreditScoreLog{Source: "local_keyword", Reason: "a"})
	require.NoError(t, err)
	assert.Equal(t, 5, applied1)
	// 存量行置 NULL（未打回标记缺失时的老数据形态）。
	require.NoError(t, DB.Exec("UPDATE credit_score_logs SET reverted_at = NULL WHERE id = ?", 1).Error)

	// 第 2 次仍按 occurrence=2 计 ×2。
	applied2, _, err := ApplyCreditScoreDeduction(user.Id, "local_keyword", 5, 650, tiers, 0, windowStart,
		&CreditScoreLog{Source: "local_keyword", Reason: "b"})
	require.NoError(t, err)
	assert.Equal(t, 10, applied2)
}
