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
package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestChannelModelSettingDisabledModelExcludedFromAbilities 保护「渠道内模型级禁用」
// 的核心契约：被禁用的模型不进入选路（abilities.enabled=false），其余模型不受影响。
func TestChannelModelSettingDisabledModelExcludedFromAbilities(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&ChannelModelSetting{}))

	ch := &Channel{
		Type:   1,
		Name:   "test-disabled-model",
		Models: "gpt-4o,gpt-4o-mini,gpt-3.5-turbo",
		Group:  "default",
		Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, DB.Create(ch).Error)

	// 禁用 gpt-4o-mini。ChannelId 故意留 0 模拟前端提交（前端不带 channel_id），
	// Upsert 必须强制归一到 ch.Id，否则会写入 (channel_id=0, model) 导致禁用不生效。
	require.NoError(t, UpsertChannelModelSettings(ch.Id, []ChannelModelSetting{
		{Model: "gpt-4o-mini", Enabled: false},
	}))
	require.NoError(t, ch.AddAbilities(nil))

	assertAbilityEnabled(t, ch.Id, "gpt-4o", true)
	assertAbilityEnabled(t, ch.Id, "gpt-4o-mini", false)
	assertAbilityEnabled(t, ch.Id, "gpt-3.5-turbo", true)

	// 渠道整体启用不应抹掉模型级禁用（ReapplyDisabledModels 恢复）
	require.NoError(t, UpdateAbilityStatus(ch.Id, false))
	require.NoError(t, UpdateAbilityStatus(ch.Id, true))
	assertAbilityEnabled(t, ch.Id, "gpt-4o", true)
	assertAbilityEnabled(t, ch.Id, "gpt-4o-mini", false)
}

// TestChannelModelSettingCleanupRemovesStaleRows 保护「渠道改 models 后清理失效设置行」：
// 从 models 移除的模型，其设置行被删除，不再残留禁用态。
func TestChannelModelSettingCleanupRemovesStaleRows(t *testing.T) {
	ch := &Channel{
		Type:   1,
		Name:   "test-cleanup-settings",
		Models: "gpt-4o,gpt-4o-mini",
		Group:  "default",
		Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, DB.Create(ch).Error)
	require.NoError(t, UpsertChannelModelSettings(ch.Id, []ChannelModelSetting{
		{ChannelId: ch.Id, Model: "gpt-4o", Enabled: false},
		{ChannelId: ch.Id, Model: "gpt-4o-mini", Enabled: false},
	}))

	// 移除 gpt-4o-mini：其设置行应被清理，gpt-4o 保留
	require.NoError(t, CleanupStaleChannelModelSettings(ch.Id, []string{"gpt-4o"}))

	settings, err := GetChannelModelSettings(ch.Id)
	require.NoError(t, err)
	require.Len(t, settings, 1)
	assert.Equal(t, "gpt-4o", settings[0].Model)
	assert.False(t, settings[0].Enabled)
}

// TestChannelModelContextWindowOverride 保护「渠道级 context_window 覆盖」读取。
func TestChannelModelContextWindowOverride(t *testing.T) {
	ch := &Channel{
		Type:   1,
		Name:   "test-context-override",
		Models: "gpt-4o",
		Group:  "default",
		Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, DB.Create(ch).Error)
	cw := 128000
	require.NoError(t, UpsertChannelModelSettings(ch.Id, []ChannelModelSetting{
		{ChannelId: ch.Id, Model: "gpt-4o", ContextWindow: &cw},
	}))

	// 无覆盖的模型返回 (0, false)
	got, ok := ChannelModelContextWindow(ch.Id, "other-model")
	assert.False(t, ok)
	assert.Zero(t, got)

	got, ok = ChannelModelContextWindow(ch.Id, "gpt-4o")
	assert.True(t, ok)
	assert.Equal(t, 128000, got)
}

func assertAbilityEnabled(t *testing.T, channelId int, model string, want bool) {
	t.Helper()
	var a Ability
	require.NoError(t, DB.Where("channel_id = ? AND model = ?", channelId, model).First(&a).Error)
	assert.Equal(t, want, a.Enabled, "model %s enabled mismatch", model)
}
