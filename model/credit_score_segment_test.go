package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// openCreditScoreSegmentTestDB 用内存 SQLite 装配 DB 并迁移 User 表。
func openCreditScoreSegmentTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}))
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
}

// TestCountUsersByCreditScoreSegment 验证按满分百分比分桶：改 full_score 时桶等比缩放，
// 不会出现"上限调低后全员落入最低桶"；软删用户被排除。
func TestCountUsersByCreditScoreSegment(t *testing.T) {
	openCreditScoreSegmentTestDB(t)

	// full_score=100：100/90/60/40 → 100%、90%、60%、40%。
	users := []*User{
		{Username: "u-full", Password: "x", Role: common.RoleCommonUser, CreditScore: 100, AffCode: "aff-cs-1"},
		{Username: "u-high", Password: "x", Role: common.RoleCommonUser, CreditScore: 90, AffCode: "aff-cs-2"},
		{Username: "u-mid", Password: "x", Role: common.RoleCommonUser, CreditScore: 60, AffCode: "aff-cs-3"},
		{Username: "u-low", Password: "x", Role: common.RoleCommonUser, CreditScore: 40, AffCode: "aff-cs-4"},
	}
	require.NoError(t, DB.Create(&users).Error)

	// 软删 u-high（90% → 80-99% 桶）后应被排除。
	require.NoError(t, DB.Where("username = ?", "u-high").Delete(&User{}).Error)

	rows, err := CountUsersByCreditScoreSegment(100)
	require.NoError(t, err)
	// 期望桶：100%:1、80-99%:0（被删）、50-79%:1、<50%:1 → 出现 3 个桶，按 100→<50 顺序。
	require.Len(t, rows, 3)
	assert.Equal(t, "100%", rows[0].Segment)
	assert.Equal(t, int64(1), rows[0].Count)
	assert.Equal(t, "50-79%", rows[1].Segment)
	assert.Equal(t, int64(1), rows[1].Count)
	assert.Equal(t, "<50%", rows[2].Segment)
	assert.Equal(t, int64(1), rows[2].Count)

	// JSON 字段名必须小写（前端按 segment/count 读取），缺失 json tag 会序列化成大写而前端拿到 undefined。
	raw, err := common.Marshal(rows)
	require.NoError(t, err)
	assert.Contains(t, string(raw), `"segment":"100%"`)
	assert.Contains(t, string(raw), `"count":1`)
	assert.NotContains(t, string(raw), `"Segment"`)
	assert.NotContains(t, string(raw), `"Count"`)
}

// TestCountUsersByCreditScoreSegmentScalesWithFullScore 满分数值缩放：同样的绝对分，随
// full_score 调整进入不同百分比桶（桶不写死、跟随上限等比缩放）。
func TestCountUsersByCreditScoreSegmentScalesWithFullScore(t *testing.T) {
	openCreditScoreSegmentTestDB(t)

	// 绝对分 300：full_score=650 时 ≈46%（<50%）；full_score=600 时 =50%（50-79%）。
	users := []*User{
		{Username: "s1", Password: "x", Role: common.RoleCommonUser, CreditScore: 300, AffCode: "aff-cs-s1"},
	}
	require.NoError(t, DB.Create(&users).Error)

	rows650, err := CountUsersByCreditScoreSegment(650)
	require.NoError(t, err)
	require.Len(t, rows650, 1)
	assert.Equal(t, "<50%", rows650[0].Segment)

	rows600, err := CountUsersByCreditScoreSegment(600)
	require.NoError(t, err)
	require.Len(t, rows600, 1)
	assert.Equal(t, "50-79%", rows600[0].Segment)
}
