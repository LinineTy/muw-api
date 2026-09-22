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
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseForkVersion(t *testing.T) {
	// 标准 fork 版本号解析成可比数组 [X, Y, Z, 稳定度, rc, muw]。
	assert.Equal(t, []int{1, 1, 0, 0, 0, 24, 1}, parseForkVersion("v1.0.0-rc.24-muw.1"))
	assert.Equal(t, []int{1, 1, 0, 0, 0, 23, 5}, parseForkVersion("v1.0.0-rc.23-muw.5"))
	// 历史误标的杂后缀(.ts)忽略,不影响比较。
	assert.Equal(t, []int{1, 1, 0, 0, 0, 23, 3}, parseForkVersion("v1.0.0-rc.23-muw.3.ts"))
	// 无 rc 段视为正式版(稳定度=1);无 muw 段视为 muw.0。
	assert.Equal(t, []int{1, 1, 0, 0, 1, 0, 0}, parseForkVersion("v1.0.0"))
	assert.Equal(t, []int{1, 1, 0, 0, 0, 24, 0}, parseForkVersion("v1.0.0-rc.24"))

	// 日期制版本:epoch=2,后跟 YY.MM.DD + muw 号。
	assert.Equal(t, []int{2, 26, 8, 14, 1}, parseForkVersion("v26.08.14.muw.1"))
	assert.Equal(t, []int{2, 26, 8, 14, 0}, parseForkVersion("v26.08.14"))
	assert.Equal(t, []int{2, 26, 1, 1, 5}, parseForkVersion("v26.01.01-muw.5"))

	// 非版本 tag / 乱串解析失败,更新检查据此跳过。
	assert.Nil(t, parseForkVersion("latest"))
	assert.Nil(t, parseForkVersion("abc"))
	assert.Nil(t, parseForkVersion(""))
}

func TestCompareForkVersions(t *testing.T) {
	// rc 号优先,其次 muw 号。
	assert.True(t, compareForkVersions(
		parseForkVersion("v1.0.0-rc.24-muw.1"),
		parseForkVersion("v1.0.0-rc.23-muw.5"),
	) > 0)
	// 同 rc 比 muw;杂后缀不影响。
	assert.True(t, compareForkVersions(
		parseForkVersion("v1.0.0-rc.23-muw.5"),
		parseForkVersion("v1.0.0-rc.23-muw.3.ts"),
	) > 0)
	// 同 rc 无 muw(上游风格)视为旧于有 muw 的 fork 版本。
	assert.True(t, compareForkVersions(
		parseForkVersion("v1.0.0-rc.24-muw.1"),
		parseForkVersion("v1.0.0-rc.24"),
	) > 0)
	// 主版本优先。
	assert.True(t, compareForkVersions(
		parseForkVersion("v2.0.0-rc.1-muw.1"),
		parseForkVersion("v1.9.9-rc.99-muw.99"),
	) > 0)
	// 相同版本相等。
	require.NotNil(t, parseForkVersion("v1.0.0-rc.24-muw.1"))
	assert.Equal(t, 0, compareForkVersions(
		parseForkVersion("v1.0.0-rc.24-muw.1"),
		parseForkVersion("v1.0.0-rc.24-muw.1"),
	))

	// 日期制恒大于旧格式:旧版本号部署一律提示更新到新体系。
	assert.True(t, compareForkVersions(
		parseForkVersion("v26.08.14.muw.1"),
		parseForkVersion("v1.0.0-rc.99-muw.99"),
	) > 0)
	// 日期制之间按日期优先、同日期按 muw 号。
	assert.True(t, compareForkVersions(
		parseForkVersion("v26.08.15.muw.1"),
		parseForkVersion("v26.08.14.muw.99"),
	) > 0)
	assert.True(t, compareForkVersions(
		parseForkVersion("v26.08.14.muw.2"),
		parseForkVersion("v26.08.14.muw.1"),
	) > 0)
}

// releasesServer 起一个假更新源:路径 /releases 返回 Gitea releases 风格的 JSON 数组。
func releasesServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// twoChannelReleases 一条 dev(prerelease) + 一条 stable(非 prerelease)，顺序:新的在前。
const twoChannelReleases = `[
	{"tag_name": "v26.09.13.muw.15", "body": "### 开发版说明\n- 开发版内容\n", "prerelease": true, "draft": false},
	{"tag_name": "v26.08.20.muw.1", "body": "### 稳定版说明\n- 稳定版内容\n", "prerelease": false, "draft": false}
]`

func TestFetchReleases(t *testing.T) {
	// 多出来的字段(未来扩展)一律忽略。
	srv := releasesServer(t, twoChannelReleases)
	items, err := fetchReleases(context.Background(), srv.URL+"/releases", 1<<20)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.Equal(t, "v26.09.13.muw.15", items[0].TagName)
	assert.True(t, items[0].Prerelease)
	assert.Contains(t, items[0].Body, "开发版内容")
	assert.False(t, items[1].Prerelease)

	// 内容不是合法 JSON → 报错。
	broken := releasesServer(t, `{not json`)
	_, err = fetchReleases(context.Background(), broken.URL+"/releases", 1<<20)
	assert.Error(t, err)

	// 源不可达 → 报错。
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(down.Close)
	_, err = fetchReleases(context.Background(), down.URL+"/releases", 1<<20)
	assert.Error(t, err)
}

func TestPickRelease(t *testing.T) {
	items, err := fetchReleases(context.Background(),
		releasesServer(t, twoChannelReleases).URL+"/releases", 1<<20)
	require.NoError(t, err)

	// dev 通道(含 prerelease):取版本号最大的,说明跟着它走。
	tag, body, ok := pickRelease(items, true)
	require.True(t, ok)
	assert.Equal(t, "v26.09.13.muw.15", tag)
	assert.Contains(t, body, "开发版内容")

	// stable 通道(只要非 prerelease):跳过 prerelease。
	tag, body, ok = pickRelease(items, false)
	require.True(t, ok)
	assert.Equal(t, "v26.08.20.muw.1", tag)
	assert.Contains(t, body, "稳定版内容")

	// 顺序无关:故意倒序(老版本在前)仍取版本号最大的那个 —— 补发老稳定版 release
	// 绝不会让 stable 通道回退。
	reversed := []giteaReleaseItem{
		{TagName: "v26.08.20.muw.1", Body: "old"},
		{TagName: "v26.08.14.muw.1", Body: "older"},
	}
	tag, _, ok = pickRelease(reversed, false)
	require.True(t, ok)
	assert.Equal(t, "v26.08.20.muw.1", tag)

	// draft 跳过;解析不出格式的 tag(上游 latest 之类)跳过。
	mixed := []giteaReleaseItem{
		{TagName: "latest", Body: "x"},
		{TagName: "v26.09.20.muw.1", Body: "draft", Draft: true},
		{TagName: "v26.09.15.muw.1", Body: "real", Prerelease: true},
	}
	tag, body, ok = pickRelease(mixed, true)
	require.True(t, ok)
	assert.Equal(t, "v26.09.15.muw.1", tag)
	assert.Equal(t, "real", body)

	// 只有 prerelease 时,stable 通道挑不出来(上层报错,不误报有更新)。
	onlyPre := []giteaReleaseItem{{TagName: "v26.09.15.muw.1", Prerelease: true}}
	_, _, ok = pickRelease(onlyPre, false)
	assert.False(t, ok)

	// 空列表同样挑不出来。
	_, _, ok = pickRelease(nil, true)
	assert.False(t, ok)
}

func TestGetUpdateCheckChannelSwitch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := releasesServer(t, twoChannelReleases)
	t.Setenv("UPDATE_CHECK_RELEASES_URL", srv.URL+"/releases")

	previous := common.Version
	previousDev := operation_setting.UpdateCheckDevChannelEnabled
	t.Cleanup(func() {
		common.Version = previous
		operation_setting.UpdateCheckDevChannelEnabled = previousDev
	})

	call := func(t *testing.T, current string, devChannel bool) (bool, string, string, string) {
		t.Helper()
		common.Version = current
		operation_setting.UpdateCheckDevChannelEnabled = devChannel
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/status/update-check", nil)
		GetUpdateCheck(ctx)

		var response struct {
			Success bool   `json:"success"`
			Message string `json:"message"`
			Data    struct {
				HasUpdate       bool   `json:"has_update"`
				LatestTag       string `json:"latest_tag"`
				Channel         string `json:"channel"`
				LatestChangelog string `json:"latest_changelog"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.True(t, response.Success, response.Message)
		return response.Data.HasUpdate, response.Data.LatestTag,
			response.Data.Channel, response.Data.LatestChangelog
	}

	// 开关关(默认):比 stable —— 当前版本 (09-12) 比稳定版 (08-20) 新 ⇒ 无更新。
	hasUpdate, latestTag, channel, _ := call(t, "v26.09.12.muw.14", false)
	assert.Equal(t, "stable", channel)
	assert.Equal(t, "v26.08.20.muw.1", latestTag)
	assert.False(t, hasUpdate)

	// 比稳定版老的部署(旧 semver)→ 提示升级到稳定版,并带稳定版说明(release body)。
	hasUpdate, latestTag, channel, changelog := call(t, "v1.0.0-rc.24-muw.1", false)
	assert.True(t, hasUpdate)
	assert.Equal(t, "v26.08.20.muw.1", latestTag)
	assert.Equal(t, "stable", channel)
	assert.Contains(t, changelog, "稳定版内容")

	// 开关开:比 dev —— 当前 09-12 落后于 dev 09-13 ⇒ 提示更新,说明取 dev 的。
	hasUpdate, latestTag, channel, changelog = call(t, "v26.09.12.muw.14", true)
	assert.True(t, hasUpdate)
	assert.Equal(t, "v26.09.13.muw.15", latestTag)
	assert.Equal(t, "dev", channel)
	assert.Contains(t, changelog, "开发版内容")

	// 开关开但已经是最新 dev ⇒ 无更新,也不带说明。
	hasUpdate, _, channel, changelog = call(t, "v26.09.13.muw.15", true)
	assert.False(t, hasUpdate)
	assert.Equal(t, "dev", channel)
	assert.Empty(t, changelog)

	// 源里全是 prerelease ⇒ stable 通道挑不出来,明确报错(不静默当成"无更新")。
	onlyPre := releasesServer(t, `[{"tag_name":"v26.09.15.muw.1","body":"x","prerelease":true,"draft":false}]`)
	t.Setenv("UPDATE_CHECK_RELEASES_URL", onlyPre.URL+"/releases")
	common.Version = "v26.09.12.muw.14"
	operation_setting.UpdateCheckDevChannelEnabled = false
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/status/update-check", nil)
	GetUpdateCheck(ctx)
	var failed struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &failed))
	assert.False(t, failed.Success)
	assert.Contains(t, failed.Message, "stable")
}
