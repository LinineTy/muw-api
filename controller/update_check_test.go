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

// manifestServer 起一个同时提供 update.json 与 notes.md 的假更新源。
func manifestServer(t *testing.T, manifestBody string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/update.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(manifestBody))
	})
	mux.HandleFunc("/notes.md", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("### 更新源\n- 改成读发布清单\n"))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestFetchReleaseManifest(t *testing.T) {
	// 多出来的字段（released_at/commit/未来字段）一律忽略。
	srv := manifestServer(t, `{"version":"v26.09.13.muw.15","released_at":"2026-09-13T02:40:00Z","commit":"614daeae7","min_supported_version":"v26.09.01.muw.1"}`)
	version, err := fetchReleaseManifest(context.Background(), srv.URL+"/update.json")
	require.NoError(t, err)
	assert.Equal(t, "v26.09.13.muw.15", version)

	// 没有 version 字段 → 报错（交给上层按"无更新"处理，不误报）。
	empty := manifestServer(t, `{"released_at":"2026-09-13T02:40:00Z"}`)
	_, err = fetchReleaseManifest(context.Background(), empty.URL+"/update.json")
	assert.Error(t, err)

	// 源不可达 → 报错。
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(down.Close)
	_, err = fetchReleaseManifest(context.Background(), down.URL+"/update.json")
	assert.Error(t, err)
}

func TestGetUpdateCheckUsesManifest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := manifestServer(t, `{"version":"v26.09.13.muw.15"}`)
	t.Setenv("UPDATE_CHECK_URL", srv.URL+"/update.json")
	t.Setenv("UPDATE_CHECK_NOTES_URL", srv.URL+"/notes.md")

	previous := common.Version
	t.Cleanup(func() { common.Version = previous })

	callUpdateCheck := func(t *testing.T, current string) (bool, string, string) {
		t.Helper()
		common.Version = current
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
				CurrentVersion  string `json:"current_version"`
				LatestChangelog string `json:"latest_changelog"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.True(t, response.Success, response.Message)
		return response.Data.HasUpdate, response.Data.LatestTag, response.Data.LatestChangelog
	}

	// 旧版本部署 → 提示更新，并带上该版说明正文。
	hasUpdate, latestTag, changelog := callUpdateCheck(t, "v26.09.13.muw.14")
	assert.True(t, hasUpdate)
	assert.Equal(t, "v26.09.13.muw.15", latestTag)
	assert.Contains(t, changelog, "改成读发布清单")

	// 同版本 → 不提示更新（说明也不拉）。
	hasUpdate, _, changelog = callUpdateCheck(t, "v26.09.13.muw.15")
	assert.False(t, hasUpdate)
	assert.Empty(t, changelog)

	// 清单里出现日期制版本，而当前是旧 semver 体系 → 提示升级到新体系。
	hasUpdate, _, _ = callUpdateCheck(t, "v1.0.0-rc.24-muw.1")
	assert.True(t, hasUpdate)
}
