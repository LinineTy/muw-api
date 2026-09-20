// @muw-owned
package ipgeo

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFormatRegion(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want string
	}{
		{"中国|0|浙江省|杭州市|电信", "中国 浙江省 杭州市 电信"},
		{"美国|0|0|0|0", "美国"},
		{"0|0|0|0|0", ""},
		{"", ""},
		{" 中国 | 0 | 广东省 | 深圳市 | 移动 ", "中国 广东省 深圳市 移动"},
	} {
		assert.Equal(t, tc.want, FormatRegion(tc.in), "in=%q", tc.in)
	}
}

// buildTestXdb 造一个只含一段的最小 xdb（结构 3 / IPv4），用来单测读取逻辑，
// 免得测试依赖那份十几 MB 的真实数据文件。
func buildTestXdb(t *testing.T, startIP, endIP [4]byte, region string) string {
	t.Helper()
	segStart := uint32(headerInfoLength + vectorIndexRows*vectorIndexCols*vectorIndexSize)
	segSize := uint32(segmentIndexSizeV4)
	segEnd := segStart + segSize

	buf := make([]byte, segEnd)
	binary.LittleEndian.PutUint16(buf[0:], structure3)
	binary.LittleEndian.PutUint16(buf[2:], 1) // vector index policy
	binary.LittleEndian.PutUint32(buf[8:], segStart)
	binary.LittleEndian.PutUint32(buf[12:], segEnd)
	binary.LittleEndian.PutUint16(buf[16:], 4) // IPv4
	binary.LittleEndian.PutUint16(buf[18:], 4) // runtime ptr bytes

	// 向量索引：仅 startIP 前两个字节对应的格子指向我们这一段
	idx := headerInfoLength + (int(startIP[0])*vectorIndexCols+int(startIP[1]))*vectorIndexSize
	binary.LittleEndian.PutUint32(buf[idx:], segStart)
	binary.LittleEndian.PutUint32(buf[idx+4:], segEnd)

	// 段索引：小端 u32 的起止 IP
	binary.LittleEndian.PutUint32(buf[segStart:], binary.BigEndian.Uint32(startIP[:]))
	binary.LittleEndian.PutUint32(buf[segStart+4:], binary.BigEndian.Uint32(endIP[:]))
	binary.LittleEndian.PutUint16(buf[segStart+8:], uint16(len(region)))
	binary.LittleEndian.PutUint32(buf[segStart+10:], segEnd)
	buf = append(buf, []byte(region)...)

	path := filepath.Join(t.TempDir(), "test_v4.xdb")
	require.NoError(t, os.WriteFile(path, buf, 0o600))
	return path
}

func TestLookupSyntheticV4Xdb(t *testing.T) {
	path := buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|测试省|测试市|测试ISP")
	db, err := openXdb(path)
	require.NoError(t, err)
	defer db.Close()

	mu.Lock()
	prevV4, prevV6 := v4db, v6db
	v4db, v6db = db, nil
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		v4db, v6db = prevV4, prevV6
		mu.Unlock()
	})

	assert.Equal(t, "中国 测试省 测试市 测试ISP", lookupLoaded("1.2.3.4"))
	assert.Equal(t, "中国 测试省 测试市 测试ISP", lookupLoaded("1.2.3.255"))
	assert.Equal(t, "", lookupLoaded("1.2.4.1"), "段外地址不应命中")
	assert.Equal(t, "", lookupLoaded("2001:db8::1"), "v4 库查 v6 地址应返回空")
	assert.Equal(t, "", lookupLoaded("not-an-ip"))
	assert.Equal(t, "", lookupLoaded(""))
}

// 真实数据文件的联调测试：设置了 IP_GEO_TEST_DB_V4（指向 ip2region_v4.xdb）才跑。
// 数据文件十几 MB、不进仓库，所以默认跳过。
func TestLookupRealXdb(t *testing.T) {
	path := os.Getenv("IP_GEO_TEST_DB_V4")
	if path == "" {
		t.Skip("未设置 IP_GEO_TEST_DB_V4，跳过真实库联调")
	}
	db, err := openXdb(path)
	require.NoError(t, err)
	defer db.Close()

	mu.Lock()
	prevV4, prevV6 := v4db, v6db
	v4db, v6db = db, nil
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		v4db, v6db = prevV4, prevV6
		mu.Unlock()
	})

	cn := lookupLoaded("114.114.114.114")
	t.Logf("114.114.114.114 -> %q", cn)
	assert.Contains(t, cn, "中国", "国内公共 DNS 应能查到中国")

	foreign := lookupLoaded("8.8.8.8")
	t.Logf("8.8.8.8 -> %q", foreign)
	assert.NotEmpty(t, foreign, "国外地址应至少能查到国家")

	assert.Equal(t, "", lookupLoaded("2001:db8::1"), "v4 库里没有 v6 数据")
}

// 载体：确保并发查询安全（ReadAt 无文件偏移状态）
func TestConcurrentLookup(t *testing.T) {
	path := buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|测试省|测试市|测试ISP")
	db, err := openXdb(path)
	require.NoError(t, err)
	defer db.Close()

	mu.Lock()
	prevV4, prevV6 := v4db, v6db
	v4db, v6db = db, nil
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		v4db, v6db = prevV4, prevV6
		mu.Unlock()
	})

	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if got := lookupLoaded("1.2.3.4"); got != "中国 测试省 测试市 测试ISP" {
					t.Errorf("并发查询结果异常: %q", got)
					return
				}
			}
		}()
	}
	wg.Wait()
}

// 库不可用时（文件缺失、下载关闭）必须安静降级成空串，不能 panic、不能阻塞请求。
func TestLookupDegradesWhenDbMissing(t *testing.T) {
	mu.Lock()
	prevV4, prevV6, prevLoaded, prevErr := v4db, v6db, loaded, loadErr
	v4db, v6db, loaded, loadErr = nil, nil, true, nil
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		v4db, v6db, loaded, loadErr = prevV4, prevV6, prevLoaded, prevErr
		mu.Unlock()
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		assert.Equal(t, "", Lookup("1.2.3.4"))
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("库缺失时查询不应阻塞")
	}
}

// 真实 IPv6 库的联调测试：设置 IP_GEO_TEST_DB_V6 才跑（v6 数据 37MB，同样不进仓库）。
func TestLookupRealXdbV6(t *testing.T) {
	path := os.Getenv("IP_GEO_TEST_DB_V6")
	if path == "" {
		t.Skip("未设置 IP_GEO_TEST_DB_V6，跳过真实 v6 库联调")
	}
	db, err := openXdb(path)
	require.NoError(t, err)
	defer db.Close()

	mu.Lock()
	prevV4, prevV6 := v4db, v6db
	v4db, v6db = nil, db
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		v4db, v6db = prevV4, prevV6
		mu.Unlock()
	})

	// 生产日志里出现过的真实地址（联通/移动段）
	for _, ip := range []string{
		"2409:8a28:c12:c214:1deb:edb8:5dfc:538d",
		"240d:c010:64:8::104",
	} {
		got := lookupLoaded(ip)
		t.Logf("%s -> %q", ip, got)
		assert.NotEmpty(t, got, "v6 地址应能查到归属地")
	}
	assert.Equal(t, "", lookupLoaded("1.2.3.4"), "v6 库查 v4 地址应返回空")
}

// 回归测试：没显式配置下载源时，缺文件只能安静降级，绝不能自己上网拉、
// 更不能把数据文件写到进程工作目录里（2026-09-20 踩过：跑 model 包单测时
// 数据文件被写进了仓库 model/data/，48MB 混进 commit）。
func TestNoImplicitDownload(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "ip2region_v4.xdb")

	t.Setenv("IP_GEO_DB_PATH_V4", missing)
	t.Setenv("IP_GEO_DB_PATH_V6", filepath.Join(dir, "ip2region_v6.xdb"))
	t.Setenv("IP_GEO_DB_URL_V4", "")
	t.Setenv("IP_GEO_DB_URL_V6", "")
	t.Setenv("IP_GEO_DISABLE", "")

	mu.Lock()
	prevV4, prevV6, prevLoaded := v4db, v6db, loaded
	v4db, v6db, loaded = nil, nil, false
	mu.Unlock()
	once = sync.Once{}
	t.Cleanup(func() {
		mu.Lock()
		v4db, v6db, loaded = prevV4, prevV6, prevLoaded
		mu.Unlock()
		once = sync.Once{}
	})

	done := make(chan string, 1)
	go func() { done <- Lookup("1.2.3.4") }()
	select {
	case got := <-done:
		assert.Equal(t, "", got)
	case <-time.After(3 * time.Second):
		t.Fatal("未配置下载源时不应卡住（说明在等网络）")
	}

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	assert.Empty(t, entries, "不应自己创建任何数据文件")
}
