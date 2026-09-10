// @muw-owned
package controller

import (
	"strings"
	"testing"
)

const changelogFixture = `# 更新日志 (Changelog)

本文件记录 muw fork 的发布版本与变更。

## v26.09.11.muw.6 (2026-09-11)

### 主题甲

- **新增**：甲条目

## v26.09.10.muw.5 (2026-09-10)

### 主题乙

- **修复**：乙条目

## v0.9.9

### 无日期标题

- 老条目
`

func TestParseChangelogSplitsEntries(t *testing.T) {
	entries := parseChangelog(changelogFixture)
	if len(entries) != 3 {
		t.Fatalf("期望 3 段，实际 %d 段", len(entries))
	}
	if entries[0].Version != "v26.09.11.muw.6" || entries[0].Date != "2026-09-11" {
		t.Fatalf("第一段版本/日期解析错误: %+v", entries[0])
	}
	if entries[2].Version != "v0.9.9" || entries[2].Date != "" {
		t.Fatalf("无日期标题解析错误: %+v", entries[2])
	}
	if !strings.Contains(entries[0].Body, "甲条目") {
		t.Fatalf("第一段正文缺失: %q", entries[0].Body)
	}
	if strings.Contains(entries[0].Body, "乙条目") {
		t.Fatalf("段落串了下一版内容: %q", entries[0].Body)
	}
	if strings.Contains(entries[0].Body, "# 更新日志") {
		t.Fatalf("文件头被并入正文: %q", entries[0].Body)
	}
}

func TestPickChangelogEntry(t *testing.T) {
	entries := parseChangelog(changelogFixture)

	hit, matched := pickChangelogEntry(entries, "v26.09.10.muw.5")
	if !matched || hit.Version != "v26.09.10.muw.5" {
		t.Fatalf("命中版本应返回该段: matched=%v entry=%+v", matched, hit)
	}

	fallback, matched := pickChangelogEntry(entries, "v0.0.0")
	if matched {
		t.Fatalf("未知版本不应标记为命中")
	}
	if fallback.Version != "v26.09.11.muw.6" {
		t.Fatalf("未知版本应回退到最新一段，实际 %q", fallback.Version)
	}
}

// 版本号带 \r 也必须匹配：VERSION 文件在 Windows 检出会被加上 CRLF，
// 构建期经 ldflags 注入后 \r 会粘在版本号尾部（生产实测就是这样）。
func TestPickChangelogEntryTrimsVersion(t *testing.T) {
	entries := parseChangelog(changelogFixture)

	for _, version := range []string{
		"v26.09.11.muw.6",
		"v26.09.11.muw.6\r",
		"v26.09.11.muw.6\n",
		" v26.09.11.muw.6 ",
	} {
		hit, matched := pickChangelogEntry(entries, version)
		if !matched {
			t.Fatalf("版本 %q 应命中", version)
		}
		if hit.Version != "v26.09.11.muw.6" {
			t.Fatalf("版本 %q 命中了错误的段落: %q", version, hit.Version)
		}
	}
}

// 内置更新日志的源文件在 Windows 检出下是 CRLF，分段与正文解析必须照常。
func TestParseChangelogWithCRLF(t *testing.T) {
	entries := parseChangelog(strings.ReplaceAll(changelogFixture, "\n", "\r\n"))
	if len(entries) != 3 {
		t.Fatalf("CRLF 下期望 3 段，实际 %d 段", len(entries))
	}
	if entries[0].Version != "v26.09.11.muw.6" || entries[0].Date != "2026-09-11" {
		t.Fatalf("CRLF 下第一段版本/日期解析错误: %+v", entries[0])
	}
	if !strings.Contains(entries[0].Body, "甲条目") || strings.Contains(entries[0].Body, "\r") {
		t.Fatalf("CRLF 下第一段正文异常: %q", entries[0].Body)
	}
	if strings.Contains(entries[0].Body, "\n\n\n") {
		t.Fatalf("CRLF 下正文换行异常: %q", entries[0].Body)
	}
}
