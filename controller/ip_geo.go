// @muw-owned
package controller

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/ipgeo"
)

// 归属地设置落库用的选项键（设置页可改，不依赖环境变量）。
const (
	ipGeoEnabledOptionKey = "ip_geo.enabled"
	ipGeoURLv4OptionKey   = "ip_geo.url_v4"
	ipGeoURLv6OptionKey   = "ip_geo.url_v6"
)

// ipGeoConfigFromOptions 把数据库选项转成 ipgeo 配置；缺项回落到内置默认值。
func ipGeoConfigFromOptions() ipgeo.Config {
	cfg := ipgeo.DefaultConfig()
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	if v := strings.TrimSpace(common.OptionMap[ipGeoEnabledOptionKey]); v != "" {
		cfg.Enabled = strings.EqualFold(v, "true")
	}
	if v := strings.TrimSpace(common.OptionMap[ipGeoURLv4OptionKey]); v != "" {
		cfg.URLv4 = v
	}
	if v := strings.TrimSpace(common.OptionMap[ipGeoURLv6OptionKey]); v != "" {
		cfg.URLv6 = v
	}
	return cfg
}

// InitIpGeo 启动时初始化归属地模块：选项缺省写一份默认值（设置页打开就有内容），
// 应用配置（本地有库就立刻可用、缺库则后台拉），并启动每日自动检查。
func InitIpGeo() {
	defaults := map[string]string{}
	common.OptionMapRWMutex.RLock()
	if _, ok := common.OptionMap[ipGeoEnabledOptionKey]; !ok {
		defaults[ipGeoEnabledOptionKey] = "true"
	}
	if _, ok := common.OptionMap[ipGeoURLv4OptionKey]; !ok {
		defaults[ipGeoURLv4OptionKey] = ipgeo.DefaultConfig().URLv4
	}
	if _, ok := common.OptionMap[ipGeoURLv6OptionKey]; !ok {
		defaults[ipGeoURLv6OptionKey] = ipgeo.DefaultConfig().URLv6
	}
	common.OptionMapRWMutex.RUnlock()
	if len(defaults) > 0 {
		if err := model.UpdateOptionsBulk(defaults); err != nil {
			common.SysError("初始化 IP 归属地默认选项失败: " + err.Error())
		}
	}

	ipgeo.Apply(ipGeoConfigFromOptions())
	ipgeo.StartAutoCheck(24 * time.Hour)
}

// GetIpGeoStatus 归属地库状态（管理员可见）。
func GetIpGeoStatus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    ipgeo.GetStatus(),
	})
}

// UpdateIpGeoDatabase 立即拉取数据文件并热加载（管理员即可操作，不需要重启容器）。
// scope 留空表示只补缺失的一侧；all / v4 / v6 强制重拉。
func UpdateIpGeoDatabase(c *gin.Context) {
	scope := strings.TrimSpace(c.DefaultQuery("scope", ""))
	if scope == "" {
		// 默认语义＝"更新到最新"：先探测上游，只拉真正需要更新的那一侧
		// （避免为了补一个 11MB 的文件把 37MB 的另一侧也重下一遍）
		needV4, needV6, err := ipgeo.CheckForUpdate()
		if err != nil {
			common.SysLog("检查 IP 归属地库更新失败（改为尝试补齐缺失侧）: " + err.Error())
		}
		scope = ipgeo.UpdateNeeded(needV4, needV6)
		if scope == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": true,
				"message": "",
				"changed": false,
				"data":    ipgeo.GetStatus(),
			})
			return
		}
	}
	st, err := ipgeo.Update(scope)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
			"changed": false,
			"data":    st,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"changed": true,
		"data":    st,
	})
}

// UpdateIpGeoConfig 保存归属地配置（仅 Root）：先落库，再立刻应用到运行中的进程。
func UpdateIpGeoConfig(c *gin.Context) {
	var req struct {
		Enabled bool   `json:"enabled"`
		URLv4   string `json:"url_v4"`
		URLv6   string `json:"url_v6"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "参数格式错误",
		})
		return
	}
	req.URLv4 = strings.TrimSpace(req.URLv4)
	req.URLv6 = strings.TrimSpace(req.URLv6)
	if req.Enabled && (req.URLv4 == "" || req.URLv6 == "") {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "启用时必须填写 IPv4 与 IPv6 两个数据源地址",
		})
		return
	}

	values := map[string]string{
		ipGeoEnabledOptionKey: strconv.FormatBool(req.Enabled),
		ipGeoURLv4OptionKey:   req.URLv4,
		ipGeoURLv6OptionKey:   req.URLv6,
	}
	if err := model.UpdateOptionsBulk(values); err != nil {
		common.ApiError(c, err)
		return
	}

	st := ipgeo.Apply(ipGeoConfigFromOptions())
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    st,
	})
}
