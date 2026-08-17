package service

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRunCreditScoreReset 全站信誉分重置核心不变量：
//   - 先清空全部信用分明细（旧扣分/保证书历史被删除），再重置分数（含"新满分低于旧分"时
//     往下拉）；
//   - 重置本身不写 full_score_reset 明细：重置后表彻底为空，下一条落库 id 从 1 重新开始；
//   - 已在满分的用户跳过；
//   - 软删用户不参与；
//   - 旧保证书记录被清空 → 保证书冷却自然失效。
func TestRunCreditScoreReset(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.CreditScoreLog{}))

	setting := operation_setting.GetCreditScoreSetting()
	prevFull := setting.FullScore
	setting.FullScore = 100
	t.Cleanup(func() {
		setting.FullScore = prevFull
		model.DB.Exec("DELETE FROM credit_score_logs")
		model.DB.Exec("DELETE FROM users WHERE username IN ('reset-full','reset-low','reset-high','reset-none')")
	})

	now := time.Now().Unix()
	users := []*model.User{
		{Username: "reset-full", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-rs-full"},
		{Username: "reset-low", Password: "x", Role: common.RoleCommonUser, CreditScore: 40, AffCode: "aff-rs-low"},
		{Username: "reset-high", Password: "x", Role: common.RoleCommonUser, CreditScore: 120, AffCode: "aff-rs-high"},
		{Username: "reset-none", Password: "x", Role: common.RoleCommonUser, CreditScore: 80, AffCode: "aff-rs-none"},
	}
	require.NoError(t, model.DB.Create(&users).Error)

	// 旧历史：reset-low 一条扣分 + 一条保证书（重置后应被清空，冷却随之失效）。
	require.NoError(t, model.DB.Create(&model.CreditScoreLog{
		UserId: users[1].Id, Source: CreditSourceUpstreamViolation, Points: -5, Balance: 35, CreatedAt: now,
	}).Error)
	require.NoError(t, model.DB.Create(&model.CreditScoreLog{
		UserId: users[1].Id, Source: CreditSourcePledge, Points: 10, Balance: 40, CreatedAt: now,
	}).Error)
	// reset-none 被软删（不参与重置）。
	require.NoError(t, model.DB.Where("username = ?", "reset-none").Delete(&model.User{}).Error)

	summary, err := RunCreditScoreReset(context.Background(), nil)
	require.NoError(t, err)
	// reset=2（low/high），skipped=1（full），cleared_logs=2（旧扣分+旧保证书）。
	assert.Equal(t, map[string]int{"reset": 2, "skipped": 1, "failed": 0, "cleared_logs": 2}, summary)

	// 分数全部归一到新满分 100。
	for _, name := range []string{"reset-full", "reset-low", "reset-high"} {
		var u model.User
		require.NoError(t, model.DB.Where("username = ?", name).First(&u).Error)
		assert.Equal(t, 100, u.CreditScore, name)
	}

	// 明细=彻底清空：旧扣分/保证书被删，重置也不写 full_score_reset。
	var logs []model.CreditScoreLog
	require.NoError(t, model.DB.Order("id asc").Find(&logs).Error)
	assert.Empty(t, logs)

	// 主键序列已重置：下一条落库 id 从 1 开始（测试跑在 SQLite；MySQL/PG 由
	// ResetCreditScoreLogSequence 的方言分支处理）。
	newLog := &model.CreditScoreLog{
		UserId: users[1].Id, Source: CreditSourcePledge, Points: 5, Balance: 100, CreatedAt: now,
	}
	require.NoError(t, model.DB.Create(newLog).Error)
	assert.Equal(t, int64(1), newLog.Id)
}
