/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

// 更新检查的镜像源:muw fork 自己的官方 registry。发布时 release.sh 会把
// latest + 版本 tag 一起传上服务器,由服务器定时任务同步进 registry,因此
// tags/list 里能看到 fork 自己的 vX.Y.Z-rc.N-muw.M 版本号。该接口匿名公开可读
// (GET),但无 CORS 头,故由后端代查再返回给前端。
// 可用环境变量 UPDATE_CHECK_REGISTRY 覆盖(如换 registry 部署)。
const updateCheckRegistryDefault = "https://registry.dev3.mulink.top/v2/muw/new-api"

// parseForkVersion 解析 muw fork 版本号 vX.Y.Z[-rc.N][-muw.M][后缀]。
// 返回可比数组 [X, Y, Z, 稳定度(1=正式版,0=rc), rc号, muw号];
// 无法解析(如 latest、普通 tag)返回 nil。历史误标的杂后缀(如 .ts)直接忽略。
func parseForkVersion(s string) []int {
	s = strings.TrimPrefix(s, "v")
	parts := strings.Split(s, "-")

	nums := make([]int, 0, 3)
	for _, p := range strings.Split(parts[0], ".") {
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil
		}
		nums = append(nums, n)
	}
	for len(nums) < 3 {
		nums = append(nums, 0)
	}

	stable, stage, fork := 1, 0, 0
	for _, seg := range parts[1:] {
		switch {
		case strings.HasPrefix(seg, "rc."):
			if n, ok := parseIntPrefix(seg, "rc."); ok {
				stage = n
				stable = 0
			}
		case strings.HasPrefix(seg, "muw."):
			if n, ok := parseIntPrefix(seg, "muw."); ok {
				fork = n
			}
		}
		// 其他段(如 .ts)忽略
	}
	return []int{nums[0], nums[1], nums[2], stable, stage, fork}
}

// parseIntPrefix 取段前缀后的连续数字(如 "muw.3.ts" -> 3,"rc.24" -> 24)。
// 兼容历史误标 tag 把杂后缀直接贴在数字后面(如 v1.0.0-rc.23-muw.3.ts)。
func parseIntPrefix(seg, prefix string) (int, bool) {
	num := strings.TrimPrefix(seg, prefix)
	end := len(num)
	for i, ch := range num {
		if ch < '0' || ch > '9' {
			end = i
			break
		}
	}
	if end == 0 {
		return 0, false
	}
	n, err := strconv.Atoi(num[:end])
	return n, err == nil
}

func compareForkVersions(a, b []int) int {
	for i := range a {
		if i >= len(b) {
			return 1
		}
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	if len(b) > len(a) {
		return -1
	}
	return 0
}

// GetUpdateCheck 查询 fork 官方 registry 的 tags,返回是否有比当前版本更新的版本。
// 只读接口;tags/list 匿名公开(GET),但无 CORS,故由后端代查。
func GetUpdateCheck(c *gin.Context) {
	registry := common.GetEnvOrDefaultString("UPDATE_CHECK_REGISTRY", updateCheckRegistryDefault)
	url := registry
	if !strings.HasSuffix(url, "/tags/list") {
		url = strings.TrimRight(url, "/") + "/tags/list"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		common.ApiError(c, fmt.Errorf("registry tags 接口返回 %d", resp.StatusCode))
		return
	}

	var payload struct {
		Tags []string `json:"tags"`
	}
	if err := common.DecodeJson(resp.Body, &payload); err != nil {
		common.ApiError(c, err)
		return
	}

	current := parseForkVersion(common.Version)
	var latestVals []int
	latestTag := ""
	for _, tag := range payload.Tags {
		v := parseForkVersion(tag)
		if v == nil {
			continue
		}
		if latestVals == nil || compareForkVersions(v, latestVals) > 0 {
			latestVals = v
			latestTag = tag
		}
	}

	hasUpdate := latestTag != "" && (current == nil || compareForkVersions(latestVals, current) > 0)
	common.ApiSuccess(c, gin.H{
		"has_update":      hasUpdate,
		"latest_tag":      latestTag,
		"current_version": common.Version,
	})
}
