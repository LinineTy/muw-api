// @muw-owned
package model

import (
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
		rows, err := GetIpAnalysisTrend(7, 0, tc.version)
		require.NoErrorf(t, err, "ip_version=%q 的趋势查询应能执行", tc.version)
		var got int64
		for _, r := range rows {
			got += r.Ips
		}
		assert.Equalf(t, tc.want, got, "ip_version=%q 的独立 IP 数", tc.version)
	}
}
