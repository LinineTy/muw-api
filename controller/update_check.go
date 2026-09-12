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
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// 更新检测的源 = 一份「发布清单」update.json（由 repo 根的 release.sh 生成）：
//
//	GET https://registry.dev3.mulink.top/update.json
//	{
//	  "stable": {"version":"v26.08.20.muw.1",  "notes":"notes.md"},
//	  "dev":    {"version":"v26.09.13.muw.15", "notes":"notes-dev.md"}
//	}
//
// 两个通道（2026-09-13 maintainer定）：
//   - stable：**对外公告的稳定版**。所有部署都按它判断有没有更新 —— 稳定版是
//     "标记"出来的（仓库根的 STABLE 文件），不是靠藏起来。
//   - dev：最新构建。只有打开「检测开发版更新」开关的实例才按它判断
//     （operation_setting.UpdateCheckDevChannelEnabled）。
//
// notes 是该版说明正文的文件名（相对清单 URL 解析，也接受绝对 URL），
// release.sh 从 CHANGELOG 顶部条目切出。说明不能内置进二进制：旧版本部署的
// 二进制里没有新版本的说明，得像上游 GitHub release body 那样动态拉。
//
// 未知字段一律忽略，以后要在清单里加字段（如 min_supported_version）不必改后端。
// 自建分发时用 UPDATE_CHECK_URL 指向自己的清单。
// ⚠️ 路径故意用 .md 而不是 .json：反代前面是腾讯 EdgeOne，它**按路径缓存、忽略查询串**
// （`?t=` 破缓存无效，请求头带 no-cache 也不绕），但站点给 .md 配了"忽略缓存"，实测
// `.md` 每次 MISS 回源、`.json` 会被缓存住（2026-09-13 maintainer排查 + 实测）。
// 另外源站这几个 location 都补了 `Cache-Control: no-store`，配合"遵循源站"规则也不该再被缓存。
const updateCheckURLDefault = "https://registry.dev3.mulink.top/update.md"

// updateChannelManifest 清单里的一个通道。
type updateChannelManifest struct {
	Version string `json:"version"`
	Notes   string `json:"notes"`
}

// releaseManifest 发布清单（见文件头说明）。
type releaseManifest struct {
	Stable updateChannelManifest `json:"stable"`
	Dev    updateChannelManifest `json:"dev"`
}

// parseForkVersion 解析 muw fork 版本号,支持两种体系,返回可比数组:
//   - 旧 semver:vX.Y.Z[-rc.N][-muw.M][后缀] → [1, X, Y, Z, 稳定度(1=正式,0=rc), rc号, muw号]
//   - 日期制:vYY.MM.DD[.muw.N]             → [2, YY, MM, DD, muw号]
//
// 首维是体系优先级(epoch):日期制(2)恒大于旧格式(1)——因此部署旧版本号
// 的实例只要清单里出现日期制版本就提示更新(「旧版本号一律提示升级到
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

// fetchUpdateSource 取更新源里的静态文件。带时间戳查询参数绕 CDN 缓存:
// 清单/说明都挂在反代(EdgeOne)后面,旧缓存里没有新版本 → 表现成"提示有新版
// 但日志空白",2026-09-11 在 CHANGELOG.md 上踩过这个坑。检查更新不频繁,
// 回源代价可忽略。
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

// fetchReleaseManifest 取发布清单。
func fetchReleaseManifest(ctx context.Context, manifestURL string) (*releaseManifest, error) {
	data, err := fetchUpdateSource(ctx, manifestURL, 64<<10)
	if err != nil {
		return nil, err
	}
	var manifest releaseManifest
	if err := common.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("更新清单解析失败: %w", err)
	}
	return &manifest, nil
}

// pickChannel 按「检测开发版更新」开关选通道。开了但清单里没有 dev 条目时
// 退回 stable（不该因为少写一段就让检查更新彻底失败）。
func pickChannel(manifest *releaseManifest) (string, updateChannelManifest) {
	if operation_setting.UpdateCheckDevChannelEnabled &&
		strings.TrimSpace(manifest.Dev.Version) != "" {
		return "dev", manifest.Dev
	}
	return "stable", manifest.Stable
}

// resolveNotesURL 把清单里的 notes 文件名解析成绝对 URL。
func resolveNotesURL(manifestURL, notes string) string {
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return ""
	}
	if strings.HasPrefix(notes, "http://") || strings.HasPrefix(notes, "https://") {
		return notes
	}
	base, err := url.Parse(manifestURL)
	if err != nil {
		return ""
	}
	ref, err := url.Parse(notes)
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

// fetchVersionNotes 拉取该版本的更新说明正文。失败/未配置返回空串,
// 不阻塞更新检测本身。
func fetchVersionNotes(ctx context.Context, notesURL string) string {
	if notesURL == "" {
		return ""
	}
	data, err := fetchUpdateSource(ctx, notesURL, 1<<20)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// GetUpdateCheck 读发布清单,返回是否有比当前版本更新的版本。
// 只读接口;清单是静态文件(GET),但无 CORS,故由后端代查再返回给前端。
func GetUpdateCheck(c *gin.Context) {
	manifestURL := common.GetEnvOrDefaultString("UPDATE_CHECK_URL", updateCheckURLDefault)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	manifest, err := fetchReleaseManifest(ctx, manifestURL)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	channel, entry := pickChannel(manifest)
	latestTag := strings.TrimSpace(entry.Version)
	if latestTag == "" {
		common.ApiError(c, fmt.Errorf("更新清单里没有 %s 通道的版本号", channel))
		return
	}

	current := parseForkVersion(common.Version)
	latestVals := parseForkVersion(latestTag)
	// 清单里版本号解析不出来(手抖写错)时按"无更新"处理,不误报。
	hasUpdate := latestVals != nil && (current == nil || compareForkVersions(latestVals, current) > 0)

	latestChangelog := ""
	if hasUpdate {
		latestChangelog = fetchVersionNotes(ctx, resolveNotesURL(manifestURL, entry.Notes))
	}

	common.ApiSuccess(c, gin.H{
		"has_update":       hasUpdate,
		"latest_tag":       latestTag,
		"current_version":  common.Version,
		"latest_changelog": latestChangelog,
		"channel":          channel,
	})
}
