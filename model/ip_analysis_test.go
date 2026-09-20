// @muw-owned
package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func openIpAnalysisTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &Log{}))
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
	return db
}

// GetIpAnalysisTrend 的 ip_version 过滤子句里含 `LIKE '%:%'`。
// 教训（2026-09-19 生产 1064）：该子句若被 fmt.Sprintf 当成格式串解析，
// `%` 会变成 `%!:(MISSING)` 原样拼进 SQL —— 语法错误且只在这个筛选条件下复现，
// 「全部 IP」路径完全正常，所以本地/接口自测极易漏过。
func TestGetIpAnalysisTrendAppliesIpVersionFilter(t *testing.T) {
	db := openIpAnalysisTestDB(t)
	now := time.Now().Unix()

	for _, s := range []struct {
		userId int
		ip     string
	}{
		{1, "203.0.113.1"},
		{1, "203.0.113.2"},
		{1, "2001:db8::1"},
		{2, "2001:db8::2"},
	} {
		require.NoError(t, db.Create(&Log{
			UserId:    s.userId,
			Type:      LogTypeConsume,
			CreatedAt: now - 600,
			Quota:     1,
			Ip:        s.ip,
		}).Error)
	}

	for _, tc := range []struct {
		version string
		want    int64
	}{
		{"v4", 2},
		{"v6", 2},
		{"all", 4},
		{"", 4},
	} {
		rows, err := GetIpAnalysisTrend(7, 0, tc.version, false)
		require.NoErrorf(t, err, "ip_version=%q 的趋势查询应能执行", tc.version)
		var got int64
		for _, r := range rows {
			got += r.Ips
		}
		assert.Equalf(t, tc.want, got, "ip_version=%q 的独立 IP 数", tc.version)
	}
}

// ---- IPv6 /64 归并（merge_v6 开关）----

func TestIpMergeKey(t *testing.T) {
	for _, tc := range []struct {
		name    string
		ip      string
		mergeV6 bool
		want    string
	}{
		{"两个同 /64 的地址归到同一个键", "2409:8a28:c12:c214:1deb:edb8:5dfc:538d", true, "2409:8a28:c12:c214::/64"},
		{"压缩写法同样归并", "240d:c010:64:8::104", true, "240d:c010:64:8::/64"},
		{"IPv4 不归并", "203.0.113.5", true, "203.0.113.5"},
		{"4-in-6 映射不归并（否则全落进 ::/64）", "::ffff:1.2.3.4", true, "::ffff:1.2.3.4"},
		{"开关关闭时原样返回", "2409:8a28:c12:c214:1deb:edb8:5dfc:538d", false, "2409:8a28:c12:c214:1deb:edb8:5dfc:538d"},
		{"非法地址原样返回", "not-an-ip", true, "not-an-ip"},
		{"空值原样返回", "", true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ipMergeKey(tc.ip, tc.mergeV6))
		})
	}
}

func TestIpMergeKeyFromLabel(t *testing.T) {
	// 前端在归并模式下把 "…::/64" 标签原样回传（点查看查明细）
	assert.Equal(t, "2409:8a28:c12:c214::/64",
		ipMergeKeyFromLabel("2409:8a28:c12:c214::/64"))
	// 非规范写法也要收敛到同一个键
	assert.Equal(t, "2409:8a28:c12:c214::/64",
		ipMergeKeyFromLabel("2409:8a28:c12:c214:0:0:0:0/64"))
	// 具体地址：按 /64 求键
	assert.Equal(t, "2409:8a28:c12:c214::/64",
		ipMergeKeyFromLabel("2409:8a28:c12:c214:1deb:edb8:5dfc:538d"))
}

// seedIpLogs 造 n 条该 IP 的消费日志（时间递增 60s）。
func seedIpLogs(t *testing.T, db *gorm.DB, userId int, ip string, n int, firstSeen int64) {
	t.Helper()
	for i := 0; i < n; i++ {
		require.NoError(t, db.Create(&Log{
			UserId:    userId,
			Type:      LogTypeConsume,
			CreatedAt: firstSeen + int64(i)*60,
			Quota:     1,
			Ip:        ip,
		}).Error)
	}
}

// 归并开关的核心价值：一个 /64 下的轮换地址不该算成"10 个独立 IP"。
func TestGetUserIpRankMergesV6By64(t *testing.T) {
	db := openIpAnalysisTestDB(t)
	require.NoError(t, db.Create(&User{Id: 7, Username: "u7", DisplayName: "U7", Status: 1, AffCode: "aff7"}).Error)
	now := time.Now().Unix()

	// 同一个 /64 下的 8 个轮换地址 + 1 个别的 /64 + 1 个 IPv4
	for i := 0; i < 8; i++ {
		seedIpLogs(t, db, 7, fmt.Sprintf("2409:8a28:c12:c214::%x", i+1), 1, int64(i)*60+now-1200)
	}
	seedIpLogs(t, db, 7, "2409:8a28:c12:c215::1", 1, now-600)
	seedIpLogs(t, db, 7, "203.0.113.9", 1, now-300)

	rows, total, err := GetUserIpRank(30, 1, "all", false, 1, 20)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	assert.EqualValues(t, 10, rows[0].IpCount, "关闭归并：10 个地址就是 10 个独立 IP")

	rows, total, err = GetUserIpRank(30, 1, "all", true, 1, 20)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	assert.EqualValues(t, 3, rows[0].IpCount, "开归并：/64 前缀 + 另一个前缀 + IPv4 = 3")
	assert.Equal(t, "u7", rows[0].Username, "内存聚合路径同样要补上用户名")
	assert.EqualValues(t, 10, rows[0].RequestCount)
}

func TestGetUserIpDetailMergesV6By64(t *testing.T) {
	db := openIpAnalysisTestDB(t)
	now := time.Now().Unix()

	seedIpLogs(t, db, 1, "2409:8a28:c12:c214:1deb:edb8:5dfc:538d", 3, now-9000)
	seedIpLogs(t, db, 1, "2409:8a28:c12:c214:f10a:3e19:6f29:d663", 2, now-5000)
	seedIpLogs(t, db, 1, "112.11.7.47", 4, now-2000)

	plain, err := GetUserIpDetail(1, 30, "all", false)
	require.NoError(t, err)
	assert.Len(t, plain, 3)

	merged, err := GetUserIpDetail(1, 30, "all", true)
	require.NoError(t, err)
	require.Len(t, merged, 2)
	// 按请求数降序：112.11.7.47(4) 之后是 3+2=5 的 /64 —— 归并后它最大
	assert.Equal(t, "2409:8a28:c12:c214::/64", merged[0].Ip)
	assert.EqualValues(t, 5, merged[0].RequestCount)
	assert.Equal(t, now-9000, merged[0].FirstSeen, "合并后取最早出现的时刻")
	assert.Equal(t, now-5000+60, merged[0].LastSeen, "合并后取最后一次出现的时刻（两组里更晚的那个）")
	assert.Equal(t, "112.11.7.47", merged[1].Ip)
	assert.EqualValues(t, 4, merged[1].RequestCount)
}

func TestGetIpAnalysisOverviewMergedCounts(t *testing.T) {
	db := openIpAnalysisTestDB(t)
	now := time.Now().Unix()

	// 一个用户在同一个 /64 下轮换 3 个地址
	for i := 0; i < 3; i++ {
		seedIpLogs(t, db, 1, fmt.Sprintf("2409:8a28:c12:c214::%x", i+1), 1, int64(i)*60+now-1200)
	}
	seedIpLogs(t, db, 2, "203.0.113.9", 1, now-600)

	ov, err := GetIpAnalysisOverview(30, "all", false)
	require.NoError(t, err)
	assert.EqualValues(t, 4, ov.TotalIps)
	assert.EqualValues(t, 2, ov.TotalUsers)

	ov, err = GetIpAnalysisOverview(30, "all", true)
	require.NoError(t, err)
	assert.EqualValues(t, 2, ov.TotalIps, "3 个同 /64 地址 + 1 个 IPv4 = 2 个来源")
	assert.InDelta(t, 1.0, ov.AvgIpsPerUser, 0.001)
	// 同一个人在同一个 /64 下轮换多个地址，不算"共享来源"（按 (key, user) 去重）
	assert.EqualValues(t, 0, ov.SharedIps, "同一用户的多地址不能算共享")
	// 分桶：用户 1 从 3 个 IP 落到 1 个，落在 "1" 档
	var bucket1 int64
	for _, b := range ov.Distribution {
		if b.Bucket == "1" {
			bucket1 = b.Users
		}
	}
	assert.EqualValues(t, 2, bucket1)
}

func TestGetIpAnalysisTrendMergesV6By64(t *testing.T) {
	db := openIpAnalysisTestDB(t)
	now := time.Now().Unix()

	for i := 0; i < 3; i++ {
		seedIpLogs(t, db, 1, fmt.Sprintf("2409:8a28:c12:c214::%x", i+1), 1, now-600)
	}
	seedIpLogs(t, db, 1, "203.0.113.9", 1, now-300)

	rows, err := GetIpAnalysisTrend(7, 0, "all", false)
	require.NoError(t, err)
	var plain int64
	for _, r := range rows {
		plain += r.Ips
	}
	assert.EqualValues(t, 4, plain)

	rows, err = GetIpAnalysisTrend(7, 0, "all", true)
	require.NoError(t, err)
	var merged int64
	for _, r := range rows {
		merged += r.Ips
	}
	assert.EqualValues(t, 2, merged, "同 /64 的 3 个地址当天只算一个来源")
}

func TestGetIpDetailMergedAcceptsPrefixLabel(t *testing.T) {
	db := openIpAnalysisTestDB(t)
	require.NoError(t, db.Create(&User{Id: 1, Username: "root", DisplayName: "Root User", Status: 1, AffCode: "aff1"}).Error)
	require.NoError(t, db.Create(&User{Id: 2, Username: "other", DisplayName: "", Status: 1, AffCode: "aff2"}).Error)
	now := time.Now().Unix()

	seedIpLogs(t, db, 1, "2409:8a28:c12:c214:1deb:edb8:5dfc:538d", 2, now-900)
	seedIpLogs(t, db, 2, "2409:8a28:c12:c214:f10a:3e19:6f29:d663", 3, now-600)
	seedIpLogs(t, db, 2, "2409:8a28:c12:c215::9", 1, now-300)

	rows, err := GetIpDetail("2409:8a28:c12:c214::/64", 30, true)
	require.NoError(t, err)
	require.Len(t, rows, 2, "同一 /64 下的两个账号都要列出来")
	assert.Equal(t, 2, rows[0].UserId)
	assert.EqualValues(t, 3, rows[0].RequestCount)
	assert.Equal(t, "other", rows[0].Username)
	assert.Equal(t, 1, rows[1].UserId)
	assert.EqualValues(t, 2, rows[1].RequestCount)
	assert.Equal(t, "root", rows[1].Username)
}
