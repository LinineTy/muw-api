package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParseSensitiveWordsFromReason 从扣分原因解析命中的敏感词。
func TestParseSensitiveWordsFromReason(t *testing.T) {
	tests := []struct {
		name   string
		reason string
		want   []string
	}{
		{name: "multiple words", reason: "敏感词命中: 词A, 词B", want: []string{"词A", "词B"}},
		{name: "no space after colon", reason: "敏感词命中:词A", want: []string{"词A"}},
		{name: "extra spaces", reason: "敏感词命中:   词A , 词B  ", want: []string{"词A", "词B"}},
		{name: "non keyword source", reason: "上游违规标记词: xxx", want: nil},
		{name: "empty hits", reason: "敏感词命中:", want: nil},
		{name: "empty reason", reason: "", want: nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, parseSensitiveWordsFromReason(tt.reason))
		})
	}
}

// openRevertTestDB 装配 User/CreditScoreLog/Option 表（options 供 UpdateOption 写词库用）。
// UpdateOption 会同步 common.OptionMap 内存缓存，测试里需先初始化该 map（正常进程启动时
// 由 InitOptionMap 填充，测试环境为 nil）。
func openRevertTestDB(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.CreditScoreLog{}, &model.Option{}))
	prevWords := setting.SensitiveWords
	prevOptionMap := common.OptionMap
	common.OptionMap = make(map[string]string)
	t.Cleanup(func() {
		setting.SensitiveWords = prevWords
		common.OptionMap = prevOptionMap
		model.DB.Exec("DELETE FROM credit_score_logs")
		model.DB.Exec("DELETE FROM users WHERE username LIKE 'revt-%'")
		model.DB.Exec("DELETE FROM options WHERE `key` = 'SensitiveWords'")
	})
}

// TestRevertKeywordDeduction 打回敏感词扣分完整流程：恢复分数 + 可选删词 + 幂等拒绝。
func TestRevertKeywordDeduction(t *testing.T) {
	openRevertTestDB(t)
	setting.SensitiveWords = []string{"test_sensitive", "keep_me"}

	user := &model.User{Username: "revt-1", Password: "x", Role: common.RoleCommonUser, CreditScore: 90, AffCode: "aff-revt-1"}
	require.NoError(t, model.DB.Create(user).Error)
	sourceLog := &model.CreditScoreLog{
		UserId: user.Id, Source: CreditSourceLocalKeyword, Points: -10, Balance: 90,
		Reason: "敏感词命中: test_sensitive",
	}
	require.NoError(t, model.DB.Create(sourceLog).Error)

	// 打回 + 删词。
	balance, userId, points, err := RevertKeywordDeduction(sourceLog.Id, []string{"test_sensitive"})
	require.NoError(t, err)
	assert.Equal(t, 100, balance)
	assert.Equal(t, user.Id, userId)
	assert.Equal(t, 10, points)
	assert.Equal(t, []string{"keep_me"}, setting.SensitiveWords, "test_sensitive should be removed from library")

	// 原记录已标记打回；恢复审计已落。
	var updated model.CreditScoreLog
	require.NoError(t, model.DB.First(&updated, sourceLog.Id).Error)
	assert.NotZero(t, updated.RevertedAt)
	var revertRows []model.CreditScoreLog
	require.NoError(t, model.DB.Where("source = ?", CreditSourceRevert).Find(&revertRows).Error)
	require.Len(t, revertRows, 1)
	assert.Equal(t, 10, revertRows[0].Points)

	// 幂等：二次打回拒绝，分数不再变化。
	_, _, _, err = RevertKeywordDeduction(sourceLog.Id, nil)
	assert.ErrorIs(t, err, model.ErrCreditScoreLogAlreadyReverted)
}

// TestRevertKeywordDeductionRejectsNonKeyword 只允许打回本地敏感词扣分（local_keyword）。
func TestRevertKeywordDeductionRejectsNonKeyword(t *testing.T) {
	openRevertTestDB(t)

	user := &model.User{Username: "revt-2", Password: "x", Role: common.RoleCommonUser, CreditScore: 90, AffCode: "aff-revt-2"}
	require.NoError(t, model.DB.Create(user).Error)
	log := &model.CreditScoreLog{
		UserId: user.Id, Source: CreditSourceUpstreamViolation, Points: -5, Balance: 85, Reason: "上游违规标记词: x",
	}
	require.NoError(t, model.DB.Create(log).Error)

	_, _, _, err := RevertKeywordDeduction(log.Id, nil)
	assert.Error(t, err)
	assert.NotContains(t, err.Error(), "已打回")
}

// TestRevertKeywordDeductionValidatesRemoveWords remove_words 必须来自该记录命中的词。
func TestRevertKeywordDeductionValidatesRemoveWords(t *testing.T) {
	openRevertTestDB(t)
	setting.SensitiveWords = []string{"aaa", "bbb"}

	user := &model.User{Username: "revt-3", Password: "x", Role: common.RoleCommonUser, CreditScore: 90, AffCode: "aff-revt-3"}
	require.NoError(t, model.DB.Create(user).Error)
	log := &model.CreditScoreLog{
		UserId: user.Id, Source: CreditSourceLocalKeyword, Points: -5, Balance: 85,
		Reason: "敏感词命中: aaa",
	}
	require.NoError(t, model.DB.Create(log).Error)

	// 传了一个记录未命中的词 → 拒绝，且分数不变。
	_, _, _, err := RevertKeywordDeduction(log.Id, []string{"aaa", "not_hit"})
	assert.Error(t, err)

	var userNow model.User
	require.NoError(t, model.DB.First(&userNow, user.Id).Error)
	assert.Equal(t, 90, userNow.CreditScore)
	assert.Equal(t, []string{"aaa", "bbb"}, setting.SensitiveWords)
}

// TestRevertKeywordDeductionRevertOnly 仅打回不删词：分数恢复，词库不动。
func TestRevertKeywordDeductionRevertOnly(t *testing.T) {
	openRevertTestDB(t)
	setting.SensitiveWords = []string{"aaa", "bbb"}

	user := &model.User{Username: "revt-4", Password: "x", Role: common.RoleCommonUser, CreditScore: 90, AffCode: "aff-revt-4"}
	require.NoError(t, model.DB.Create(user).Error)
	log := &model.CreditScoreLog{
		UserId: user.Id, Source: CreditSourceLocalKeyword, Points: -5, Balance: 85,
		Reason: "敏感词命中: aaa",
	}
	require.NoError(t, model.DB.Create(log).Error)

	balance, _, _, err := RevertKeywordDeduction(log.Id, nil)
	require.NoError(t, err)
	assert.Equal(t, 95, balance)
	assert.Equal(t, []string{"aaa", "bbb"}, setting.SensitiveWords)
}
