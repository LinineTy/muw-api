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

// parseForkVersion 解析 muw fork 版本号,支持两种体系,返回可比数组:
//   - 旧 semver:vX.Y.Z[-rc.N][-muw.M][后缀] → [1, X, Y, Z, 稳定度(1=正式,0=rc), rc号, muw号]
//   - 日期制:vYY.MM.DD[.muw.N]             → [2, YY, MM, DD, muw号]
// 首维是体系优先级(epoch):日期制(2)恒大于旧格式(1)——因此部署旧版本号
// 的实例只要 registry 里出现日期制版本就提示更新(「旧版本号一律提示升级到
// 新体系」)。无法解析(如 latest、普通 tag)返回 nil。历史误标的杂后缀(如 .ts)
// 直接忽略。
func parseForkVersion(s string) []int {
	s = strings.TrimPrefix(s, "v")
	if s == "" {
		return nil
	}

	// 先按 - 拆出主版本(旧格式 v1.0.0 / 日期制 v26.01.01 或 v26.08.14.muw.1
	// 都可能带连字符后缀)。
	parts := strings.Split(s, "-")
	dotParts := strings.Split(parts[0], ".")

	// 主版本数字:开头的点分数字段,遇到非数字段(如日期制里连带的 muw)停止。
	nums := make([]int, 0, 3)
	k := 0
	for ; k < len(dotParts); k++ {
		n, err := strconv.Atoi(dotParts[k])
		if err != nil {
			break
		}
		nums = append(nums, n)
	}
	if len(nums) == 0 {
		return nil
	}
	for len(nums) < 3 {
		nums = append(nums, 0)
	}

	// 修饰段:主版本段之后的点分段(日期制 v26.08.14.muw.1 的 muw.1)+ 所有
	// - 分段(旧格式 rc.24 / muw.1、日期制 v26.01.01-muw.5 的 muw.5)。
	rest := append([]string{}, dotParts[k:]...)
	rest = append(rest, parts[1:]...)
	// 日期制的 "muw" 与后一数字段被点拆开,合并成 "muw.N" 再解析。
	stable, stage, fork := 1, 0, 0
	for j := 0; j < len(rest); j++ {
		seg := rest[j]
		if seg == "muw" && j+1 < len(rest) {
			seg = "muw." + rest[j+1]
			j++
		}
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
		// 其他段忽略
	}

	// 日期制判别:首段三位中 YY∈[20,99](年份 2020+)且 MM/DD 是合理日期。
	// 上游 semver 主版本不会达到 20,阈值判别可靠。
	if nums[0] >= 20 && nums[0] <= 99 && nums[1] >= 1 && nums[1] <= 12 && nums[2] >= 1 && nums[2] <= 31 {
		return []int{2, nums[0], nums[1], nums[2], fork}
	}
	return []int{1, nums[0], nums[1], nums[2], stable, stage, fork}
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
