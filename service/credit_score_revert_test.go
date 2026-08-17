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

// TestRevertKeywordDeductionValidatesRemoveWords 删词不再因"词不在该记录命中词里"而整单
// 失败：库里存在的词照删（大小写不敏感），库里没有的词忽略（幂等），分数照常恢复。
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

	// 传了一个记录未命中的词（not_hit）：不再拒绝，库里存在的 aaa 删除、not_hit 忽略。
	balance, _, _, err := RevertKeywordDeduction(log.Id, []string{"aaa", "not_hit"})
	require.NoError(t, err)
	assert.Equal(t, 95, balance)

	var userNow model.User
	require.NoError(t, model.DB.First(&userNow, user.Id).Error)
	assert.Equal(t, 95, userNow.CreditScore)
	assert.Equal(t, []string{"bbb"}, setting.SensitiveWords)
}

// TestRevertKeywordDeductionsBatch 批量打回：同一用户的多条扣分只落一条聚合恢复明细
// （Points=Σ|points|，Reason 列源记录 id），分数一次性加回，词库并集删除。
func TestRevertKeywordDeductionsBatch(t *testing.T) {
	openRevertTestDB(t)
	setting.SensitiveWords = []string{"aaa", "bbb", "ccc"}

	user := &model.User{Username: "revt-batch", Password: "x", Role: common.RoleCommonUser, CreditScore: 80, AffCode: "aff-revt-batch"}
	require.NoError(t, model.DB.Create(user).Error)
	logs := []*model.CreditScoreLog{
		{UserId: user.Id, Source: CreditSourceLocalKeyword, Points: -5, Balance: 75, Reason: "敏感词命中: aaa"},
		{UserId: user.Id, Source: CreditSourceLocalKeyword, Points: -10, Balance: 65, Reason: "敏感词命中: bbb, ccc"},
	}
	require.NoError(t, model.DB.Create(&logs).Error)

	summary, err := RevertKeywordDeductions([]int64{logs[0].Id, logs[1].Id})
	require.NoError(t, err)
	assert.Equal(t, map[int]int{user.Id: 15}, summary)

	var u model.User
	require.NoError(t, model.DB.First(&u, user.Id).Error)
	assert.Equal(t, 95, u.CreditScore)

	// 两条源记录都标记打回；恢复明细只有一条（聚合 Points=15）。
	var revertRows []model.CreditScoreLog
	require.NoError(t, model.DB.Where("source = ?", CreditSourceRevert).Find(&revertRows).Error)
	require.Len(t, revertRows, 1)
	assert.Equal(t, 15, revertRows[0].Points)
	assert.Equal(t, 95, revertRows[0].Balance)
	assert.Equal(t, user.Id, revertRows[0].UserId)

	var updated []model.CreditScoreLog
	require.NoError(t, model.DB.Where("id IN ?", []int64{logs[0].Id, logs[1].Id}).Find(&updated).Error)
	for _, l := range updated {
		assert.NotZero(t, l.RevertedAt)
	}

	// 词库并集删除。
	assert.Empty(t, setting.SensitiveWords)

	// 幂等：已打回的记录再批量打回直接跳过，返回空聚合。
	summary2, err := RevertKeywordDeductions([]int64{logs[0].Id, logs[1].Id})
	require.NoError(t, err)
	assert.Empty(t, summary2)
}

// TestRevertAllKeywordHits 按关键词一键打回：只打回精确命中该词的记录（子串不误伤），
// 跨用户聚合，可选删词。
func TestRevertAllKeywordHits(t *testing.T) {
	openRevertTestDB(t)
	setting.SensitiveWords = []string{"aaa", "baa", "ccc"}

	userA := &model.User{Username: "revt-kw-a", Password: "x", Role: common.RoleCommonUser, CreditScore: 80, AffCode: "aff-kw-a"}
	userB := &model.User{Username: "revt-kw-b", Password: "x", Role: common.RoleCommonUser, CreditScore: 60, AffCode: "aff-kw-b"}
	require.NoError(t, model.DB.Create(userA).Error)
	require.NoError(t, model.DB.Create(userB).Error)
	logs := []*model.CreditScoreLog{
		{UserId: userA.Id, Source: CreditSourceLocalKeyword, Points: -5, Balance: 75, Reason: "敏感词命中: aaa"},
		{UserId: userA.Id, Source: CreditSourceLocalKeyword, Points: -10, Balance: 65, Reason: "敏感词命中: baa"},
		{UserId: userB.Id, Source: CreditSourceLocalKeyword, Points: -5, Balance: 55, Reason: "敏感词命中: aaa"},
	}
	require.NoError(t, model.DB.Create(&logs).Error)

	// 命中 "aaa" 的只有 userA 的 log0 与 userB 的 log2；"baa" 是子串但不是精确命中。
	summary, count, err := RevertAllKeywordHits("aaa", true)
	require.NoError(t, err)
	assert.Equal(t, 2, count)
	assert.Equal(t, map[int]int{userA.Id: 5, userB.Id: 5}, summary)

	// aaa 已从词库删除，baa/ccc 保留。
	assert.Equal(t, []string{"baa", "ccc"}, setting.SensitiveWords)

	// 两条 aaa 记录已打回，baa 那条未打回。
	var updated []model.CreditScoreLog
	require.NoError(t, model.DB.Where("id IN ?", []int64{logs[0].Id, logs[1].Id, logs[2].Id}).Find(&updated).Error)
	byID := map[int64]int64{}
	for _, l := range updated {
		byID[l.Id] = l.RevertedAt
	}
	assert.NotZero(t, byID[logs[0].Id])
	assert.NotZero(t, byID[logs[2].Id])
	assert.Zero(t, byID[logs[1].Id])
}

// TestRevertAllKeywordHitsRemovesWordWithoutMatches 按关键词一键打回在没有匹配记录时仍删词：
// 管理员认定某词误伤后"删词 + 清历史"，即使已无（或全部已打回）命中记录，removeFromLibrary
// 也应把该词从词库删除（revertDeductionsByUser 不再因 byUser 为空而提前跳过删词）。
func TestRevertAllKeywordHitsRemovesWordWithoutMatches(t *testing.T) {
	openRevertTestDB(t)
	setting.SensitiveWords = []string{"aaa", "bbb"}

	// 没有任何记录命中 bbb：matched 为空，但 removeFromLibrary 仍应把 bbb 删掉。
	summary, count, err := RevertAllKeywordHits("bbb", true)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
	assert.Empty(t, summary)
	assert.Equal(t, []string{"aaa"}, setting.SensitiveWords)
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
