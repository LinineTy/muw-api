// @muw-owned
package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupChannelAccountTestDB(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Account{}, &Channel{}, &Ability{}, &ChannelModelSetting{}, &ChannelAccount{}))
	for _, model := range []any{&ChannelAccount{}, &Channel{}, &Account{}, &Ability{}, &ChannelModelSetting{}} {
		require.NoError(t, DB.Where("1 = 1").Delete(model).Error)
	}
}

func newTestAccount(t *testing.T, name string) *Account {
	t.Helper()
	acc := &Account{
		Name:        name,
		Type:        1,
		Status:      common.ChannelStatusEnabled,
		Key:         "sk-" + name,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(acc).Error)
	return acc
}

// BindChannelAccountWithDB 必须幂等：重复绑定只更新轮询顺序，不产生第二条记录。
func TestBindChannelAccountIdempotent(t *testing.T) {
	setupChannelAccountTestDB(t)
	ch := &Channel{Name: "c1", Key: "k", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(ch).Error)
	acc := newTestAccount(t, "a1")

	require.NoError(t, BindChannelAccountWithDB(DB, ch.Id, acc.Id, 0))
	require.NoError(t, BindChannelAccountWithDB(DB, ch.Id, acc.Id, 3))

	var count int64
	require.NoError(t, DB.Model(&ChannelAccount{}).Where("channel_id = ?", ch.Id).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	bindings, err := GetChannelAccountBindings(ch.Id)
	require.NoError(t, err)
	require.Len(t, bindings, 1)
	assert.Equal(t, 3, bindings[0].AccountOrder)
	assert.True(t, bindings[0].Enabled)
}

// ReplaceChannelAccountBindings：新增/重排/删除三件事，且保留已有绑定的 enabled 状态。
func TestReplaceChannelAccountBindings(t *testing.T) {
	setupChannelAccountTestDB(t)
	ch := &Channel{Name: "c1", Key: "k", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(ch).Error)
	a1 := newTestAccount(t, "a1")
	a2 := newTestAccount(t, "a2")
	a3 := newTestAccount(t, "a3")

	require.NoError(t, ReplaceChannelAccountBindings(ch.Id, []int{a1.Id, a2.Id}))
	// 渠道内停用 a2（(渠道,账户) 维度状态，重排时必须保住）
	require.NoError(t, DB.Model(&ChannelAccount{}).
		Where("channel_id = ? AND account_id = ?", ch.Id, a2.Id).Update("enabled", false).Error)

	// 重排成 a2, a1 并新增 a3（顺序即轮询顺序）
	require.NoError(t, ReplaceChannelAccountBindings(ch.Id, []int{a2.Id, a1.Id, a3.Id}))

	bindings, err := GetChannelAccountBindings(ch.Id)
	require.NoError(t, err)
	require.Len(t, bindings, 3)
	assert.Equal(t, []int{a2.Id, a1.Id, a3.Id}, []int{bindings[0].AccountId, bindings[1].AccountId, bindings[2].AccountId})
	assert.False(t, bindings[0].Enabled, "停用状态必须保留")
	assert.True(t, bindings[1].Enabled)
	assert.Equal(t, []int{0, 1, 2}, []int{bindings[0].AccountOrder, bindings[1].AccountOrder, bindings[2].AccountOrder})

	// 删掉 a1
	require.NoError(t, ReplaceChannelAccountBindings(ch.Id, []int{a2.Id, a3.Id}))
	bindings, err = GetChannelAccountBindings(ch.Id)
	require.NoError(t, err)
	require.Len(t, bindings, 2)
	assert.Equal(t, []int{a2.Id, a3.Id}, []int{bindings[0].AccountId, bindings[1].AccountId})
}

// 主账户解析：跳过渠道内停用的账户、跳过全局禁用的账户，顺序按 account_order。
func TestPrimaryBoundAccountIdSkipsDisabled(t *testing.T) {
	setupChannelAccountTestDB(t)
	ch := &Channel{Name: "c1", Key: "k", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(ch).Error)
	a1 := newTestAccount(t, "a1")
	a2 := newTestAccount(t, "a2")
	a3 := newTestAccount(t, "a3")

	require.NoError(t, ReplaceChannelAccountBindings(ch.Id, []int{a1.Id, a2.Id, a3.Id}))

	id, err := GetPrimaryBoundAccountId(ch.Id)
	require.NoError(t, err)
	assert.Equal(t, a1.Id, id)

	// 渠道内停用 a1 → 轮到 a2
	require.NoError(t, DB.Model(&ChannelAccount{}).
		Where("channel_id = ? AND account_id = ?", ch.Id, a1.Id).Update("enabled", false).Error)
	id, err = GetPrimaryBoundAccountId(ch.Id)
	require.NoError(t, err)
	assert.Equal(t, a2.Id, id)

	// a2 全局禁用 → 轮到 a3
	require.NoError(t, DB.Model(&Account{}).Where("id = ?", a2.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	id, err = GetPrimaryBoundAccountId(ch.Id)
	require.NoError(t, err)
	assert.Equal(t, a3.Id, id)

	// 全部不可用 → 回落到 channels.account_id（迁移过渡期的兜底）
	require.NoError(t, DB.Model(&Account{}).Where("id = ?", a3.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", ch.Id).Update("account_id", a3.Id).Error)
	id, err = GetPrimaryBoundAccountId(ch.Id)
	require.NoError(t, err)
	assert.Equal(t, a3.Id, id)
}

// 存量回填：channels.account_id → 一条 order=0 的绑定，幂等。
func TestEnsureChannelAccountBindingsBackfill(t *testing.T) {
	setupChannelAccountTestDB(t)
	acc := newTestAccount(t, "legacy")
	ch := &Channel{Name: "c-legacy", Key: "k", Status: common.ChannelStatusEnabled, AccountId: acc.Id}
	require.NoError(t, DB.Create(ch).Error)

	require.NoError(t, ensureChannelAccountBindings(DB))
	bindings, err := GetChannelAccountBindings(ch.Id)
	require.NoError(t, err)
	require.Len(t, bindings, 1)
	assert.Equal(t, acc.Id, bindings[0].AccountId)
	assert.True(t, bindings[0].Enabled)

	// 幂等：再跑一次不新增
	require.NoError(t, ensureChannelAccountBindings(DB))
	bindings, err = GetChannelAccountBindings(ch.Id)
	require.NoError(t, err)
	assert.Len(t, bindings, 1)
}

// 双写收敛：无绑定→建；单绑定换账户→替换（保留 order/enabled）；多绑定→不动作。
func TestSyncPrimaryBindingFromChannelColumn(t *testing.T) {
	setupChannelAccountTestDB(t)
	ch := &Channel{Name: "c1", Key: "k", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(ch).Error)
	a1 := newTestAccount(t, "a1")
	a2 := newTestAccount(t, "a2")
	a3 := newTestAccount(t, "a3")

	// ① 无绑定 → 建
	require.NoError(t, syncPrimaryBindingFromChannelColumn(ch.Id, a1.Id))
	bindings, err := GetChannelAccountBindings(ch.Id)
	require.NoError(t, err)
	require.Len(t, bindings, 1)
	assert.Equal(t, a1.Id, bindings[0].AccountId)

	// ② 单绑定换账户 → 替换，保留 enabled=false
	require.NoError(t, DB.Model(&ChannelAccount{}).Where("channel_id = ?", ch.Id).Update("enabled", false).Error)
	require.NoError(t, syncPrimaryBindingFromChannelColumn(ch.Id, a2.Id))
	bindings, err = GetChannelAccountBindings(ch.Id)
	require.NoError(t, err)
	require.Len(t, bindings, 1)
	assert.Equal(t, a2.Id, bindings[0].AccountId)
	assert.False(t, bindings[0].Enabled)

	// ③ 多绑定 → 不动（多账户配置不能被单值列误删）
	require.NoError(t, ReplaceChannelAccountBindings(ch.Id, []int{a2.Id, a3.Id}))
	require.NoError(t, syncPrimaryBindingFromChannelColumn(ch.Id, a1.Id))
	bindings, err = GetChannelAccountBindings(ch.Id)
	require.NoError(t, err)
	require.Len(t, bindings, 2)
	assert.Equal(t, []int{a2.Id, a3.Id}, []int{bindings[0].AccountId, bindings[1].AccountId})
}

// 反查：账户被哪些渠道引用（换绑/删除确认视图数据源）。
func TestGetChannelsBoundToAccount(t *testing.T) {
	setupChannelAccountTestDB(t)
	acc := newTestAccount(t, "shared")
	c1 := &Channel{Name: "c1", Key: "k", Status: common.ChannelStatusEnabled}
	c2 := &Channel{Name: "c2", Key: "k", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(c1).Error)
	require.NoError(t, DB.Create(c2).Error)

	require.NoError(t, BindChannelAccountWithDB(DB, c1.Id, acc.Id, 0))
	require.NoError(t, BindChannelAccountWithDB(DB, c2.Id, acc.Id, 0))

	channels, err := GetChannelsBoundToAccount(acc.Id)
	require.NoError(t, err)
	require.Len(t, channels, 2)
	assert.Equal(t, []int{c1.Id, c2.Id}, []int{channels[0].Id, channels[1].Id})

	count, err := CountChannelsBoundToAccount(acc.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 2, count)
}
