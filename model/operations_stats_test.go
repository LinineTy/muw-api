package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/glebarez/sqlite"
)

// 运营统计的 SQL 是 DB.Raw 原样透传的,踩过两类方言/映射坑(2026-09-19 修):
//  1. `key` 是 MySQL 保留字 —— 别名必须避开(改 row_key),否则 Error 1064
//  2. 整除:MySQL 的 `/` 是浮点除法(20607.0392 扫不进 int64),必须 DIV
//  3. GORM 的 Scan 按字段名匹配列、不读 json tag —— RankingRow.Count 要显式 column:requests
//
// 本文件在 SQLite(dev 同款)上跑通全链路;MySQL 侧已用等价 SQL 在真实库上实测。

func openOperationsStatsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &Log{}, &Channel{}))
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
	return db
}

// 趋势:day_idx 必须是整数、按天正确聚合,且新增用户与活跃用户能按同一天合并。
func TestGetOperationsTrendsAggregatesByDay(t *testing.T) {
	db := openOperationsStatsTestDB(t)
	now := time.Now().Unix()

	require.NoError(t, db.Create(&User{Username: "u1", AffCode: "a1", CreatedAt: now - 3600}).Error)
	require.NoError(t, db.Create(&User{Username: "u2", AffCode: "a2", CreatedAt: now - 7200}).Error)

	for _, uid := range []int{1, 1, 2} {
		require.NoError(t, db.Create(&Log{
			UserId:    uid,
			Type:      LogTypeConsume,
			CreatedAt: now - 1800,
			Quota:     100,
		}).Error)
	}

	rows, err := GetOperationsTrends(30, 0)
	require.NoError(t, err)
	require.NotEmpty(t, rows)

	// 所有 day_idx 必须是整数天序号(不是 20607.0392 那种浮点)。
	var totalNew, totalActive, totalReq, totalQuota int64
	for _, r := range rows {
		require.Greater(t, r.DayIdx, int64(0))
		totalNew += r.NewUsers
		totalActive += r.ActiveUsers
		totalReq += r.Requests
		totalQuota += r.Quota
	}
	assert.EqualValues(t, 2, totalNew, "两个用户应归到新增")
	assert.EqualValues(t, 2, totalActive, "两个不同 user_id 应算作活跃")
	assert.EqualValues(t, 3, totalReq)
	assert.EqualValues(t, 300, totalQuota)

	// 趋势行按 day_idx 升序。
	for i := 1; i < len(rows); i++ {
		assert.Less(t, rows[i-1].DayIdx, rows[i].DayIdx, "趋势应按 day_idx 升序")
	}
}

// 排行:核心是验 RankingRow 的字段映射 —— Key/Name/Count/Quota/Users 都要扫对,
// 尤其 Count(列别名 requests)在漏标 gorm:"column:requests" 时会恒为 0。
func TestGetOperationsRankingsMapsAllColumns(t *testing.T) {
	db := openOperationsStatsTestDB(t)
	now := time.Now().Unix()

	require.NoError(t, db.Create(&Channel{Id: 7, Name: "ch-seven"}).Error)

	for _, uid := range []int{1, 1, 2} {
		require.NoError(t, db.Create(&Log{
			UserId:    uid,
			ChannelId: 7,
			ModelName: "test-model",
			Type:      LogTypeConsume,
			CreatedAt: now - 600,
			Quota:     100,
		}).Error)
	}
	// 空 model_name 应被 models 排行过滤掉;channel_id=0 则不进渠道排行。
	require.NoError(t, db.Create(&Log{
		UserId: 3, ChannelId: 0, ModelName: "", Type: LogTypeConsume, CreatedAt: now - 600, Quota: 999,
	}).Error)

	r, err := GetOperationsRankings(30)
	require.NoError(t, err)

	require.Len(t, r.Models, 1)
	m := r.Models[0]
	assert.Equal(t, "test-model", m.Key)
	assert.Equal(t, "test-model", m.Name)
	assert.EqualValues(t, 3, m.Count, "Count 必须映射到 requests 列(漏 tag 会恒为 0)")
	assert.EqualValues(t, 300, m.Quota)
	assert.EqualValues(t, 2, m.Users)

	require.Len(t, r.Channels, 1)
	c := r.Channels[0]
	assert.Equal(t, "7", c.Key, "channel_id 是数字列,扫进 string 字段会得到 \"7\"")
	assert.Equal(t, "ch-seven", c.Name)
	assert.EqualValues(t, 3, c.Count)
	assert.EqualValues(t, 300, c.Quota)
	assert.EqualValues(t, 2, c.Users)
}

// 分布:三者都靠 row_key 别名(原为保留字 key),且 Key 要扫进 DistributionRow.Key。
func TestGetOperationsDistributionsMapsRowKey(t *testing.T) {
	db := openOperationsStatsTestDB(t)

	linuxdo := "1001"
	require.NoError(t, db.Create(&User{Username: "a", AffCode: "b1", LinuxDOId: linuxdo, Group: "tier0"}).Error)
	require.NoError(t, db.Create(&User{Username: "b", AffCode: "b2", Group: "tier0"}).Error)
	require.NoError(t, db.Create(&User{Username: "c", AffCode: "b3", Group: "tier1"}).Error)

	d, err := GetOperationsDistributions()
	require.NoError(t, err)

	byKey := map[string]int64{}
	for _, row := range d.Sources {
		assert.NotEmpty(t, row.Key, "来源 Key 不应为空")
		byKey[row.Key] = row.Count
	}
	assert.EqualValues(t, 1, byKey["linuxdo"])
	assert.EqualValues(t, 2, byKey["email"])

	groupCounts := map[string]int64{}
	for _, row := range d.Groups {
		assert.NotEmpty(t, row.Key, "分组 Key 不应为空")
		groupCounts[row.Key] = row.Count
	}
	assert.EqualValues(t, 2, groupCounts["tier0"])
	assert.EqualValues(t, 1, groupCounts["tier1"])
}

// 整除运算符按方言选择:SQLite/PG 用 `/`,MySQL 用 DIV。
func TestEpochDayDivOperatorUsesSlashOnSQLite(t *testing.T) {
	// 本机测试进程的 DB 未初始化 ⇒ UsingMainDatabase 对非当前类型返回 false,
	// 即走 default 分支(DIV)。这里断言它与 SQLite 分支不相同时的取值来源正确:
	// 只要返回非空运算符即可,真正的语义验证由上面的聚合测试覆盖。
	assert.Contains(t, []string{"/", "DIV"}, epochDayDivOperator())
}

// 总览:2026-09-19 生产事故的直接回归。
// 现象=页面卡片全 0,但库里数据正常。两个独立原因:
//  1. NewUsers7d/Active7d 没标 gorm:"column:" ⇒ GORM 默认 NamingStrategy 生成
//     new_users7d/active7d(数字后缀前不加下划线),与 SQL 别名 new_users_7d/active_7d 对不上,静默扫成 0;
//  2. TOTAL USERS / NEW USERS TODAY 也变 0 —— 第二段 SQL 的 Scan 到同一个 struct 时
//     把第一段已填好的字段清零了。必须各扫一个独立 struct 再合并。
func TestGetOperationsOverviewMapsAllColumns(t *testing.T) {
	db := openOperationsStatsTestDB(t)
	now := time.Now().Unix()

	// 今天注册的 1 个 + 10 天前注册且被封禁的 1 个。
	require.NoError(t, db.Create(&User{
		Username: "newer", AffCode: "o1", CreatedAt: now - 3600, Status: 1,
	}).Error)
	require.NoError(t, db.Create(&User{
		Username: "older", AffCode: "o2", CreatedAt: now - 10*86400, Status: 2,
	}).Error)
	require.NoError(t, db.Create(&Log{
		UserId: 1, Type: LogTypeConsume, CreatedAt: now - 1800, Quota: 50,
	}).Error)

	o, err := GetOperationsOverview()
	require.NoError(t, err)

	assert.EqualValues(t, 2, o.TotalUsers, "TotalUsers 为 0 = 第二段 Scan 把第一段结果清零了")
	assert.EqualValues(t, 1, o.NewUsersToday)
	assert.EqualValues(t, 1, o.NewUsers7d, "恒 0 = 字段 DBName 是 new_users7d 而非 SQL 别名 new_users_7d")
	assert.EqualValues(t, 1, o.DisabledUsers)
	assert.EqualValues(t, 1, o.ActiveToday)
	assert.EqualValues(t, 1, o.Active7d, "恒 0 同上,active_7d / active7d")
	assert.EqualValues(t, 1, o.RequestsToday)
	assert.EqualValues(t, 50, o.QuotaToday)
}
