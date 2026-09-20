// @muw-owned
// Package ipgeo 提供离线的 IP 归属地查询。
//
// 数据源用 ip2region 的 xdb（结构 3，见 https://github.com/lionsoul2014/ip2region）：
// 免注册、有公开直链、包含 IPv4/IPv6 的国家/省市/运营商，纯数据文件，查询不出网。
//
// 为什么不用 mmdb（GeoLite2 等）：GeoLite2 / IP2Location 免费档要注册换 license key，
// 拿不到可自动化的下载源。
//
// 这里自己实现了 xdb 的读取（没有引入第三方绑定）：格式是公开的数据格式，实现百来行，
// 省掉一个跨上游同步必会冲突的依赖。读取用 ReadAt（pread），无文件偏移状态、天然并发安全。
//
// 配置不读环境变量、不读数据库：由调用方（controller）把数据库选项转成 Config 调 Apply 注入，
// 包本身保持可测。热更新（下载新库并在进程内换掉旧库）走 Update，不需要重启进程。
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

	// 默认数据源：ip2region 官方仓库的 v4/v6 数据文件（约 11MB / 37MB）
	defaultV4URL  = "https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb"
	defaultV6URL  = "https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v6.xdb"
	defaultV4File = "ip2region_v4.xdb"
	defaultV6File = "ip2region_v6.xdb"

	// 下载/探测超时；数据文件 48MB 级别，给足 5 分钟
	httpTimeout = 5 * time.Minute
)

// xdb 一个已打开的 xdb 数据文件（向量索引常驻内存，段/数据按需 pread）。
type xdb struct {
	file         *os.File
	path         string
	vectorIndex  []byte
	segmentSize  int
	ipv6         bool
	builtAt      int64 // 库头里的 createdAt：数据本身的构建时间
	bufferPoolIn sync.Pool
}

// openXdb 打开一个 xdb 文件（校验头、载入向量索引）。
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
		builtAt:     int64(binary.LittleEndian.Uint32(header[4:8])),
	}
	d.bufferPoolIn.New = func() any { return make([]byte, segSize) }
	return d, nil
}

func (d *xdb) Close() error {
	if d == nil || d.file == nil {
		return nil
	}
	return d.file.Close()
}

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

// ---- 配置 ----

// Config 运行期配置（由数据库选项转换而来）。
type Config struct {
	Enabled bool
	URLv4   string
	URLv6   string
	// PathV4 / PathV6 数据文件落盘位置；相对路径按进程工作目录解释
	// （生产容器 WORKDIR 就是 /data，即 compose 里挂出来的宿主 data 目录）。
	PathV4 string
	PathV6 string
}

// DefaultConfig 内置默认值：启用、用官方数据源、落在工作目录下。
func DefaultConfig() Config {
	return Config{
		Enabled: true,
		URLv4:   defaultV4URL,
		URLv6:   defaultV6URL,
		PathV4:  defaultV4File,
		PathV6:  defaultV6File,
	}
}

func (c Config) withDefaults() Config {
	d := DefaultConfig()
	if strings.TrimSpace(c.URLv4) == "" {
		c.URLv4 = d.URLv4
	}
	if strings.TrimSpace(c.URLv6) == "" {
		c.URLv6 = d.URLv6
	}
	if strings.TrimSpace(c.PathV4) == "" {
		c.PathV4 = d.PathV4
	}
	if strings.TrimSpace(c.PathV6) == "" {
		c.PathV6 = d.PathV6
	}
	return c
}

// ---- 进程级状态 ----

var (
	// mu 保护下面所有状态：Lookup 全程持读锁，热更新持写锁，
	// 保证换库瞬间不会有请求用到已被替换/关闭的旧句柄。
	mu sync.RWMutex

	cfg         Config
	applied     bool
	loaded      bool
	v4db        *xdb
	v6db        *xdb
	lastErr     error
	lastCheckAt int64
	lastLoadAt  int64
	loading     bool
	autoOnce    sync.Once

	// updateMu 串行化更新任务（下载耗时长，多个请求同时点"立即更新"时排队而不是互相踩）
	updateMu sync.Mutex
)

// DBStatus 单个数据文件的状态（设置页展示用）。
type DBStatus struct {
	Ready     bool   `json:"ready"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	BuiltAt   int64  `json:"built_at"`   // 数据本身的构建时间（xdb 头 createdAt）
	UpdatedAt int64  `json:"updated_at"` // 文件最后写入时间（≈上次更新时间）
	Error     string `json:"error,omitempty"`
}

// Status 归属地模块整体状态。
type Status struct {
	Enabled      bool     `json:"enabled"`
	URLv4        string   `json:"url_v4"`
	URLv6        string   `json:"url_v6"`
	V4           DBStatus `json:"v4"`
	V6           DBStatus `json:"v6"`
	LastError    string   `json:"last_error,omitempty"`
	LastCheckAt  int64    `json:"last_check_at"`
	LastLoadedAt int64    `json:"last_loaded_at"`
}

// Apply 应用配置（设置页保存、启动初始化都走这里），并立刻生效：
// 启用时同步载入本地已有文件；缺文件则后台拉一次（不阻塞启动）。
func Apply(next Config) Status {
	next = next.withDefaults()

	mu.Lock()
	cfg = next
	applied = true
	needFetch := next.Enabled
	if next.Enabled {
		replaceDBLocked(false, loadIfExists(next.PathV4, false))
		replaceDBLocked(true, loadIfExists(next.PathV6, false))
		// 两个文件都在就没必要联网；缺哪个补哪个
		needFetch = v4db == nil || v6db == nil
	} else {
		replaceDBLocked(false, nil)
		replaceDBLocked(true, nil)
	}
	st := statusLocked()
	mu.Unlock()

	if needFetch {
		go func() {
			if _, err := Update(""); err != nil {
				log.Printf("[ipgeo] 归属地库拉取失败（继续用本地旧库或空库）：%v", err)
			}
		}()
	}
	logStatus(st)
	return st
}

// ApplyDefault 用内置默认配置初始化（启动时若数据库没有相关选项）。
func ApplyDefault() Status { return Apply(DefaultConfig()) }

// loadIfExists 文件存在就打开，不存在返回 nil（不联网、不报错）。
func loadIfExists(path string, logErr bool) *xdb {
	db, err := openXdb(path)
	if err != nil {
		if logErr && !os.IsNotExist(err) {
			log.Printf("[ipgeo] 打开 %s 失败：%v", path, err)
		}
		return nil
	}
	return db
}

// replaceDBLocked 换库句柄（调用方需持有写锁）。旧句柄延迟关闭：
// 已经拿到旧指针的调用方可能还在读，交给 GC 前先让它跑完——写锁保证了不会有新调用拿旧的。
func replaceDBLocked(v6 bool, next *xdb) {
	var old *xdb
	if v6 {
		old, v6db = v6db, next
	} else {
		old, v4db = v4db, next
	}
	if old != nil && old != next {
		go func() {
			time.Sleep(2 * time.Second)
			_ = old.Close()
		}()
	}
}

// fileExists 判断数据文件是否在本地。
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Size() > 0
}

func statusLocked() Status {
	st := Status{
		Enabled:      cfg.Enabled,
		URLv4:        cfg.URLv4,
		URLv6:        cfg.URLv6,
		LastCheckAt:  lastCheckAt,
		LastLoadedAt: lastLoadAt,
	}
	if lastErr != nil {
		st.LastError = lastErr.Error()
	}
	st.V4 = dbStatusLocked(v4db, cfg.PathV4)
	st.V6 = dbStatusLocked(v6db, cfg.PathV6)
	return st
}

func dbStatusLocked(db *xdb, path string) DBStatus {
	out := DBStatus{Path: path}
	if info, err := os.Stat(path); err == nil {
		out.Size = info.Size()
		out.UpdatedAt = info.ModTime().Unix()
	}
	if db != nil {
		out.Ready = true
		out.BuiltAt = db.builtAt
	} else if _, err := os.Stat(path); err == nil {
		out.Error = "文件存在但无法解析（可能不完整），建议重新更新"
	}
	return out
}

// GetStatus 返回当前状态（设置页展示）。
func GetStatus() Status {
	mu.RLock()
	defer mu.RUnlock()
	return statusLocked()
}

func logStatus(st Status) {
	if !st.Enabled {
		log.Printf("[ipgeo] 归属地查询已关闭")
		return
	}
	log.Printf("[ipgeo] 归属地库：v4=%v(构建 %s) v6=%v(构建 %s)",
		st.V4.Ready, formatBuiltAt(st.V4.BuiltAt), st.V6.Ready, formatBuiltAt(st.V6.BuiltAt))
}

func formatBuiltAt(ts int64) string {
	if ts <= 0 {
		return "-"
	}
	return time.Unix(ts, 0).Format("2006-01-02")
}

// Update 拉取并热加载归属地库。scope：
//
//	""/"missing"  只补缺失的一侧（手动"立即更新"、库存缺失时的自动补齐都用它）
//	"all"         两侧都重新拉（每日检查发现上游有新版时用）
//	"v4"/"v6"     只拉指定一侧
//
// 分两阶段：下载/校验不持锁（几十 MB，不能让查询等它），只有"改名 + 换句柄"持写锁。
// 所以更新期间查询照常可用，换的一瞬间才是原子的。
func Update(scope string) (Status, error) {
	// 同一时刻只允许一个更新任务（避免多个请求同时写同一个临时文件）。
	// 拿不到锁就立刻告知"正在更新中"，不让管理员对着转圈等几分钟。
	if !updateMu.TryLock() {
		mu.Lock()
		st := statusLocked()
		mu.Unlock()
		return st, fmt.Errorf("已有更新任务正在进行中，请稍候")
	}
	defer updateMu.Unlock()

	// 1) 决定要拉哪些（短暂持锁）
	mu.RLock()
	c, ok := cfg, applied
	v4, v6 := v4db, v6db
	mu.RUnlock()
	if !ok {
		c = DefaultConfig()
	}
	if !c.Enabled {
		mu.Lock()
		lastErr = fmt.Errorf("归属地查询已关闭")
		st := statusLocked()
		mu.Unlock()
		return st, lastErr
	}
	doV4, doV6 := false, false
	switch scope {
	case "v4":
		doV4 = true
	case "v6":
		doV6 = true
	case "all":
		doV4, doV6 = true, true
	default:
		// 句柄没了、或磁盘上的文件没了，都算"缺"
		doV4 = v4 == nil || !fileExists(c.PathV4)
		doV6 = v6 == nil || !fileExists(c.PathV6)
	}
	if !doV4 && !doV6 {
		mu.Lock()
		lastCheckAt = time.Now().Unix()
		lastErr = nil
		st := statusLocked()
		mu.Unlock()
		return st, nil
	}

	// 2) 下载 + 校验（不持锁）
	type task struct {
		tmp  string
		path string
		v6   bool
	}
	var tasks []task
	var errs []string
	if doV4 {
		tmp, err := fetchAndValidate(c.URLv4, c.PathV4, false)
		if err != nil {
			errs = append(errs, "IPv4: "+err.Error())
		} else {
			tasks = append(tasks, task{tmp: tmp, path: c.PathV4, v6: false})
		}
	}
	if doV6 {
		tmp, err := fetchAndValidate(c.URLv6, c.PathV6, true)
		if err != nil {
			errs = append(errs, "IPv6: "+err.Error())
		} else {
			tasks = append(tasks, task{tmp: tmp, path: c.PathV6, v6: true})
		}
	}

	// 3) 落盘 + 换句柄（持写锁，快）
	mu.Lock()
	for _, tk := range tasks {
		if err := commitFetchedLocked(tk.tmp, tk.path, tk.v6); err != nil {
			errs = append(errs, err.Error())
		}
	}
	lastCheckAt = time.Now().Unix()
	if len(errs) > 0 {
		lastErr = fmt.Errorf("%s", strings.Join(errs, "；"))
	} else {
		lastErr = nil
		lastLoadAt = time.Now().Unix()
	}
	st := statusLocked()
	mu.Unlock()

	if lastErr != nil {
		log.Printf("[ipgeo] 归属地库更新失败（继续用现有库）：%v", lastErr)
	} else if len(tasks) > 0 {
		logStatus(st)
	}
	return st, lastErr
}

// fetchAndValidate 下载到 `<path>.download` 并校验（结构版本、IP 协议），
// 返回临时文件路径；**不持锁、不动现有库**。失败时清掉临时文件。
func fetchAndValidate(url, path string, ipv6 bool) (string, error) {
	url = strings.TrimSpace(url)
	if url == "" {
		return "", fmt.Errorf("未配置数据源地址")
	}
	tmp := path + ".download"
	if err := download(tmp, url); err != nil {
		return "", err
	}
	probe, err := openXdb(tmp)
	if err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("文件校验失败: %w", err)
	}
	wrongProtocol := probe.ipv6 != ipv6
	_ = probe.Close()
	if wrongProtocol {
		_ = os.Remove(tmp)
		want := "IPv4"
		if ipv6 {
			want = "IPv6"
		}
		return "", fmt.Errorf("数据源给的不是 %s 数据文件", want)
	}
	return tmp, nil
}

// commitFetchedLocked 原子落盘并换库句柄（调用方持写锁）。
// 任何一步失败都不动现有库：宁可显示旧数据，也不能因为网络问题变成没归属地。
func commitFetchedLocked(tmp, path string, ipv6 bool) error {
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("落盘失败: %w", err)
	}
	db, err := openXdb(path)
	if err != nil {
		return fmt.Errorf("重新打开失败: %w", err)
	}
	replaceDBLocked(ipv6, db)
	return nil
}

// download 下载到指定路径（先写临时后缀，成功才落）。
func download(path, url string) error {
	client := &http.Client{Timeout: httpTimeout}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return err
	}
	return nil
}

// CheckForUpdate 比上游与本地：只做 HEAD，发现本地缺失或大小/时间不同就判定该侧需要更新。
// 分别返回 v4/v6 是否需要更新（供每日自动检查与"立即更新"用，本身不下载）。
func CheckForUpdate() (needV4 bool, needV6 bool, err error) {
	mu.RLock()
	c, ok := cfg, applied
	mu.RUnlock()
	if !ok || !c.Enabled {
		return false, false, nil
	}
	var errs []string
	check := func(url, path string, need *bool) {
		if strings.TrimSpace(url) == "" {
			return
		}
		info, statErr := os.Stat(path)
		if statErr != nil {
			// 本地没有（或读不到）数据文件，直接判为需要更新，别去比对了
			*need = true
			return
		}
		size, modified, err := remoteMeta(url)
		if err != nil {
			errs = append(errs, err.Error())
			return
		}
		if (size > 0 && size != info.Size()) || (modified > 0 && modified > info.ModTime().Unix()) {
			*need = true
		}
	}
	check(c.URLv4, c.PathV4, &needV4)
	check(c.URLv6, c.PathV6, &needV6)
	if len(errs) > 0 {
		return needV4, needV6, fmt.Errorf("%s", strings.Join(errs, "；"))
	}
	return needV4, needV6, nil
}

// UpdateNeeded 把"哪几侧需要更新"转成 Update 的 scope 参数；都不需要时返回 ""。
func UpdateNeeded(needV4, needV6 bool) string {
	switch {
	case needV4 && needV6:
		return "all"
	case needV4:
		return "v4"
	case needV6:
		return "v6"
	default:
		return ""
	}
}

// remoteMeta 用 HEAD 拿上游文件大小与 Last-Modified。
func remoteMeta(url string) (size int64, modified int64, err error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest(http.MethodHead, url, nil)
	if err != nil {
		return 0, 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("探测 %s: HTTP %d", url, resp.StatusCode)
	}
	if lm := resp.Header.Get("Last-Modified"); lm != "" {
		if t, perr := http.ParseTime(lm); perr == nil {
			modified = t.Unix()
		}
	}
	return resp.ContentLength, modified, nil
}

// StartAutoCheck 每 interval 检查一次上游是否有新数据，有就自动热更新。
// 首次检查：库里还缺文件就 1 分钟后立刻补，否则等一个 interval（避开启动高峰）。
func StartAutoCheck(interval time.Duration) {
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	autoOnce.Do(func() {
		go func() {
			mu.RLock()
			missing := applied && cfg.Enabled && (v4db == nil || v6db == nil)
			mu.RUnlock()
			first := interval
			if missing {
				first = time.Minute
			}
			timer := time.NewTimer(first)
			defer timer.Stop()
			for {
				<-timer.C
				runAutoCheck()
				timer.Reset(interval)
			}
		}()
	})
}

func runAutoCheck() {
	needV4, needV6, err := CheckForUpdate()
	if err != nil {
		log.Printf("[ipgeo] 检查归属地库更新出错：%v", err)
	}
	scope := UpdateNeeded(needV4, needV6)
	if scope == "" {
		return
	}
	if _, err := Update(scope); err != nil {
		log.Printf("[ipgeo] 自动更新归属地库失败：%v", err)
	}
}

// Lookup 查一个 IP 的归属地（形如 "中国 浙江省 杭州市 移动"）。
// 未配置、未启用、库未就绪、IP 非法、未命中都返回空串——调用方按"没有归属信息"展示。
func Lookup(ip string) string {
	if strings.TrimSpace(ip) == "" {
		return ""
	}
	mu.RLock()
	defer mu.RUnlock()
	if !applied || !cfg.Enabled {
		return ""
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ""
	}
	db := v4db
	if parsed.To4() == nil {
		db = v6db
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
