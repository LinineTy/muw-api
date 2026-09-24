package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

// 回归：激活防护这几个 option 必须真的写进运行时变量。
//
// 曾经踩过的坑：`InviteTrapGraceSeconds` / `PoWChallengeBits` 被放进了 updateOptionMap 里
// “键以 Enabled/Enable 结尾”的布尔分支 —— 两个键都不满足该前缀条件，于是**设置页/接口保存
// 只写库、运行时永远不生效**（表现=改了没反应，且因为默认值恰好等于常用值而被忽略很久）。
// 所以这里逐个键断言"改了就生效"，而不是只看默认值。
func TestActivationGuardOptionsApplyToRuntime(t *testing.T) {
	prevBits, prevGrace, prevHoneypot := common.ActivationPoWBits, common.InviteTrapGraceSeconds, common.ActivationHoneypotEnabled
	prevMap := common.OptionMap
	common.OptionMap = map[string]string{}
	defer func() {
		common.ActivationPoWBits, common.InviteTrapGraceSeconds, common.ActivationHoneypotEnabled = prevBits, prevGrace, prevHoneypot
		common.OptionMap = prevMap
	}()

	if err := updateOptionMap("PoWChallengeBits", "0"); err != nil {
		t.Fatalf("写入 PoWChallengeBits 失败：%v", err)
	}
	if common.ActivationPoWBits != 0 || common.ActivationPoWBitsEffective() != 0 {
		t.Errorf("PoWChallengeBits=0 应关掉校验，实际 bits=%d effective=%d", common.ActivationPoWBits, common.ActivationPoWBitsEffective())
	}

	if err := updateOptionMap("PoWChallengeBits", "22"); err != nil {
		t.Fatalf("写入 PoWChallengeBits 失败：%v", err)
	}
	if common.ActivationPoWBitsEffective() != 22 {
		t.Errorf("PoWChallengeBits=22 应生效，实际 %d", common.ActivationPoWBitsEffective())
	}
	// 超过上限按上限生效
	if err := updateOptionMap("PoWChallengeBits", "40"); err != nil {
		t.Fatalf("写入 PoWChallengeBits 失败：%v", err)
	}
	if common.ActivationPoWBitsEffective() != common.MaxActivationPoWBits {
		t.Errorf("超过上限应夹到 %d，实际 %d", common.MaxActivationPoWBits, common.ActivationPoWBitsEffective())
	}

	if err := updateOptionMap("InviteTrapGraceSeconds", "300"); err != nil {
		t.Fatalf("写入 InviteTrapGraceSeconds 失败：%v", err)
	}
	if common.InviteTrapGraceWindow() != 300 {
		t.Errorf("InviteTrapGraceSeconds=300 应生效，实际 %d", common.InviteTrapGraceWindow())
	}
	// 低于下限取下限
	if err := updateOptionMap("InviteTrapGraceSeconds", "10"); err != nil {
		t.Fatalf("写入 InviteTrapGraceSeconds 失败：%v", err)
	}
	if common.InviteTrapGraceWindow() != common.MinInviteTrapGraceSeconds {
		t.Errorf("低于下限应取 %d，实际 %d", common.MinInviteTrapGraceSeconds, common.InviteTrapGraceWindow())
	}

	if err := updateOptionMap("ActivationHoneypotEnabled", "false"); err != nil {
		t.Fatalf("写入 ActivationHoneypotEnabled 失败：%v", err)
	}
	if common.ActivationHoneypotEnabled {
		t.Error("ActivationHoneypotEnabled=false 应生效")
	}
}
