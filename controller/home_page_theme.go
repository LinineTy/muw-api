package controller

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// 主题系统:主题可成套覆盖营销页(/)、About、用户协议、隐私政策四页。
// 选中某来源(default/manual/导入主题)后,把对应内容原子写入 4 个公开 option
// (HomePageContent/About/legal.*),公开接口与前端渲染链路因此不用改。
const (
	homePageThemesOptionKey     = "HomePageThemes"
	homePageThemeSelectedKey    = "HomePageTheme"
	homePageManualOptionKey     = "HomePageManual"
	homePageContentOptionKey    = "HomePageContent"
	aboutOptionKey              = "About"
	legalUserAgreementOptionKey = "legal.user_agreement"
	legalPrivacyPolicyOptionKey = "legal.privacy_policy"

	defaultHomePageThemeID = "default" // 内置 React 营销页 + 各页空态
	manualHomePageThemeID  = "manual"  // 手动预设(用户手填,可编辑)

	maxHomePageThemeNameRunes  = 100
	maxHomePageThemeContentKB  = 500
	maxHomePageThemeContentLen = maxHomePageThemeContentKB * 1024
	maxHomePageThemeCount      = 50
	maxThemeZipBytes           = 2 * 1024 * 1024 // 上传 zip/文件总大小上限
	maxThemeZipTotalLen        = 2 * 1024 * 1024 // 解压后内容总大小上限
	maxThemePreviewBytes       = 200 * 1024       // zip 内预览图大小上限(base64 后存库)
	maxThemeVersionLen         = 200              // zip 内 version.txt 大小上限
)

// 并发导入/选择/删除/手动保存都是"读整库 → 计算 → 整库覆写",用包级互斥锁避免同进程并发丢更新。
var homePageThemeMu sync.Mutex

type HomePageTheme struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Content       string `json:"content"` // 营销页(home)
	About         string `json:"about,omitempty"`
	UserAgreement string `json:"user_agreement,omitempty"`
	PrivacyPolicy string `json:"privacy_policy,omitempty"`
	Preview       string `json:"preview,omitempty"` // 缩略图 base64(来自 zip 内 preview 图)
	Version       string `json:"version,omitempty"` // 版本描述(来自 zip 内 version.txt)
	CreatedAt     int64  `json:"created_at"`
}

type HomePageThemeSummary struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	CreatedAt int64    `json:"created_at"`
	Pages     []string `json:"pages"` // 非空页面的 slug(home/about/user_agreement/privacy_policy)
	Preview   string   `json:"preview,omitempty"`
	Version   string   `json:"version,omitempty"`
}

// HomePageManual 手动预设:四个页面的原文(URL/HTML/Markdown),独立于主题选择存储。
type HomePageManual struct {
	Home          string `json:"home"`
	About         string `json:"about"`
	UserAgreement string `json:"user_agreement"`
	PrivacyPolicy string `json:"privacy_policy"`
}

type SelectHomePageThemeRequest struct {
	ID string `json:"id"`
}

type UpdateHomePageManualRequest struct {
	Home          string `json:"home"`
	About         string `json:"about"`
	UserAgreement string `json:"user_agreement"`
	PrivacyPolicy string `json:"privacy_policy"`
}

// zip 内部固定页名(本功能规范):zip 文件名 = 主题名。
var themeZipPageFiles = map[string]string{
	"home.html":     "home",
	"about.html":    "about",
	"agreement.html": "user_agreement",
	"privacy.html":  "privacy_policy",
}

// ============================================================================
// 读写辅助
// ============================================================================

// readHomePageThemeLibrary 在共享读锁下读取并解析主题库,返回主题列表与当前选中 id。
// 库损坏时降级为空库(不阻断管理操作)。
func readHomePageThemeLibrary() ([]HomePageTheme, string) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[homePageThemesOptionKey]
	selected := common.OptionMap[homePageThemeSelectedKey]
	common.OptionMapRWMutex.RUnlock()

	var themes []HomePageTheme
	if raw != "" {
		if err := common.UnmarshalJsonStr(raw, &themes); err != nil {
			common.SysError("home page theme library is corrupt, reset to empty: " + err.Error())
			return []HomePageTheme{}, selected
		}
	}
	return themes, selected
}

func readHomePageManual() HomePageManual {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[homePageManualOptionKey]
	common.OptionMapRWMutex.RUnlock()
	var manual HomePageManual
	if raw != "" {
		if err := common.UnmarshalJsonStr(raw, &manual); err != nil {
			common.SysError("home page manual option is corrupt, reset to empty: " + err.Error())
		}
	}
	return manual
}

// 一次性迁移:HomePageManual 未初始化时,把现有 HomePageContent/About/legal 值迁移进去。
// 幂等——HomePageManual 已存在则跳过。
func ensureHomePageManualMigration() (HomePageManual, error) {
	common.OptionMapRWMutex.RLock()
	rawManual := common.OptionMap[homePageManualOptionKey]
	rawHome := common.OptionMap[homePageContentOptionKey]
	rawAbout := common.OptionMap[aboutOptionKey]
	rawAgreement := common.OptionMap[legalUserAgreementOptionKey]
	rawPrivacy := common.OptionMap[legalPrivacyPolicyOptionKey]
	selected := common.OptionMap[homePageThemeSelectedKey]
	common.OptionMapRWMutex.RUnlock()

	// 已初始化判定:空串或 InitOptionMap 的默认值 "{}" 都代表"从未写入手动预设",
	// 此时应执行迁移。只判断非空会被 "{}" 挡死——旧主题永远恢复不进来。
	if rawManual != "" && rawManual != "{}" {
		var manual HomePageManual
		if err := common.UnmarshalJsonStr(rawManual, &manual); err != nil {
			return HomePageManual{}, err
		}
		return manual, nil
	}

	manual := HomePageManual{Home: rawHome, About: rawAbout, UserAgreement: rawAgreement, PrivacyPolicy: rawPrivacy}
	manualJSON, err := common.Marshal(manual)
	if err != nil {
		return manual, err
	}
	values := map[string]string{homePageManualOptionKey: string(manualJSON)}
	if manual.Home != "" || manual.About != "" || manual.UserAgreement != "" || manual.PrivacyPolicy != "" {
		// 旧值存在 → 视为手动预设生效,保留 option 值不变
		if selected == "" || selected == defaultHomePageThemeID {
			values[homePageThemeSelectedKey] = manualHomePageThemeID
		}
	}
	if err := model.UpdateOptionsBulk(values); err != nil {
		return manual, err
	}
	return manual, nil
}

// homePageThemeContentValues 返回选中来源应写入 4 个公开 option 的内容。
func homePageThemeContentValues(themes []HomePageTheme, selected string, manual HomePageManual) map[string]string {
	var src HomePageManual
	switch selected {
	case defaultHomePageThemeID:
		// 全空
	case manualHomePageThemeID:
		src = manual
	default:
		if theme, ok := findHomePageTheme(themes, selected); ok {
			src = HomePageManual{
				Home:          theme.Content,
				About:         theme.About,
				UserAgreement: theme.UserAgreement,
				PrivacyPolicy: theme.PrivacyPolicy,
			}
		}
	}
	return map[string]string{
		homePageContentOptionKey:       src.Home,
		aboutOptionKey:                src.About,
		legalUserAgreementOptionKey:   src.UserAgreement,
		legalPrivacyPolicyOptionKey:   src.PrivacyPolicy,
	}
}

// writeHomePageThemeLibrary 原子写主题库 + 选中 id + 4 页内容(单事务落库后刷内存 map)。
func writeHomePageThemeLibrary(themes []HomePageTheme, selected string, manual HomePageManual) error {
	themesJSON, err := common.Marshal(themes)
	if err != nil {
		return err
	}
	values := homePageThemeContentValues(themes, selected, manual)
	values[homePageThemesOptionKey] = string(themesJSON)
	values[homePageThemeSelectedKey] = selected
	return model.UpdateOptionsBulk(values)
}

func validateHomePageThemeName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxHomePageThemeNameRunes {
		return errors.New("主题名称不能为空且不能超过 100 个字符")
	}
	return nil
}

func findHomePageTheme(themes []HomePageTheme, id string) (*HomePageTheme, bool) {
	for i := range themes {
		if themes[i].ID == id {
			return &themes[i], true
		}
	}
	return nil, false
}

// homePageThemePages 返回主题非空页面的 slug 列表(供前端展示覆盖标签)。
func homePageThemePages(theme *HomePageTheme) []string {
	pages := make([]string, 0, 4)
	if theme.Content != "" {
		pages = append(pages, "home")
	}
	if theme.About != "" {
		pages = append(pages, "about")
	}
	if theme.UserAgreement != "" {
		pages = append(pages, "user_agreement")
	}
	if theme.PrivacyPolicy != "" {
		pages = append(pages, "privacy_policy")
	}
	return pages
}

// ============================================================================
// zip 解析
// ============================================================================

// zip 内可选预览图文件名 → mime(存完整 data URI 供卡片示意图)。
func themePreviewMime(name string) (string, bool) {
	switch name {
	case "preview.png":
		return "image/png", true
	case "preview.jpg", "preview.jpeg":
		return "image/jpeg", true
	case "preview.webp":
		return "image/webp", true
	}
	return "", false
}

// parseThemeZip 解压 zip 并提取各页面内容与可选预览图(base64)。
// 命名规范:固定页名 home/about/agreement/privacy.html + 可选 preview.{png,jpg,jpeg,webp};
// 忽略 __MACOSX/、.DS_Store、其他文件;缺的页面为空。zip slip 与大小均有防护。
func parseThemeZip(zipBytes []byte) (HomePageManual, string, string, error) {
	reader, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return HomePageManual{}, "", "", errors.New("无法解析 zip 文件")
	}

	manual := HomePageManual{}
	preview := ""
	version := ""
	totalLen := 0
	for _, file := range reader.File {
		// zip 内部路径统一用 / 分隔;用 path 包做规范化,避免 Windows 下反斜杠导致的 zip slip 漏检。
		name := path.Clean(file.Name)
		if name == ".." || strings.HasPrefix(name, "../") || strings.HasPrefix(name, "/") {
			return HomePageManual{}, "", "", errors.New("zip 内含非法路径: " + file.Name)
		}
		base := path.Base(name)
		if base == ".DS_Store" || strings.HasPrefix(name, "__MACOSX") {
			continue
		}
		lowerBase := strings.ToLower(base)

		if mime, ok := themePreviewMime(lowerBase); ok {
			if file.UncompressedSize64 > uint64(maxThemePreviewBytes) {
				return HomePageManual{}, "", "", errors.New("zip 内预览图超过 200KB 限制: " + file.Name)
			}
			rc, err := file.Open()
			if err != nil {
				return HomePageManual{}, "", "", errors.New("无法读取 zip 内文件: " + file.Name)
			}
			content, err := io.ReadAll(io.LimitReader(rc, maxThemePreviewBytes+1))
			rc.Close()
			if err != nil || len(content) > maxThemePreviewBytes {
				return HomePageManual{}, "", "", errors.New("zip 内预览图超过 200KB 限制: " + file.Name)
			}
			preview = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(content)
			continue
		}

		// 可选 version.txt:简短版本描述(如 "1.0.0"),卡片右下角展示。
		if lowerBase == "version.txt" {
			if file.UncompressedSize64 > uint64(maxThemeVersionLen) {
				return HomePageManual{}, "", "", errors.New("zip 内版本文件超过 200 字节限制: " + file.Name)
			}
			rc, err := file.Open()
			if err != nil {
				return HomePageManual{}, "", "", errors.New("无法读取 zip 内文件: " + file.Name)
			}
			content, err := io.ReadAll(io.LimitReader(rc, maxThemeVersionLen+1))
			rc.Close()
			if err != nil || len(content) > maxThemeVersionLen {
				return HomePageManual{}, "", "", errors.New("zip 内版本文件超过 200 字节限制: " + file.Name)
			}
			if !utf8.Valid(content) {
				return HomePageManual{}, "", "", errors.New("zip 内版本文件不是合法 UTF-8 文本: " + file.Name)
			}
			version = strings.TrimSpace(string(content))
			continue
		}

		slug, ok := themeZipPageFiles[lowerBase]
		if !ok {
			continue // 非固定页名文件忽略
		}
		if file.UncompressedSize64 > uint64(maxHomePageThemeContentLen) {
			return HomePageManual{}, "", "", errors.New("zip 内文件超过 500KB 限制: " + file.Name)
		}
		rc, err := file.Open()
		if err != nil {
			return HomePageManual{}, "", "", errors.New("无法读取 zip 内文件: " + file.Name)
		}
		content, err := io.ReadAll(io.LimitReader(rc, maxHomePageThemeContentLen+1))
		rc.Close()
		if err != nil {
			return HomePageManual{}, "", "", errors.New("无法读取 zip 内文件: " + file.Name)
		}
		if !utf8.Valid(content) {
			return HomePageManual{}, "", "", errors.New("zip 内文件不是合法 UTF-8 文本: " + file.Name)
		}
		totalLen += len(content)
		if totalLen > maxThemeZipTotalLen {
			return HomePageManual{}, "", "", errors.New("zip 解压后内容超过 2MB 限制")
		}
		text := string(content)
		switch slug {
		case "home":
			manual.Home = text
		case "about":
			manual.About = text
		case "user_agreement":
			manual.UserAgreement = text
		case "privacy_policy":
			manual.PrivacyPolicy = text
		}
	}

	if manual.Home == "" {
		return HomePageManual{}, "", "", errors.New("zip 内缺少必需的 home.html")
	}
	return manual, preview, version, nil
}

// ============================================================================
// 接口
// ============================================================================

// GetHomePageThemes 返回主题摘要(不含内容) + 手动预设 + 当前选中 id。首次调用触发旧值迁移。
func GetHomePageThemes(c *gin.Context) {
	themes, selected := readHomePageThemeLibrary()
	manual, err := ensureHomePageManualMigration()
	if err != nil {
		common.SysError("home page manual migration failed: " + err.Error())
	}
	summaries := make([]HomePageThemeSummary, 0, len(themes))
	for i := range themes {
		summaries = append(summaries, HomePageThemeSummary{
			ID:        themes[i].ID,
			Name:      themes[i].Name,
			CreatedAt: themes[i].CreatedAt,
			Pages:     homePageThemePages(&themes[i]),
			Preview:   themes[i].Preview,
			Version:   themes[i].Version,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"themes":   summaries,
			"selected": selected,
			"manual":   manual,
		},
	})
}

// GetHomePageTheme 返回单个导入主题的完整内容(预览用)。default/manual 由前端直接渲染,无需拉取。
func GetHomePageTheme(c *gin.Context) {
	id := c.Param("id")
	if id == defaultHomePageThemeID || id == manualHomePageThemeID {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该预设没有可单独预览的内容",
		})
		return
	}
	themes, _ := readHomePageThemeLibrary()
	theme, ok := findHomePageTheme(themes, id)
	if !ok {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "主题不存在",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    theme,
	})
}

// ImportHomePageTheme 导入主题(multipart: file 为 .zip 或 .html + 可选 name),并自动选中生效。
func ImportHomePageTheme(c *gin.Context) {
	homePageThemeMu.Lock()
	defer homePageThemeMu.Unlock()

	// 限制请求体大小,防超大上传
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxThemeZipBytes)

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请上传 .zip 或 .html 文件",
		})
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无法读取上传文件",
		})
		return
	}
	content, err := io.ReadAll(io.LimitReader(file, maxThemeZipBytes+1))
	file.Close()
	if err != nil || len(content) > maxThemeZipBytes {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "文件超过 2MB 限制",
		})
		return
	}

	name := strings.TrimSpace(c.PostForm("name"))
	lowerName := strings.ToLower(fileHeader.Filename)
	var theme HomePageTheme
	if strings.HasSuffix(lowerName, ".zip") {
		manual, preview, version, err := parseThemeZip(content)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		if name == "" {
			name = strings.TrimSuffix(fileHeader.Filename, path.Ext(fileHeader.Filename))
		}
		theme = HomePageTheme{
			Content:       manual.Home,
			About:         manual.About,
			UserAgreement: manual.UserAgreement,
			PrivacyPolicy: manual.PrivacyPolicy,
			Preview:       preview,
			Version:       version,
		}
	} else {
		if name == "" {
			name = strings.TrimSuffix(fileHeader.Filename, path.Ext(fileHeader.Filename))
		}
		theme = HomePageTheme{Content: string(content)}
	}

	if err := validateHomePageThemeName(name); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if theme.Content == "" || len([]byte(theme.Content)) > maxHomePageThemeContentLen {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "营销页内容不能为空且不能超过 500KB",
		})
		return
	}

	themes, _ := readHomePageThemeLibrary()
	if len(themes) >= maxHomePageThemeCount {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "主题数量已达上限(50 个)",
		})
		return
	}

	theme.ID = uuid.NewString()
	theme.Name = name
	theme.CreatedAt = time.Now().Unix()
	themes = append(themes, theme)
	manual := readHomePageManual()
	if err := writeHomePageThemeLibrary(themes, theme.ID, manual); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "home_page_theme.import", map[string]interface{}{
		"theme_id":   theme.ID,
		"theme_name": theme.Name,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"id":       theme.ID,
			"selected": theme.ID,
		},
	})
}

// SelectHomePageTheme 切换当前生效来源(default/manual/导入主题)。
func SelectHomePageTheme(c *gin.Context) {
	homePageThemeMu.Lock()
	defer homePageThemeMu.Unlock()

	var req SelectHomePageThemeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的参数",
		})
		return
	}

	themes, _ := readHomePageThemeLibrary()
	if req.ID != defaultHomePageThemeID && req.ID != manualHomePageThemeID {
		if _, ok := findHomePageTheme(themes, req.ID); !ok {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "主题不存在",
			})
			return
		}
	}

	manual := readHomePageManual()
	if err := writeHomePageThemeLibrary(themes, req.ID, manual); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "home_page_theme.select", map[string]interface{}{
		"theme_id": req.ID,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

// UpdateHomePageManual 保存手动预设并生效(切到手动模式)。
func UpdateHomePageManual(c *gin.Context) {
	homePageThemeMu.Lock()
	defer homePageThemeMu.Unlock()

	var req UpdateHomePageManualRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的参数",
		})
		return
	}
	for _, page := range []string{req.Home, req.About, req.UserAgreement, req.PrivacyPolicy} {
		if len([]byte(page)) > maxHomePageThemeContentLen {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "单页内容不能超过 500KB",
			})
			return
		}
	}

	manual := HomePageManual{
		Home:          req.Home,
		About:         req.About,
		UserAgreement: req.UserAgreement,
		PrivacyPolicy: req.PrivacyPolicy,
	}
	manualJSON, err := common.Marshal(manual)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	themes, _ := readHomePageThemeLibrary()
	values := homePageThemeContentValues(themes, manualHomePageThemeID, manual)
	values[homePageManualOptionKey] = string(manualJSON)
	values[homePageThemeSelectedKey] = manualHomePageThemeID
	if err := model.UpdateOptionsBulk(values); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "home_page_theme.manual_update", map[string]interface{}{})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

// DeleteHomePageTheme 删除导入主题;若删除的是当前生效主题,自动回退 default。
func DeleteHomePageTheme(c *gin.Context) {
	homePageThemeMu.Lock()
	defer homePageThemeMu.Unlock()

	id := c.Param("id")
	if id == defaultHomePageThemeID || id == manualHomePageThemeID {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "内置预设不可删除",
		})
		return
	}

	themes, selected := readHomePageThemeLibrary()
	theme, ok := findHomePageTheme(themes, id)
	if !ok {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "主题不存在",
		})
		return
	}

	newThemes := make([]HomePageTheme, 0, len(themes))
	for _, theme := range themes {
		if theme.ID != id {
			newThemes = append(newThemes, theme)
		}
	}

	newSelected := selected
	if selected == id {
		newSelected = defaultHomePageThemeID
	}
	manual := readHomePageManual()
	if err := writeHomePageThemeLibrary(newThemes, newSelected, manual); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "home_page_theme.delete", map[string]interface{}{
		"theme_id":   id,
		"theme_name": theme.Name,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}
