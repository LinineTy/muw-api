// @muw-owned
package ipgeo

import (
	"encoding/binary"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- 测试夹具 ----

// buildTestXdb 造一个只含一段的最小 xdb（结构 3 / IPv4），
// 用来单测读取与热更新逻辑，免得测试依赖那份十几 MB 的真实数据文件。
func buildTestXdb(t *testing.T, startIP, endIP [4]byte, region string, builtAt int64) []byte {
	t.Helper()
	segStart := uint32(headerInfoLength + vectorIndexRows*vectorIndexCols*vectorIndexSize)
	segSize := uint32(segmentIndexSizeV4)
	segEnd := segStart + segSize

	buf := make([]byte, segEnd)
	binary.LittleEndian.PutUint16(buf[0:], structure3)
	binary.LittleEndian.PutUint16(buf[2:], 1) // vector index policy
	binary.LittleEndian.PutUint32(buf[4:], uint32(builtAt))
	binary.LittleEndian.PutUint32(buf[8:], segStart)
	binary.LittleEndian.PutUint32(buf[12:], segEnd)
	binary.LittleEndian.PutUint16(buf[16:], 4) // IPv4
	binary.LittleEndian.PutUint16(buf[18:], 4) // runtime ptr bytes

	idx := headerInfoLength + (int(startIP[0])*vectorIndexCols+int(startIP[1]))*vectorIndexSize
	binary.LittleEndian.PutUint32(buf[idx:], segStart)
	binary.LittleEndian.PutUint32(buf[idx+4:], segEnd)

	binary.LittleEndian.PutUint32(buf[segStart:], binary.BigEndian.Uint32(startIP[:]))
	binary.LittleEndian.PutUint32(buf[segStart+4:], binary.BigEndian.Uint32(endIP[:]))
	binary.LittleEndian.PutUint16(buf[segStart+8:], uint16(len(region)))
	binary.LittleEndian.PutUint32(buf[segStart+10:], segEnd)
	return append(buf, []byte(region)...)
}

// buildTestXdbV6 同上，但造 IPv6 数据文件（段索引 38 字节：16+16+2+4）。
func buildTestXdbV6(t *testing.T, startIP, endIP [16]byte, region string, builtAt int64) []byte {
	t.Helper()
	segStart := uint32(headerInfoLength + vectorIndexRows*vectorIndexCols*vectorIndexSize)
	segEnd := segStart + uint32(segmentIndexSizeV6)

	buf := make([]byte, segEnd)
	binary.LittleEndian.PutUint16(buf[0:], structure3)
	binary.LittleEndian.PutUint16(buf[2:], 1)
	binary.LittleEndian.PutUint32(buf[4:], uint32(builtAt))
	binary.LittleEndian.PutUint32(buf[8:], segStart)
	binary.LittleEndian.PutUint32(buf[12:], segEnd)
	binary.LittleEndian.PutUint16(buf[16:], 6) // IPv6
	binary.LittleEndian.PutUint16(buf[18:], 4)

	idx := headerInfoLength + (int(startIP[0])*vectorIndexCols+int(startIP[1]))*vectorIndexSize
	binary.LittleEndian.PutUint32(buf[idx:], segStart)
	binary.LittleEndian.PutUint32(buf[idx+4:], segEnd)

	copy(buf[segStart:], startIP[:])
	copy(buf[segStart+16:], endIP[:])
	binary.LittleEndian.PutUint16(buf[segStart+32:], uint16(len(region)))
	binary.LittleEndian.PutUint32(buf[segStart+34:], segEnd)
	return append(buf, []byte(region)...)
}

func v6Bytes(t *testing.T, ip string) [16]byte {
	t.Helper()
	parsed := net.ParseIP(ip)
	require.NotNil(t, parsed)
	var out [16]byte
	copy(out[:], parsed.To16())
	return out
}

func writeTestXdb(t *testing.T, dir, name string, content []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	require.NoError(t, os.WriteFile(path, content, 0o600))
	return path
}

// isolateState 保存/恢复包级状态，避免用例之间互相污染。
func isolateState(t *testing.T) {
	t.Helper()
	mu.Lock()
	prevCfg, prevApplied, prevLoaded := cfg, applied, loaded
	prevV4, prevV6, prevErr := v4db, v6db, lastErr
	prevCheck, prevLoad := lastCheckAt, lastLoadAt
	cfg, applied, loaded = Config{}, false, false
	v4db, v6db, lastErr = nil, nil, nil
	lastCheckAt, lastLoadAt = 0, 0
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		curV4, curV6 := v4db, v6db
		cfg, applied, loaded = prevCfg, prevApplied, prevLoaded
		v4db, v6db, lastErr = prevV4, prevV6, prevErr
		lastCheckAt, lastLoadAt = prevCheck, prevLoad
		mu.Unlock()
		_ = curV4.Close()
		_ = curV6.Close()
	})
}

// ---- 基础函数 ----

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

func TestLookupSyntheticV4Xdb(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	path := writeTestXdb(t, dir, "v4.xdb",
		buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|测试省|测试市|测试ISP", 1700000000))

	Apply(Config{Enabled: true, URLv4: "http://127.0.0.1:9/unused", URLv6: "http://127.0.0.1:9/unused", PathV4: path, PathV6: filepath.Join(dir, "v6.xdb")})

	assert.Equal(t, "中国 测试省 测试市 测试ISP", Lookup("1.2.3.4"))
	assert.Equal(t, "中国 测试省 测试市 测试ISP", Lookup("1.2.3.255"))
	assert.Equal(t, "", Lookup("1.2.4.1"), "段外地址不应命中")
	assert.Equal(t, "", Lookup("2001:db8::1"), "v6 库没加载时返回空")
	assert.Equal(t, "", Lookup("not-an-ip"))
	assert.Equal(t, "", Lookup(""))
}

func TestLookupSyntheticV6Xdb(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	path := writeTestXdb(t, dir, "v6.xdb",
		buildTestXdbV6(t, v6Bytes(t, "2001:db8::"), v6Bytes(t, "2001:db8::ffff"), "中国|0|测试省|测试市|测试ISP", 1700000000))

	Apply(Config{Enabled: true, PathV4: filepath.Join(dir, "v4.xdb"), PathV6: path, URLv4: "http://127.0.0.1:9/x", URLv6: "http://127.0.0.1:9/x"})

	assert.Equal(t, "中国 测试省 测试市 测试ISP", Lookup("2001:db8::1"))
	assert.Equal(t, "", Lookup("2001:db9::1"), "段外地址不应命中")
	assert.Equal(t, "", Lookup("1.2.3.4"), "v4 库没加载时返回空")
}

func TestConcurrentLookup(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	path := writeTestXdb(t, dir, "v4.xdb",
		buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|测试省|测试市|测试ISP", 1700000000))
	Apply(Config{Enabled: true, PathV4: path, PathV6: filepath.Join(dir, "v6.xdb"), URLv4: "http://127.0.0.1:9/x", URLv6: "http://127.0.0.1:9/x"})

	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if got := Lookup("1.2.3.4"); got != "中国 测试省 测试市 测试ISP" {
					t.Errorf("并发查询结果异常: %q", got)
					return
				}
			}
		}()
	}
	wg.Wait()
}

// 没配置过就不该有任何动作：不查询、不联网、不落文件。
// （2026-09-20 踩过：单元测试触发了自动下载，48MB 数据文件被写进仓库目录。）
func TestNoImplicitDownloadWithoutApply(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	t.Chdir(dir)

	assert.Equal(t, "", Lookup("1.2.3.4"), "未 Apply 时查询应为空")
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	assert.Empty(t, entries, "未配置时不应创建任何数据文件")

	st := GetStatus()
	assert.False(t, st.Enabled)
	assert.False(t, st.V4.Ready)
}

func TestApplyDisabledUnloads(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	path := writeTestXdb(t, dir, "v4.xdb",
		buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|测试省|测试市|测试ISP", 1700000000))
	Apply(Config{Enabled: true, PathV4: path, PathV6: filepath.Join(dir, "v6.xdb"), URLv4: "http://127.0.0.1:9/x", URLv6: "http://127.0.0.1:9/x"})
	require.Equal(t, "中国 测试省 测试市 测试ISP", Lookup("1.2.3.4"))

	st := Apply(Config{Enabled: false, PathV4: path, PathV6: filepath.Join(dir, "v6.xdb")})
	assert.False(t, st.Enabled)
	assert.Equal(t, "", Lookup("1.2.3.4"), "关掉开关后不再返回归属地")
}

// ---- 热更新 ----

// 核心用例：换数据文件不需要重启进程 —— 重新下载后立刻查到新数据。
func TestUpdateHotReloads(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	serveDir := t.TempDir()

	first := buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|旧省|旧市|旧ISP", 1700000000)
	second := buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|新省|新市|新ISP", 1710000000)
	writeTestXdb(t, serveDir, "v4.xdb", first)
	writeTestXdb(t, serveDir, "v6.xdb", first)

	srv := httptest.NewServer(http.FileServer(http.Dir(serveDir)))
	defer srv.Close()

	targetV4 := filepath.Join(dir, "ip2region_v4.xdb")
	targetV6 := filepath.Join(dir, "ip2region_v6.xdb")
	Apply(Config{
		Enabled: true,
		PathV4:  targetV4, PathV6: targetV6,
		URLv4: srv.URL + "/v4.xdb", URLv6: srv.URL + "/v6.xdb",
	})

	st, err := Update("v4")
	require.NoError(t, err)
	assert.True(t, st.V4.Ready)
	assert.Equal(t, int64(1700000000), st.V4.BuiltAt, "状态里应带出数据构建时间")
	assert.Equal(t, "中国 旧省 旧市 旧ISP", Lookup("1.2.3.4"))
	assert.FileExists(t, targetV4)
	assert.NoFileExists(t, targetV4+".download", "临时文件不应留下")

	// 上游换了一份新数据 → 再点一次更新 → 进程内立刻生效
	writeTestXdb(t, serveDir, "v4.xdb", second)
	st, err = Update("v4")
	require.NoError(t, err)
	assert.Equal(t, int64(1710000000), st.V4.BuiltAt)
	assert.Equal(t, "中国 新省 新市 新ISP", Lookup("1.2.3.4"), "热更新后应立刻返回新数据")
}

// 拉失败必须保旧库：宁可显示旧数据，也不能因为网络问题变成"没有归属地"。
func TestUpdateKeepsOldDbOnFailure(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	serveDir := t.TempDir()
	writeTestXdb(t, serveDir, "v4.xdb",
		buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|旧省|旧市|旧ISP", 1700000000))
	srv := httptest.NewServer(http.FileServer(http.Dir(serveDir)))
	defer srv.Close()

	target := filepath.Join(dir, "ip2region_v4.xdb")
	Apply(Config{Enabled: true, PathV4: target, PathV6: filepath.Join(dir, "v6.xdb"), URLv4: srv.URL + "/v4.xdb", URLv6: srv.URL + "/v4.xdb"})
	_, err := Update("v4")
	require.NoError(t, err)

	// 上游给了一份垃圾（比如反代返回了 HTML 错误页）
	writeTestXdb(t, serveDir, "v4.xdb", []byte("<html>bad gateway</html>"))
	st, err := Update("v4")
	assert.Error(t, err, "校验失败应报错")
	assert.Contains(t, st.LastError, "校验失败")
	assert.Equal(t, "中国 旧省 旧市 旧ISP", Lookup("1.2.3.4"), "失败后应继续用旧库")
	assert.NoFileExists(t, target+".download")
}

// 协议对不上要拒绝：v6 槽位拿到 v4 文件会把查询搞乱。
func TestUpdateRejectsWrongProtocol(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	serveDir := t.TempDir()
	writeTestXdb(t, serveDir, "v4.xdb",
		buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|省|市|ISP", 1700000000))
	srv := httptest.NewServer(http.FileServer(http.Dir(serveDir)))
	defer srv.Close()

	Apply(Config{Enabled: true, PathV4: filepath.Join(dir, "v4.xdb"), PathV6: filepath.Join(dir, "v6.xdb"), URLv4: srv.URL + "/v4.xdb", URLv6: srv.URL + "/v4.xdb"})
	_, err := Update("v6")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "IPv6")
	assert.NoFileExists(t, filepath.Join(dir, "v6.xdb"), "校验不过的文件不应落盘")
}

// 上游没变就不该重复下载（每日检查靠这个判断）。
func TestCheckForUpdate(t *testing.T) {
	isolateState(t)
	dir := t.TempDir()
	serveDir := t.TempDir()
	writeTestXdb(t, serveDir, "v4.xdb",
		buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|省|市|ISP", 1700000000))
	writeTestXdb(t, serveDir, "v6.xdb",
		buildTestXdbV6(t, v6Bytes(t, "2001:db8::"), v6Bytes(t, "2001:db8::ffff"), "中国|0|省|市|ISP", 1700000000))
	srv := httptest.NewServer(http.FileServer(http.Dir(serveDir)))
	defer srv.Close()

	Apply(Config{Enabled: true, PathV4: filepath.Join(dir, "v4.xdb"), PathV6: filepath.Join(dir, "v6.xdb"), URLv4: srv.URL + "/v4.xdb", URLv6: srv.URL + "/v6.xdb"})

	needV4, needV6, err := CheckForUpdate()
	require.NoError(t, err)
	assert.True(t, needV4, "本地还没有库，v4 应该需要更新")
	assert.True(t, needV6, "本地还没有库，v6 应该需要更新")

	_, err = Update("all")
	require.NoError(t, err)

	// 上游文件一个字节没变（大小相同、Last-Modified 不晚于本地副本）⇒ 不该重复下载
	needV4, needV6, err = CheckForUpdate()
	require.NoError(t, err)
	assert.False(t, needV4, "上游没变时 v4 不应重复下载")
	assert.False(t, needV6, "上游没变时 v6 不应重复下载")
	assert.Equal(t, "", UpdateNeeded(needV4, needV6))

	// 上游换了一份更大的数据 ⇒ 应判定需要更新
	writeTestXdb(t, serveDir, "v4.xdb",
		buildTestXdb(t, [4]byte{1, 2, 3, 0}, [4]byte{1, 2, 3, 255}, "中国|0|省|市|ISP-更长的内容占位", 1710000000))
	needV4, needV6, err = CheckForUpdate()
	require.NoError(t, err)
	assert.True(t, needV4, "上游变了应判定需要更新")
	assert.False(t, needV6)
	assert.Equal(t, "v4", UpdateNeeded(needV4, needV6), "只该重拉变化的那一侧")
}

// ---- 真实数据文件联调（数据文件十几 MB、不进仓库，默认跳过）----

func TestLookupRealXdb(t *testing.T) {
	path := os.Getenv("IP_GEO_TEST_DB_V4")
	if path == "" {
		t.Skip("未设置 IP_GEO_TEST_DB_V4，跳过真实库联调")
	}
	isolateState(t)
	Apply(Config{Enabled: true, PathV4: path, PathV6: filepath.Join(t.TempDir(), "v6.xdb"), URLv4: "http://127.0.0.1:9/x", URLv6: "http://127.0.0.1:9/x"})

	cn := Lookup("114.114.114.114")
	t.Logf("114.114.114.114 -> %q", cn)
	assert.Contains(t, cn, "中国", "国内公共 DNS 应能查到中国")

	foreign := Lookup("8.8.8.8")
	t.Logf("8.8.8.8 -> %q", foreign)
	assert.NotEmpty(t, foreign, "国外地址应至少能查到国家")

	assert.Equal(t, "", Lookup("2001:db8::1"), "v4 库里没有 v6 数据")

	st := GetStatus()
	assert.True(t, st.V4.Ready)
	assert.Greater(t, st.V4.BuiltAt, int64(0), "状态里应有数据构建时间")
	t.Logf("数据构建于 %s，文件 %d 字节", time.Unix(st.V4.BuiltAt, 0).Format("2006-01-02"), st.V4.Size)
}

func TestLookupRealXdbV6(t *testing.T) {
	path := os.Getenv("IP_GEO_TEST_DB_V6")
	if path == "" {
		t.Skip("未设置 IP_GEO_TEST_DB_V6，跳过真实 v6 库联调")
	}
	isolateState(t)
	Apply(Config{Enabled: true, PathV4: filepath.Join(t.TempDir(), "v4.xdb"), PathV6: path, URLv4: "http://127.0.0.1:9/x", URLv6: "http://127.0.0.1:9/x"})

	// 生产日志里出现过的真实地址（联通/移动段）
	for _, ip := range []string{
		"2409:8a28:c12:c214:1deb:edb8:5dfc:538d",
		"240d:c010:64:8::104",
	} {
		got := Lookup(ip)
		t.Logf("%s -> %q", ip, got)
		assert.NotEmpty(t, got, "v6 地址应能查到归属地")
	}
	assert.Equal(t, "", Lookup("1.2.3.4"), "v6 库查 v4 地址应返回空")
}
