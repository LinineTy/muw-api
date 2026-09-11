// @muw-owned
package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
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

// 多账户轮询：绑两个账户时轮询在两个账户之间接力（用法对齐多 key）；
// 账户被全局禁用/账户内 key 全废时自动跳过；全不可用才报"无可用 key"。
func TestMultiAccountRotationSkipsUnavailable(t *testing.T) {
	setupChannelAccountTestDB(t)
	ch := &Channel{Name: "multi", Key: "k", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(ch).Error)
	a1 := newTestAccount(t, "rotate-a1")
	a2 := newTestAccount(t, "rotate-a2")

	require.NoError(t, ReplaceChannelAccountBindings(ch.Id, []int{a1.Id, a2.Id}))
	ch.loadBoundAccounts()
	require.Len(t, ch.BoundAccounts, 2)

	key1, _, err1 := ch.GetNextEnabledKey()
	key2, _, err2 := ch.GetNextEnabledKey()
	require.Nil(t, err1)
	require.Nil(t, err2)
	assert.Equal(t, "sk-rotate-a1", key1)
	assert.Equal(t, "sk-rotate-a2", key2, "第二次应轮到第二个账户")
	key3, _, _ := ch.GetNextEnabledKey()
	assert.Equal(t, "sk-rotate-a1", key3, "第三次回到第一个账户")

	// a1 全局禁用 → 始终落到 a2
	require.NoError(t, DB.Model(&Account{}).Where("id = ?", a1.Id).Update("status", common.ChannelStatusAutoDisabled).Error)
	ch.loadBoundAccounts()
	require.Len(t, ch.BoundAccounts, 2, "挂载包含全部启用绑定，账户级可用性在选路时判定")
	for i := 0; i < 3; i++ {
		keyLoop, _, apiErrLoop := ch.GetNextEnabledKey()
		require.Nil(t, apiErrLoop)
		assert.Equal(t, "sk-rotate-a2", keyLoop)
	}

	// a2 也禁用 → 无可用 key（调用方据此处置渠道）
	require.NoError(t, DB.Model(&Account{}).Where("id = ?", a2.Id).Update("status", common.ChannelStatusAutoDisabled).Error)
	ch.loadBoundAccounts()
	_, _, apiErr := ch.GetNextEnabledKey()
	require.NotNil(t, apiErr, "绑定的账户全不可用时应报无可用 key")
	assert.Equal(t, types.ErrorCodeChannelNoAvailableKey, apiErr.GetErrorCode())

	// 渠道内停用 a2（绑定 enabled=false）→ 只剩 a1；a1 恢复后应正常取到 key
	require.NoError(t, DB.Model(&Account{}).Where("id = ?", a1.Id).Update("status", common.ChannelStatusEnabled).Error)
	require.NoError(t, DB.Model(&ChannelAccount{}).
		Where("channel_id = ? AND account_id = ?", ch.Id, a2.Id).Update("enabled", false).Error)
	ch.loadBoundAccounts()
	require.Len(t, ch.BoundAccounts, 1)
	keyTail, _, apiErrTail := ch.GetNextEnabledKey()
	require.Nil(t, apiErrTail)
	assert.Equal(t, "sk-rotate-a1", keyTail)
}

// 渠道可用账户判定（套餐自动启停"是否连渠道一起禁"的依据）。
func TestHasUsableBoundAccount(t *testing.T) {
	setupChannelAccountTestDB(t)
	ch := &Channel{Name: "usable", Key: "k", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(ch).Error)
	a1 := newTestAccount(t, "u1")
	a2 := newTestAccount(t, "u2")
	require.NoError(t, ReplaceChannelAccountBindings(ch.Id, []int{a1.Id, a2.Id}))

	usable, err := HasUsableBoundAccount(ch.Id)
	require.NoError(t, err)
	assert.True(t, usable)

	require.NoError(t, DB.Model(&Account{}).Where("id = ?", a1.Id).Update("status", common.ChannelStatusAutoDisabled).Error)
	usable, err = HasUsableBoundAccount(ch.Id)
	require.NoError(t, err)
	assert.True(t, usable, "还有第二个账户可用")

	require.NoError(t, DB.Model(&Account{}).Where("id = ?", a2.Id).Update("status", common.ChannelStatusAutoDisabled).Error)
	usable, err = HasUsableBoundAccount(ch.Id)
	require.NoError(t, err)
	assert.False(t, usable, "绑定的账户全不可用")
}

// 允许空密钥的渠道（OpenCode Zen 免费套餐）挂上"空 key 账户"后必须还能选到 key——
// 空 key 是合法凭证，不能被当成"没可用 key"跳过（否则一启用就报 no available account keys）。
func TestGetNextKeyAcrossAccountsAllowsEmptyKeyForOpenCodeZen(t *testing.T) {
	setupChannelAccountTestDB(t)
	acc := &Account{
		Name:        "zen-free",
		Type:        constant.ChannelTypeOpenCodeZen,
		Status:      common.ChannelStatusEnabled,
		Key:         "",
		CreatedTime: common.GetTimestamp(),
	}
	ch := &Channel{
		Id:            101,
		Name:          "zen",
		Type:          constant.ChannelTypeOpenCodeZen,
		Status:        common.ChannelStatusEnabled,
		BoundAccounts: []*Account{acc},
	}
	key, _, apiErr := ch.getNextKeyAcrossAccounts()
	require.Nil(t, apiErr, "空密钥渠道不该报 no available account keys")
	assert.Equal(t, "", key)
}

// 其它类型仍然跳过空 key（空 key 会被上游拒绝，等同于"没有可用 key"）。
func TestGetNextKeyAcrossAccountsSkipsEmptyKeyForOtherTypes(t *testing.T) {
	setupChannelAccountTestDB(t)
	acc := &Account{
		Name:        "oai-empty",
		Type:        constant.ChannelTypeOpenAI,
		Status:      common.ChannelStatusEnabled,
		Key:         "",
		CreatedTime: common.GetTimestamp(),
	}
	ch := &Channel{
		Id:            102,
		Name:          "oai",
		Type:          constant.ChannelTypeOpenAI,
		Status:        common.ChannelStatusEnabled,
		BoundAccounts: []*Account{acc},
	}
	_, _, apiErr := ch.getNextKeyAcrossAccounts()
	require.NotNil(t, apiErr)
}
