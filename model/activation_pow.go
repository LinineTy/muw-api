package model

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// 激活页人机校验（PoW）挑战。
//
// 设计取舍（2026-09-24 定）：
//   - 挑战只存在**内存**里：生命周期 5 分钟、一次性，实例重启即失效——用户重进激活页会自动
//     重新签发，不影响激活；相比落库省掉一张表和一套清理任务。
//   - 挑战绑定签发时的 user_id：换人使用直接拒绝。
//   - 校验是"挑战 + nonce"的 sha256 前导零位，纯 CPU 工作：真人在浏览器里跑 1~2 秒，
//     批量试码的脚本要为每次尝试付同样的算力。它挡不住 GPU 农场，只抬高自动化成本，
//     真正的自动化判定看蜜罐字段（见 controller.ActivateInviteCode）。
//
// 注意：这是自研机制，不属于上游 new-api，改上游代码时不要指望这里有对应实现。

// ActivationPoWChallengeTTL 单个挑战的有效期。
const ActivationPoWChallengeTTL = 5 * time.Minute

// activationPoWMaxPerUser 同一用户最多保留几个未用挑战：超出淘汰最旧的，
// 而不是拒绝签发——真人反复提交失败（或页面刷新）不该被自己的挑战额度卡住。
const activationPoWMaxPerUser = 5

// activationPoWMaxTotal 全局上限，避免被批量签发撑爆内存；超出时先清理过期项。
const activationPoWMaxTotal = 50000

// ErrActivationPoWNotFound 挑战不存在（伪造、已清理或重启后失效）。
var ErrActivationPoWNotFound = errors.New("activation pow challenge not found")

// ErrActivationPoWExpired 挑战已过期。
var ErrActivationPoWExpired = errors.New("activation pow challenge expired")

// ErrActivationPoWUserMismatch 挑战不属于当前用户。
var ErrActivationPoWUserMismatch = errors.New("activation pow challenge belongs to another user")

// ErrActivationPoWInvalidNonce nonce 未满足难度要求。
var ErrActivationPoWInvalidNonce = errors.New("activation pow nonce does not satisfy difficulty")

// ActivationPoWChallenge 一次人机校验挑战。
type ActivationPoWChallenge struct {
	Id        string
	Challenge string
	UserId    int
	Ip        string
	Bits      int
	CreatedAt time.Time
	ExpireAt  time.Time
}

var (
	activationPoWMu         sync.Mutex
	activationPoWChallenges = map[string]*ActivationPoWChallenge{}
)

// IssueActivationPoWChallenge 签发一道挑战（bits <= 0 时由调用方直接跳过校验）。
func IssueActivationPoWChallenge(userId int, ip string, bits int) (*ActivationPoWChallenge, error) {
	if userId == 0 {
		return nil, errors.New("id 为空！")
	}
	if bits <= 0 {
		return nil, errors.New("pow bits 必须为正数")
	}
	now := time.Now()
	challenge := ActivationPoWChallenge{
		Id:        randomActivationPoWToken(16),
		Challenge: randomActivationPoWToken(24),
		UserId:    userId,
		Ip:        ip,
		Bits:      bits,
		CreatedAt: now,
		ExpireAt:  now.Add(ActivationPoWChallengeTTL),
	}

	activationPoWMu.Lock()
	defer activationPoWMu.Unlock()
	pruneActivationPoWChallengesLocked(now)
	if len(activationPoWChallenges) >= activationPoWMaxTotal {
		return nil, fmt.Errorf("activation pow challenge pool is full (%d)", len(activationPoWChallenges))
	}
	evictOldestActivationPoWChallengesLocked(userId, activationPoWMaxPerUser-1)
	activationPoWChallenges[challenge.Id] = &challenge
	return &challenge, nil
}

// ConsumeActivationPoWChallenge 校验并消费一道挑战（一次性：校验通过即失效）。
func ConsumeActivationPoWChallenge(id string, userId int, nonce string) error {
	if id == "" {
		return ErrActivationPoWNotFound
	}
	activationPoWMu.Lock()
	defer activationPoWMu.Unlock()
	record, ok := activationPoWChallenges[id]
	if !ok {
		return ErrActivationPoWNotFound
	}
	if time.Now().After(record.ExpireAt) {
		delete(activationPoWChallenges, id)
		return ErrActivationPoWExpired
	}
	if record.UserId != userId {
		return ErrActivationPoWUserMismatch
	}
	if !VerifyActivationPoW(record.Challenge, nonce, record.Bits) {
		return ErrActivationPoWInvalidNonce
	}
	delete(activationPoWChallenges, id)
	return nil
}

// VerifyActivationPoW 校验 nonce 是否让 sha256(challenge:nonce) 达到难度要求。
// 纯函数，便于单测。
func VerifyActivationPoW(challenge string, nonce string, bits int) bool {
	if challenge == "" || bits <= 0 {
		return false
	}
	if !isDecimalNonce(nonce) {
		return false
	}
	sum := sha256.Sum256([]byte(challenge + ":" + nonce))
	return CountLeadingZeroBits(sum[:]) >= bits
}

// CountLeadingZeroBits 返回字节序列的前导零位数（用于难度比较）。
func CountLeadingZeroBits(data []byte) int {
	count := 0
	for _, b := range data {
		if b == 0 {
			count += 8
			continue
		}
		for mask := byte(0x80); mask > 0; mask >>= 1 {
			if b&mask != 0 {
				break
			}
			count++
		}
		break
	}
	return count
}

// CountActivationPoWChallenges 当前池中的挑战数（运维核对/测试用）。
func CountActivationPoWChallenges() int {
	activationPoWMu.Lock()
	defer activationPoWMu.Unlock()
	pruneActivationPoWChallengesLocked(time.Now())
	return len(activationPoWChallenges)
}

// PruneActivationPoWChallenges 清理过期挑战，返回清理条数（每分钟由系统任务调用）。
func PruneActivationPoWChallenges() int {
	activationPoWMu.Lock()
	defer activationPoWMu.Unlock()
	return pruneActivationPoWChallengesLocked(time.Now())
}

// resetActivationPoWChallenges 清空挑战池（单测用）。
func resetActivationPoWChallenges() {
	activationPoWMu.Lock()
	defer activationPoWMu.Unlock()
	activationPoWChallenges = map[string]*ActivationPoWChallenge{}
}

func pruneActivationPoWChallengesLocked(now time.Time) int {
	removed := 0
	for id, record := range activationPoWChallenges {
		if now.After(record.ExpireAt) {
			delete(activationPoWChallenges, id)
			removed++
		}
	}
	return removed
}

// evictOldestActivationPoWChallengesLocked 把某用户留下的挑战数压到 keep 条以内（淘汰最旧的）。
func evictOldestActivationPoWChallengesLocked(userId int, keep int) {
	if keep < 0 {
		keep = 0
	}
	var owned []*ActivationPoWChallenge
	for _, record := range activationPoWChallenges {
		if record.UserId == userId {
			owned = append(owned, record)
		}
	}
	if len(owned) <= keep {
		return
	}
	for i := 0; i < len(owned)-keep; i++ {
		oldest := owned[0]
		for _, record := range owned[1:] {
			if record.CreatedAt.Before(oldest.CreatedAt) {
				oldest = record
			}
		}
		delete(activationPoWChallenges, oldest.Id)
		owned = removeActivationPoWChallenge(owned, oldest.Id)
	}
}

func removeActivationPoWChallenge(list []*ActivationPoWChallenge, id string) []*ActivationPoWChallenge {
	for i, record := range list {
		if record.Id == id {
			return append(list[:i], list[i+1:]...)
		}
	}
	return list
}

func randomActivationPoWToken(bytes int) string {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand 失败极罕见；用时间戳兜底，宁可挑战弱一点也不要整条激活链路挂掉。
		common.SysError("activation pow token rand failed: " + err.Error())
		return hex.EncodeToString([]byte(strconv.FormatInt(time.Now().UnixNano(), 10)))
	}
	return hex.EncodeToString(buf)
}

// isDecimalNonce nonce 必须是不超过 20 位的十进制串：防超长输入，也让客户端实现简单。
func isDecimalNonce(nonce string) bool {
	if nonce == "" || len(nonce) > 20 {
		return false
	}
	for _, r := range nonce {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
