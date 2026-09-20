// @muw-owned
// Package ipgeo 提供离线的 IP 归属地查询。
//
// 数据源用 ip2region 的 xdb（v2/v3 结构，见 https://github.com/lionsoul2014/ip2region）：
// 免注册、可直接下载、包含 IPv4/IPv6 的国家/省市/运营商，且是纯数据文件，查询不出网。
//
// 为什么不用 mmdb（GeoLite2 等）：GeoLite2 / IP2Location 免费档需要注册换 license key，
// 我们拿不到可自动化的下载源；xdb 有公开直链，容器起来自己拉一次就能用。
//
// 这里自己实现了 xdb 的读取（没有引入第三方绑定）：格式本身是公开的数据格式，
// 实现只有百来行，省掉一个跨上游同步时必然冲突的依赖。读取路径用 ReadAt（pread），
// 无文件偏移状态，天然并发安全。
package ipgeo

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	headerInfoLength = 256
	vectorIndexRows  = 256
	vectorIndexCols  = 256
	vectorIndexSize  = 8 // 每格两个 uint32：段索引起止指针
	// 段索引项：IPv4 = 4+4+2+4，IPv6 = 16+16+2+4
	segmentIndexSizeV4 = 14
	segmentIndexSizeV6 = 38
	// 单条归属地字符串的长度上限（正常几十字节，防脏数据导致大块读）
	maxRegionLength = 512

	structure3 = 3

	downloadTTL = 5 * time.Minute
)

// xdb 一个已打开的 xdb 数据文件（向量索引常驻内存，段/数据按需 pread）。
type xdb struct {
	file         *os.File
	path         string
	vectorIndex  []byte
	segmentSize  int
	ipv6         bool
	bufferPoolIn sync.Pool
}

// Open 打开一个 xdb 文件（读取并校验头、载入向量索引）。
func openXdb(path string) (*xdb, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	header := make([]byte, headerInfoLength)
	if _, err := io.ReadFull(f, header); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("读 xdb 头失败: %w", err)
	}
	version := binary.LittleEndian.Uint16(header[0:2])
	if version != structure3 {
		_ = f.Close()
		return nil, fmt.Errorf("不支持的 xdb 结构版本 %d（只支持 3）", version)
	}
	ipVersion := binary.LittleEndian.Uint16(header[16:18])
	ipv6 := ipVersion == 6
	segSize := segmentIndexSizeV4
	if ipv6 {
		segSize = segmentIndexSizeV6
	}

	vectorIndex := make([]byte, vectorIndexRows*vectorIndexCols*vectorIndexSize)
	if _, err := f.ReadAt(vectorIndex, headerInfoLength); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("读 xdb 向量索引失败: %w", err)
	}

	d := &xdb{
		file:        f,
		path:        path,
		vectorIndex: vectorIndex,
		segmentSize: segSize,
		ipv6:        ipv6,
	}
	d.bufferPoolIn.New = func() any { return make([]byte, segSize) }
	return d, nil
}

func (d *xdb) Close() error { return d.file.Close() }

// Lookup 查一个 IP 的归属地；未命中返回空串。
func (d *xdb) Lookup(ip net.IP) (string, error) {
	var raw []byte
	if d.ipv6 {
		raw = ip.To16()
		if raw == nil || ip.To4() != nil {
			return "", nil // 用 v6 库查 v4 地址没有意义
		}
	} else {
		raw = ip.To4()
		if raw == nil {
			return "", nil
		}
	}
	if len(raw) < 2 {
		return "", nil
	}

	// 向量索引：按前两个字节定位段索引范围
	idx := int(raw[0])*vectorIndexCols*vectorIndexSize + int(raw[1])*vectorIndexSize
	startPtr := binary.LittleEndian.Uint32(d.vectorIndex[idx:])
	endPtr := binary.LittleEndian.Uint32(d.vectorIndex[idx+4:])
	if startPtr == 0 || endPtr == 0 || endPtr < startPtr {
		return "", nil
	}

	buff := d.bufferPoolIn.Get().([]byte)
	defer d.bufferPoolIn.Put(buff)

	segCount := int((endPtr - startPtr) / uint32(d.segmentSize))
	low, high := 0, segCount
	for low <= high {
		mid := (low + high) >> 1
		offset := int64(startPtr) + int64(mid*d.segmentSize)
		if _, err := d.file.ReadAt(buff, offset); err != nil {
			return "", fmt.Errorf("读段索引失败: %w", err)
		}
		cmpStart := d.compare(raw, buff[:len(raw)])
		if cmpStart < 0 {
			high = mid - 1
			continue
		}
		cmpEnd := d.compare(raw, buff[len(raw):2*len(raw)])
		if cmpEnd > 0 {
			low = mid + 1
			continue
		}
		dataLen := int(binary.LittleEndian.Uint16(buff[2*len(raw):]))
		dataPtr := binary.LittleEndian.Uint32(buff[2*len(raw)+2:])
		if dataLen <= 0 || dataLen > maxRegionLength {
			return "", nil
		}
		region := make([]byte, dataLen)
		if _, err := d.file.ReadAt(region, int64(dataPtr)); err != nil {
			return "", fmt.Errorf("读归属地数据失败: %w", err)
		}
		return string(region), nil
	}
	return "", nil
}

// compare 把索引里的地址与查询地址按数值比较。
// IPv4 段在文件里是小端 u32；IPv6 段是大端 16 字节 —— 这里统一成整数/字节序后比较，
// 免得踩字节序的坑。
func (d *xdb) compare(ip []byte, indexBuf []byte) int {
	if d.ipv6 {
		return bytes.Compare(ip, indexBuf)
	}
	return compareUint32(binary.BigEndian.Uint32(ip), binary.LittleEndian.Uint32(indexBuf))
}

func compareUint32(a, b uint32) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}

// ---- 进程级单例 ----

var (
	mu      sync.RWMutex
	v4db    *xdb
	v6db    *xdb
	loaded  bool
	loadErr error
	once    sync.Once
)

// config 从环境变量取配置（每次调用都读，方便测试里改）：
//
//	IP_GEO_DISABLE=1          整体关闭（不加载、不下载，查询一律返回空）
//	IP_GEO_DB_PATH_V4/_V6     本地文件路径，默认 ./ip2region_v4.xdb 等
//	IP_GEO_DB_URL_V4/_V6      文件缺失时的下载源（显式配置才下载，见下）；
//	                          不配也行——把 xdb 文件直接放到上面的路径即可
//
// ⚠️ 下载源必须显式配置，没有默认值：默认带 URL 会让"任何一次 Lookup"都可能去网上拉
// 十几 MB 文件，落盘位置还取决于进程的工作目录（跑单元测试时就把数据文件写进了
// 仓库目录，2026-09-20 实际踩到）。生产用 IP_GEO_DB_URL_V4/_V6 指向
// `https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb`
// 与 ..._v6.xdb 即可（v4 约 11MB、v6 约 37MB，容器起来拉一次，之后纯本地查询）。
func dbPath(v6 bool) string {
	key := "IP_GEO_DB_PATH_V4"
	name := "ip2region_v4.xdb"
	if v6 {
		key = "IP_GEO_DB_PATH_V6"
		name = "ip2region_v6.xdb"
	}
	if p := strings.TrimSpace(os.Getenv(key)); p != "" {
		return p
	}
	// 相对进程工作目录，不套 data/ 子目录：生产容器 WORKDIR 就是 /data
	// （官方/1Panel compose 的 `./data:/data` 挂载点），套一层会落到 /data/data/。
	return name
}

func dbURL(v6 bool) string {
	if v6 {
		return strings.TrimSpace(os.Getenv("IP_GEO_DB_URL_V6"))
	}
	return strings.TrimSpace(os.Getenv("IP_GEO_DB_URL_V4"))
}

func disabled() bool {
	return strings.TrimSpace(os.Getenv("IP_GEO_DISABLE")) == "1"
}

// Start 启动时预热：文件已在本地就同步载入（查到就有值，避免首屏查不到），
// 缺文件（要下载十几 MB）才丢到后台，避免拖慢启动。
func Start() {
	once.Do(func() {
		if disabled() {
			loaded = true
			return
		}
		missing := false
		for _, v6 := range []bool{false, true} {
			if _, err := os.Stat(dbPath(v6)); err != nil && dbURL(v6) != "" {
				missing = true
			}
		}
		if missing {
			log.Printf("[ipgeo] 归属地库缺失，后台下载中（期间查询返回空）")
			loadAsync()
			return
		}
		v4, v6, err := load()
		mu.Lock()
		v4db, v6db, loadErr, loaded = v4, v6, err, true
		mu.Unlock()
		if err != nil {
			log.Printf("[ipgeo] 归属地库不可用（查询返回空）：%v", err)
			return
		}
		log.Printf("[ipgeo] 归属地库就绪：v4=%v v6=%v", v4 != nil, v6 != nil)
	})
}

// loadAsync 后台载入（首次部署需要下载数据文件时走这条路）。
func loadAsync() {
	go func() {
		v4, v6, err := load()
		mu.Lock()
		defer mu.Unlock()
		v4db, v6db, loadErr, loaded = v4, v6, err, true
		if err != nil {
			log.Printf("[ipgeo] 归属地库不可用（查询返回空）：%v", err)
			return
		}
		log.Printf("[ipgeo] 归属地库就绪：v4=%v v6=%v", v4 != nil, v6 != nil)
	}()
}

// ensureLoaded 首次查询时载入数据库；失败只记一次日志，之后一律返回空（不重试、不阻塞请求）。
func ensureLoaded() {
	once.Do(func() {
		if disabled() {
			loaded = true
			return
		}
		// 兜底路径（Start 没被调用时）：同样丢后台，不能卡住第一个请求
		loadAsync()
	})
}

func load() (*xdb, *xdb, error) {
	var v4, v6 *xdb
	var errs []string
	for _, target := range []struct {
		v6   bool
		slot **xdb
	}{{false, &v4}, {true, &v6}} {
		path := dbPath(target.v6)
		if _, statErr := os.Stat(path); statErr != nil {
			url := dbURL(target.v6)
			if url == "" {
				errs = append(errs, fmt.Sprintf("%s 不存在且未配置下载源", path))
				continue
			}
			if dlErr := download(path, url); dlErr != nil {
				errs = append(errs, fmt.Sprintf("下载 %s 失败: %v", filepath.Base(path), dlErr))
				continue
			}
		}
		db, openErr := openXdb(path)
		if openErr != nil {
			errs = append(errs, fmt.Sprintf("打开 %s 失败: %v", path, openErr))
			continue
		}
		*target.slot = db
	}
	if len(errs) > 0 {
		return v4, v6, fmt.Errorf("%s", strings.Join(errs, "；"))
	}
	return v4, v6, nil
}

// download 下载缺失的 xdb 到本地（先写临时文件再原子改名，失败不留下半截文件）。
func download(path, url string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	client := &http.Client{Timeout: downloadTTL}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// Lookup 查一个 IP 的归属地（形如 "中国 浙江省 杭州市 电信"）。
// 库未就绪、IP 非法、未命中都返回空串——调用方按"没有归属信息"展示即可。
func Lookup(ip string) string {
	if ip == "" {
		return ""
	}
	ensureLoaded()
	return lookupLoaded(ip)
}

// lookupLoaded 用已载入的库查询（不触发加载），便于单测直接塞库。
func lookupLoaded(ip string) string {
	mu.RLock()
	v4, v6 := v4db, v6db
	mu.RUnlock()
	if v4 == nil && v6 == nil {
		return ""
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ""
	}
	db := v4
	if parsed.To4() == nil {
		db = v6
	}
	if db == nil {
		return ""
	}
	region, err := db.Lookup(parsed)
	if err != nil {
		return ""
	}
	return FormatRegion(region)
}

// FormatRegion 把 xdb 的原始归属地串（`国家|区域|省份|城市|ISP`，缺项为 0）
// 整理成可读文本；全是占位符时返回空串。
func FormatRegion(region string) string {
	region = strings.TrimSpace(region)
	if region == "" {
		return ""
	}
	parts := strings.Split(region, "|")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" || p == "0" {
			continue
		}
		out = append(out, p)
	}
	return strings.Join(out, " ")
}
