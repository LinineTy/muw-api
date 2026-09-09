package model

import (
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/require"
)

// 布尔开关的键名有两批后缀:三个限流开关是 *Enable(结尾 "Enable"),其余布尔开关
// 是 *Enabled(结尾 "Enabled",并不以 "Enable" 结尾)。两批都必须映射到 typed 变量:
// 只判 "Enabled" 会漏掉限流开关(设置页改了只写库、运行时永不生效),只判 "Enable"
// 会漏掉所有 *Enabled 开关(2026-09-10 实测踩过)。
func TestUpdateOptionMapAppliesBooleanSwitchSuffixes(t *testing.T) {
	previousMap := common.OptionMap
	previousValues := map[string]bool{
		"PasswordRegisterEnabled":   common.PasswordRegisterEnabled,
		"InviteCodeRegisterEnabled": common.InviteCodeRegisterEnabled,
		"CriticalRateLimitEnable":   common.CriticalRateLimitEnable,
		"GlobalApiRateLimitEnable":  common.GlobalApiRateLimitEnable,
		"GlobalWebRateLimitEnable":  common.GlobalWebRateLimitEnable,
	}
	t.Cleanup(func() {
		common.OptionMap = previousMap
		common.PasswordRegisterEnabled = previousValues["PasswordRegisterEnabled"]
		common.InviteCodeRegisterEnabled = previousValues["InviteCodeRegisterEnabled"]
		common.CriticalRateLimitEnable = previousValues["CriticalRateLimitEnable"]
		common.GlobalApiRateLimitEnable = previousValues["GlobalApiRateLimitEnable"]
		common.GlobalWebRateLimitEnable = previousValues["GlobalWebRateLimitEnable"]
	})
	common.OptionMap = map[string]string{}

	cases := []struct {
		key  string
		read func() bool
	}{
		{"PasswordRegisterEnabled", func() bool { return common.PasswordRegisterEnabled }},
		{"InviteCodeRegisterEnabled", func() bool { return common.InviteCodeRegisterEnabled }},
		{"CriticalRateLimitEnable", func() bool { return common.CriticalRateLimitEnable }},
		{"GlobalApiRateLimitEnable", func() bool { return common.GlobalApiRateLimitEnable }},
		{"GlobalWebRateLimitEnable", func() bool { return common.GlobalWebRateLimitEnable }},
	}
	for _, tc := range cases {
		want := !tc.read()
		require.NoError(t, updateOptionMap(tc.key, strconv.FormatBool(want)))
		require.Equal(t, want, tc.read(), tc.key)
	}
}
