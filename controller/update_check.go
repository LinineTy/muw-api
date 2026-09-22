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
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// 更新检测的源 = **公网 Gitea 的 releases API**（2026-09-22定，取代此前的静态发布清单 update.md）：
//
//	GET https://git.example.com/api/v1/repos/owner/muw-api/releases
//
// 上游 new-api 也只有一份 GitHub release，我们跟着走同一套，不再自造清单 + notes 静态文件。
//
// 两个通道（2026-09-13定）：
//   - stable：最新的**非 prerelease** release —— 对外公告的稳定版。没打开「检测开发版更新」的部署都按它判断。
//   - dev：最新 release（含 prerelease）—— 最新构建。只有打开开关的实例才按它判断
//     （operation_setting.UpdateCheckDevChannelEnabled）。
//     发版时由 repo 根 release.sh 按问到的公告范围决定本次 release 是否标 prerelease，
//     所以"哪个是稳定版"由发版动作本身决定，检测端不需要额外清单。
//
// 版本号取 tag_name，说明正文取 body（Markdown，随 release 一起发），
// ⇒ 说明必须动态取、不能内置进二进制：旧版本部署的二进制里没有新版本的说明。
//
// 未登录实例读得到：该仓库本身保持私有，但「公开访问」里把**发布 + 软件包**放开为可读
// （2026-09-22 实测匿名 GET releases 返回 200；代码不外露）。自建分发时用
// UPDATE_CHECK_RELEASES_URL 指向自己的 releases API。
const updateCheckURLDefault = "https://git.example.com/api/v1/repos/owner/muw-api/releases"

// updateCheckUserAgent 给源站一个可识别的 UA（有的反代/WAF 会拦空 UA 或默认 UA）。
const updateCheckUserAgent = "muw-api-update-check"

// giteaReleaseItem Gitea releases API 的一条记录（只取用得上的字段，其余忽略）。
type giteaReleaseItem struct {
	TagName    string `json:"tag_name"`
	Body       string `json:"body"`
	Prerelease bool   `json:"prerelease"`
	Draft      bool   `json:"draft"`
}

// parseForkVersion 解析 muw fork 版本号,支持两种体系,返回可比数组:
//   - 旧 semver:vX.Y.Z[-rc.N][-muw.M][后缀] → [1, X, Y, Z, 稳定度(1=正式,0=rc), rc号, muw号]
//   - 日期制:vYY.MM.DD[.muw.N]             → [2, YY, MM, DD, muw号]
//
// 首维是体系优先级(epoch):日期制(2)恒大于旧格式(1)——因此部署旧版本号
// 的实例只要源里出现日期制版本就提示更新(「旧版本号一律提示升级到
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

// fetchUpdateSource 取更新源。带时间戳查询参数绕中间缓存:源站背后可能有反代/CDN,
// 旧缓存里没有新版本 → 表现成"提示有新版但日志空白",2026-09-11 在静态日志文件上踩过。
// 检查更新不频繁,回源代价可忽略。
func fetchUpdateSource(ctx context.Context, rawURL string, limit int64) ([]byte, error) {
	sep := "?"
	if strings.Contains(rawURL, "?") {
		sep = "&"
	}
	req, err := http.NewRequestWithContext(
		ctx, http.MethodGet, rawURL+sep+"t="+strconv.FormatInt(time.Now().Unix(), 10), nil,
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", updateCheckUserAgent)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("更新源 %s 返回 %d", rawURL, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}

// fetchReleases 取 releases 列表（Gitea API 返回数组，越新越靠前）。
func fetchReleases(ctx context.Context, releasesURL string, limit int64) ([]giteaReleaseItem, error) {
	data, err := fetchUpdateSource(ctx, releasesURL, limit)
	if err != nil {
		return nil, err
	}
	var items []giteaReleaseItem
	if err := common.Unmarshal(data, &items); err != nil {
		return nil, fmt.Errorf("更新源解析失败: %w", err)
	}
	return items, nil
}

// pickRelease 从 release 列表里挑出该通道的版本号与说明。
//
// 按**版本号大小**挑最大的，而不是信 API 的返回顺序（顺序是时间维度，发版顺序
// 与版本大小未必一致：补发一个老的稳定版 release 时就会错）。忽略 draft 与
// 解析不出格式的 tag（如上游的 latest）。
//
// includePrerelease=false 时只看非 prerelease 条目（stable 通道）。
func pickRelease(items []giteaReleaseItem, includePrerelease bool) (string, string, bool) {
	bestTag, bestBody := "", ""
	var best []int
	for _, item := range items {
		if item.Draft {
			continue
		}
		if item.Prerelease && !includePrerelease {
			continue
		}
		tag := strings.TrimSpace(item.TagName)
		vals := parseForkVersion(tag)
		if vals == nil {
			continue
		}
		if best == nil || compareForkVersions(vals, best) > 0 {
			best, bestTag, bestBody = vals, tag, item.Body
		}
	}
	return bestTag, bestBody, best != nil
}

// GetUpdateCheck 读更新源（公网 Gitea releases），返回是否有比当前版本更新的版本。
// 只读接口；releases 无 CORS 限制但需要出网，故由后端代查再返回给前端。
func GetUpdateCheck(c *gin.Context) {
	releasesURL := common.GetEnvOrDefaultString("UPDATE_CHECK_RELEASES_URL", updateCheckURLDefault)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	items, err := fetchReleases(ctx, releasesURL, 1<<20)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 通道只决定"看不看 prerelease"，命中哪个版本由版本号大小决定。
	includePrerelease := operation_setting.UpdateCheckDevChannelEnabled
	channel := "stable"
	if includePrerelease {
		channel = "dev"
	}
	latestTag, latestBody, ok := pickRelease(items, includePrerelease)
	if !ok {
		common.ApiError(c, fmt.Errorf("更新源里没有可用的 %s 通道版本（是否还没发过该类 release？）", channel))
		return
	}

	current := parseForkVersion(common.Version)
	latestVals := parseForkVersion(latestTag)
	// 源里版本号解析不出来(手抖写错 tag)时按"无更新"处理,不误报。
	hasUpdate := latestVals != nil && (current == nil || compareForkVersions(latestVals, current) > 0)

	latestChangelog := ""
	if hasUpdate {
		latestChangelog = strings.TrimSpace(latestBody)
	}

	common.ApiSuccess(c, gin.H{
		"has_update":       hasUpdate,
		"latest_tag":       latestTag,
		"current_version":  common.Version,
		"latest_changelog": latestChangelog,
		"channel":          channel,
	})
}
