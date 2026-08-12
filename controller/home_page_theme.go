package controller

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// 营销页主题系统:在现有 HomePageContent(当前生效内容)之上叠加一个主题库。
// 选中某主题 = 把该主题 content 镜像写入 HomePageContent(选中 default 则清空),
// 公开接口 GET /api/home_page_content 与前端渲染链路因此完全不用改。
const (
	homePageThemesOptionKey    = "HomePageThemes"
	homePageThemeSelectedKey   = "HomePageTheme"
	homePageContentOptionKey   = "HomePageContent"
	defaultHomePageThemeID     = "default"
	maxHomePageThemeNameRunes  = 100
	maxHomePageThemeContentKB  = 500
	maxHomePageThemeCount      = 50
	maxHomePageThemeContentLen = maxHomePageThemeContentKB * 1024
)

// 并发导入/选择/删除都是"读整库 → 计算 → 整库覆写",用包级互斥锁避免同进程并发丢更新。
var homePageThemeMu sync.Mutex

type HomePageTheme struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"created_at"`
}

type HomePageThemeSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
}

type ImportHomePageThemeRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type SelectHomePageThemeRequest struct {
	ID string `json:"id"`
}

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

// writeHomePageThemeLibrary 原子写三个键(单事务落库 + 成功后刷内存 map)。
func writeHomePageThemeLibrary(themes []HomePageTheme, selected, content string) error {
	themesJSON, err := common.Marshal(themes)
	if err != nil {
		return err
	}
	return model.UpdateOptionsBulk(map[string]string{
		homePageThemesOptionKey:  string(themesJSON),
		homePageThemeSelectedKey: selected,
		homePageContentOptionKey: content,
	})
}

func validateHomePageThemeName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxHomePageThemeNameRunes {
		return errors.New("主题名称不能为空且不能超过 100 个字符")
	}
	return nil
}

func validateHomePageThemeContent(content string) error {
	if content == "" || len([]byte(content)) > maxHomePageThemeContentLen {
		return errors.New("主题内容不能为空且不能超过 500KB")
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

// themeContentFor 返回选中主题应写入 HomePageContent 的内容:
// default → 空(渲染内置 React 营销页);命中主题 → 其 content;未命中 → 空。
func themeContentFor(themes []HomePageTheme, selected string) string {
	if selected == defaultHomePageThemeID {
		return ""
	}
	if theme, ok := findHomePageTheme(themes, selected); ok {
		return theme.Content
	}
	return ""
}

// GetHomePageThemes 返回主题摘要列表(不含 content)与当前选中 id。
func GetHomePageThemes(c *gin.Context) {
	themes, selected := readHomePageThemeLibrary()
	summaries := make([]HomePageThemeSummary, 0, len(themes))
	for _, theme := range themes {
		summaries = append(summaries, HomePageThemeSummary{
			ID:        theme.ID,
			Name:      theme.Name,
			CreatedAt: theme.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"themes":   summaries,
			"selected": selected,
		},
	})
}

// GetHomePageTheme 返回单个主题的完整内容(预览用)。default 为内置主题,无内容可查。
func GetHomePageTheme(c *gin.Context) {
	id := c.Param("id")
	if id == defaultHomePageThemeID {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "内置默认主题没有可预览的内容",
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

// ImportHomePageTheme 导入一个新主题并自动选中生效。
func ImportHomePageTheme(c *gin.Context) {
	homePageThemeMu.Lock()
	defer homePageThemeMu.Unlock()

	var req ImportHomePageThemeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的参数",
		})
		return
	}

	if err := validateHomePageThemeName(req.Name); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if err := validateHomePageThemeContent(req.Content); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
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

	theme := HomePageTheme{
		ID:        uuid.NewString(),
		Name:      req.Name,
		Content:   req.Content,
		CreatedAt: time.Now().Unix(),
	}
	themes = append(themes, theme)
	if err := writeHomePageThemeLibrary(themes, theme.ID, theme.Content); err != nil {
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

// SelectHomePageTheme 切换当前生效的主题(default 恢复内置 React 营销页)。
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
	if req.ID != defaultHomePageThemeID {
		if _, ok := findHomePageTheme(themes, req.ID); !ok {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "主题不存在",
			})
			return
		}
	}

	content := themeContentFor(themes, req.ID)
	if err := writeHomePageThemeLibrary(themes, req.ID, content); err != nil {
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

// DeleteHomePageTheme 删除一个主题;若删除的是当前生效主题,自动回退 default。
func DeleteHomePageTheme(c *gin.Context) {
	homePageThemeMu.Lock()
	defer homePageThemeMu.Unlock()

	id := c.Param("id")
	if id == defaultHomePageThemeID {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "内置默认主题不可删除",
		})
		return
	}

	themes, selected := readHomePageThemeLibrary()
	if _, ok := findHomePageTheme(themes, id); !ok {
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
	content := themeContentFor(newThemes, newSelected)
	if err := writeHomePageThemeLibrary(newThemes, newSelected, content); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "home_page_theme.delete", map[string]interface{}{
		"theme_id": id,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}
