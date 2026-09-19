// @muw-owned
package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func parseDaysParam(c *gin.Context) int {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 {
		days = 30
	}
	if days > 365 {
		days = 365
	}
	return days
}

func parsePagingParams(c *gin.Context) (page, pageSize int) {
	page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ = strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

// parseIpVersionParam 解析 ip_version（all / v4 / v6，其它值一律按 all）。
// 供 IP 分析页过滤：IPv6 隐私扩展会高频轮换地址，只看 IPv4 才能横向比较。
func parseIpVersionParam(c *gin.Context) string {
	switch c.DefaultQuery("ip_version", "all") {
	case "v4":
		return "v4"
	case "v6":
		return "v6"
	default:
		return "all"
	}
}

// GetIpAnalysisUserRank 用户 IP 数排行（风控）。
func GetIpAnalysisUserRank(c *gin.Context) {
	days := parseDaysParam(c)
	minIps, _ := strconv.Atoi(c.DefaultQuery("min_ips", "1"))
	version := parseIpVersionParam(c)
	page, pageSize := parsePagingParams(c)

	rows, total, err := model.GetUserIpRank(days, minIps, version, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":     rows,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// GetIpAnalysisUserDetail 单用户 IP 明细。
func GetIpAnalysisUserDetail(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("user_id"))
	if err != nil || userId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid user_id",
		})
		return
	}
	days := parseDaysParam(c)
	version := parseIpVersionParam(c)

	rows, err := model.GetUserIpDetail(userId, days, version)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
}

// GetIpAnalysisIpRank IP 关联账号数排行（小号集群检测）。
func GetIpAnalysisIpRank(c *gin.Context) {
	days := parseDaysParam(c)
	minUsers, _ := strconv.Atoi(c.DefaultQuery("min_users", "1"))
	version := parseIpVersionParam(c)
	page, pageSize := parsePagingParams(c)

	rows, total, err := model.GetIpUserRank(days, minUsers, version, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":     rows,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// GetIpAnalysisIpDetail 单 IP 关联账号明细。
func GetIpAnalysisIpDetail(c *gin.Context) {
	ip := c.Query("ip")
	if ip == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "ip is required",
		})
		return
	}
	days := parseDaysParam(c)

	rows, err := model.GetIpDetail(ip, days)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
}

// GetOperationsOverview 运营总览。
func GetOperationsOverview(c *gin.Context) {
	data, err := model.GetOperationsOverview()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
}

// GetOperationsTrends 运营日趋势。
func GetOperationsTrends(c *gin.Context) {
	days := parseDaysParam(c)
	tzOffsetSeconds, _ := strconv.Atoi(c.DefaultQuery("tz_offset", "0"))
	// 前端传入 -new Date().getTimezoneOffset() 得到"东八区为 28800"的形式；
	// 兼容直接传 getTimezoneOffset()（东八区为 -480 分钟）的老格式。
	if tzOffsetSeconds < 0 {
		tzOffsetSeconds = tzOffsetSeconds * 60
	}

	data, err := model.GetOperationsTrends(days, tzOffsetSeconds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
}

// GetOperationsDistributions 注册来源/信任等级/分组分布。
func GetOperationsDistributions(c *gin.Context) {
	data, err := model.GetOperationsDistributions()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
}

// GetOperationsRankings 模型/渠道用量排行。
func GetOperationsRankings(c *gin.Context) {
	days := parseDaysParam(c)
	data, err := model.GetOperationsRankings(days)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
}

// GetIpAnalysisOverview 风控看板概览（指标卡片 + 用户 IP 数分布）。
func GetIpAnalysisOverview(c *gin.Context) {
	days := parseDaysParam(c)
	version := parseIpVersionParam(c)

	data, err := model.GetIpAnalysisOverview(days, version)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
}

// GetIpAnalysisTrend 每日独立 IP 数趋势。
func GetIpAnalysisTrend(c *gin.Context) {
	days := parseDaysParam(c)
	version := parseIpVersionParam(c)
	tzOffsetSeconds, _ := strconv.Atoi(c.DefaultQuery("tz_offset", "0"))
	// 与运营趋势同一套兼容处理：前端传 -getTimezoneOffset()（东八区 28800），
	// 老格式直接传 getTimezoneOffset()（东八区 -480 分钟）。
	if tzOffsetSeconds < 0 {
		tzOffsetSeconds = tzOffsetSeconds * 60
	}

	rows, err := model.GetIpAnalysisTrend(days, tzOffsetSeconds, version)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
}

// GetIpAnalysisOverlap 时段重合检测：列出同时活跃度显著超出随机期望的账号对。
func GetIpAnalysisOverlap(c *gin.Context) {
	days := parseDaysParam(c)
	minActive, _ := strconv.Atoi(c.DefaultQuery("min_active_minutes", "100"))
	minOverlap, _ := strconv.Atoi(c.DefaultQuery("min_overlap", "30"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	rows, err := model.GetIpOverlapPairs(days, minActive, minOverlap, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
}
