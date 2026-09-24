package model

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
)

// solveActivationPoW 单测里的小求解器：从 0 开始试 nonce（真实客户端同款循环）。
func solveActivationPoW(t *testing.T, challenge string, bits int) string {
	t.Helper()
	for nonce := 0; nonce < 5_000_000; nonce++ {
		candidate := strconv.Itoa(nonce)
		if VerifyActivationPoW(challenge, candidate, bits) {
			return candidate
		}
	}
	t.Fatalf("求解失败：challenge=%s bits=%d", challenge, bits)
	return ""
}

func TestCountLeadingZeroBits(t *testing.T) {
	cases := []struct {
		data []byte
		want int
	}{
		{[]byte{0x00}, 8},
		{[]byte{0x00, 0x00}, 16},
		{[]byte{0x80}, 0},
		{[]byte{0x0f}, 4},
		{[]byte{0x01}, 7},
		{[]byte{0x00, 0x10}, 11},
	}
	for _, c := range cases {
		if got := CountLeadingZeroBits(c.data); got != c.want {
			t.Errorf("CountLeadingZeroBits(%x) = %d, want %d", c.data, got, c.want)
		}
	}
}

func TestVerifyActivationPoW(t *testing.T) {
	challenge := "abcdef0123456789"
	const bits = 8
	nonce := solveActivationPoW(t, challenge, bits)
	if !VerifyActivationPoW(challenge, nonce, bits) {
		t.Fatalf("解出的 nonce %s 应当通过校验", nonce)
	}
	// 难度抬高后同一个 nonce 不应通过
	sum := sha256.Sum256([]byte(challenge + ":" + nonce))
	if CountLeadingZeroBits(sum[:]) < bits {
		t.Fatal("求解器返回的 nonce 不满足难度")
	}
	// 非法输入：非数字、空、超长
	for _, bad := range []string{"", "1a", "-1", " 1", "123456789012345678901"} {
		if VerifyActivationPoW(challenge, bad, bits) {
			t.Errorf("nonce %q 不该通过校验", bad)
		}
	}
	// 难度 0 / 空挑战：一律不通过（调用方本就该跳过）
	if VerifyActivationPoW("", nonce, bits) || VerifyActivationPoW(challenge, nonce, 0) {
		t.Error("空挑战或 bits=0 不该通过校验")
	}
}

func TestActivationPoWChallengeLifecycle(t *testing.T) {
	resetActivationPoWChallenges()
	challenge, err := IssueActivationPoWChallenge(42, "10.0.0.1", 8)
	if err != nil {
		t.Fatalf("签发挑战失败：%v", err)
	}
	if len(challenge.Challenge) != 48 || len(challenge.Id) != 32 {
		t.Errorf("挑战/ID 长度异常：%s / %s", challenge.Challenge, challenge.Id)
	}
	nonce := solveActivationPoW(t, challenge.Challenge, 8)

	// 换人使用：拒绝
	if err := ConsumeActivationPoWChallenge(challenge.Id, 43, nonce); err != ErrActivationPoWUserMismatch {
		t.Errorf("换人使用应被拒，实际 %v", err)
	}
	// 非数字 nonce：拒绝
	if err := ConsumeActivationPoWChallenge(challenge.Id, 42, "not-a-number"); err != ErrActivationPoWInvalidNonce {
		t.Errorf("非法 nonce 应被拒，实际 %v", err)
	}
	// 正确使用：通过
	if err := ConsumeActivationPoWChallenge(challenge.Id, 42, nonce); err != nil {
		t.Fatalf("正确 nonce 应当通过，实际 %v", err)
	}
	// 一次性：重复使用同一个挑战直接找不到
	if err := ConsumeActivationPoWChallenge(challenge.Id, 42, nonce); err != ErrActivationPoWNotFound {
		t.Errorf("重复使用应视为已失效，实际 %v", err)
	}
	// 不存在的挑战
	if err := ConsumeActivationPoWChallenge("deadbeef", 42, nonce); err != ErrActivationPoWNotFound {
		t.Errorf("不存在的挑战应返回 NotFound，实际 %v", err)
	}
}

func TestActivationPoWChallengeExpiry(t *testing.T) {
	resetActivationPoWChallenges()
	challenge, err := IssueActivationPoWChallenge(7, "10.0.0.2", 8)
	if err != nil {
		t.Fatalf("签发挑战失败：%v", err)
	}
	nonce := solveActivationPoW(t, challenge.Challenge, 8)

	// 手动把过期时间提前，验证过期分支与顺手清理
	activationPoWMu.Lock()
	activationPoWChallenges[challenge.Id].ExpireAt = activationPoWChallenges[challenge.Id].ExpireAt.Add(-ActivationPoWChallengeTTL - 1)
	activationPoWMu.Unlock()
	if err := ConsumeActivationPoWChallenge(challenge.Id, 7, nonce); err != ErrActivationPoWExpired {
		t.Errorf("过期挑战应返回 Expired，实际 %v", err)
	}
	if CountActivationPoWChallenges() != 0 {
		t.Errorf("过期挑战应被清理，剩余 %d", CountActivationPoWChallenges())
	}
}

func TestActivationPoWChallengePerUserCap(t *testing.T) {
	resetActivationPoWChallenges()
	for i := 0; i < activationPoWMaxPerUser+3; i++ {
		if _, err := IssueActivationPoWChallenge(9, "10.0.0.3", 8); err != nil {
			t.Fatalf("第 %d 次签发失败：%v", i+1, err)
		}
	}
	if got := CountActivationPoWChallenges(); got != activationPoWMaxPerUser {
		t.Errorf("单用户保留上限应为 %d，实际 %d", activationPoWMaxPerUser, got)
	}
	// 另一个用户不受影响
	if _, err := IssueActivationPoWChallenge(10, "10.0.0.4", 8); err != nil {
		t.Fatalf("另一用户签发失败：%v", err)
	}
	if got := CountActivationPoWChallenges(); got != activationPoWMaxPerUser+1 {
		t.Errorf("另一用户不应被淘汰，实际 %d", got)
	}
}

// TestActivationPoWDifficultyCost 固定一组真实难度下的样例，防止难度定义被无意改弱：
// 8 位时"前导零位"必须是 8，hash 值本身要以 00 开头。
func TestActivationPoWDifficultyEncoding(t *testing.T) {
	challenge := "ffffffff"
	nonce := solveActivationPoW(t, challenge, 8)
	sum := sha256.Sum256([]byte(challenge + ":" + nonce))
	if hex.EncodeToString(sum[:])[0:2] != "00" {
		t.Fatalf("8 位难度应由 0x00 前导字节满足，实际 %s", hex.EncodeToString(sum[:]))
	}
}
