// @muw-owned
package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// changelogContent 是编译期嵌入的 CHANGELOG.md 内容，由 main 包注入。
var changelogContent string

// SetChangelogContent 注入内置的更新日志内容，仅由 main 包在启动前调用一次。
func SetChangelogContent(content string) {
	changelogContent = content
}

type changelogEntry struct {
	Version string
	Date    string
	Body    string
}

// parseChangelog 按二级标题切分更新日志，返回顺序与文件一致（第一段即最新一版）。
func parseChangelog(content string) []changelogEntry {
	entries := make([]changelogEntry, 0, 8)
	var current *changelogEntry
	var body []string

	flush := func() {
		if current == nil {
			return
		}
		current.Body = strings.TrimSpace(strings.Join(body, "\n"))
		entries = append(entries, *current)
		current = nil
		body = nil
	}

	for _, line := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(line, "## ") {
			flush()
			version, date := parseChangelogHeading(strings.TrimSpace(strings.TrimPrefix(line, "## ")))
			current = &changelogEntry{Version: version, Date: date}
			continue
		}
		if current != nil {
			body = append(body, line)
		}
	}
	flush()
	return entries
}

// parseChangelogHeading 解析 `v26.09.11.muw.6 (2026-09-11)` 形式的标题，日期可缺省。
func parseChangelogHeading(heading string) (version string, date string) {
	version = strings.TrimSpace(heading)
	if open := strings.Index(version, "("); open >= 0 {
		if close := strings.Index(version[open:], ")"); close > 0 {
			date = strings.TrimSpace(version[open+1 : open+close])
		}
		version = strings.TrimSpace(version[:open])
	}
	return version, date
}

// pickChangelogEntry 找到与运行版本匹配的段落；没有匹配时回退到最新一版并返回 false。
// 比较前两侧都去掉空白：VERSION 文件在 Windows 检出会被加上 \r，经构建期注入后
// 会粘在版本号尾部（`v26.09.11.muw.8\r`），不 trim 就会永远匹配不上。
func pickChangelogEntry(entries []changelogEntry, version string) (changelogEntry, bool) {
	target := strings.TrimSpace(version)
	for _, entry := range entries {
		if strings.TrimSpace(entry.Version) == target {
			return entry, true
		}
	}
	return entries[0], false
}

// GetChangelog 返回当前运行版本对应的更新日志段落，以及其余段落供「历史版本」折叠。
// 版本不在内置日志里时（如直接跑上游版本号）回退到最新一版，并以 matched=false 告知前端。
func GetChangelog(c *gin.Context) {
	entries := parseChangelog(changelogContent)
	if len(entries) == 0 {
		common.ApiErrorMsg(c, "内置更新日志为空")
		return
	}

	entry, matched := pickChangelogEntry(entries, common.Version)

	// 其余段落按文件顺序（最新在前）一并下发，已展示的那一段不重复下发。
	history := make([]gin.H, 0, len(entries))
	for _, item := range entries {
		if item.Version == entry.Version {
			continue
		}
		history = append(history, gin.H{
			"version":  item.Version,
			"date":     item.Date,
			"markdown": item.Body,
		})
	}

	common.ApiSuccess(c, gin.H{
		"version": strings.TrimSpace(common.Version),
		"matched": matched,
		"note": gin.H{
			"version":  entry.Version,
			"date":     entry.Date,
			"markdown": entry.Body,
		},
		"history": history,
	})
}
