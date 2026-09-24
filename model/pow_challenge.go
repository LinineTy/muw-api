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

// 人机校验（PoW）挑战：目前服务于"激活页"和"登录/注册前置校验"两个关口。
//
// 设计取舍（2026-09-24 定）：
//   - 挑战只存在**内存**里：生命周期 5 分钟、一次性，实例重启即失效——用户重进激活页会自动
//     重新签发，不影响激活；相比落库省掉一张表和一套清理任务。
//   - 挑战绑定签发时的 user_id 与 purpose：换人或换用途（拿激活页的挑战去登录）直接拒绝。
//   - 校验是"挑战 + nonce"的 sha256 前导零位，纯 CPU 工作：真人在浏览器里跑 1~2 秒，
//     批量试码的脚本要为每次尝试付同样的算力。它挡不住 GPU 农场，只抬高自动化成本，
//     真正的自动化判定看蜜罐字段（见 controller.ActivateInviteCode）。
//
// 注意：这是自研机制，不属于上游 new-api，改上游代码时不要指望这里有对应实现。

// 挑战用途：不同关口签发的挑战不通用（否则激活页领的挑战能拿去登录）。
const (
	// PoWPurposeActivation 激活页提交邀请码。
	PoWPurposeActivation = "activation"
	// PoWPurposePreAuth 登录/注册等未登录场景的前置校验。
	PoWPurposePreAuth = "preauth"
)

// ActivationPoWChallengeTTL 单个挑战的有效期。
const ActivationPoWChallengeTTL = 5 * time.Minute

// activationPoWMaxPerUser 同一用户最多保留几个未用挑战：超出淘汰最旧的，
// 而不是拒绝签发——真人反复提交失败（或页面刷新）不该被自己的挑战额度卡住。
const activationPoWMaxPerUser = 5

// poWMaxPerIP 同一 IP 最多保留几个未用挑战（登录页每次打开都会领一道，真人够用；
// 批量刷挑战的脚本会被这条压住）。超出淘汰该 IP 最旧的。
const poWMaxPerIP = 12

// activationPoWMaxTotal 全局上限，避免被批量签发撑爆内存；超出时先清理过期项。
const activationPoWMaxTotal = 50000

// ErrPoWNotFound 挑战不存在（伪造、用途不符、已清理或重启后失效）。
var ErrPoWNotFound = errors.New("pow challenge not found")

// ErrPoWExpired 挑战已过期。
var ErrPoWExpired = errors.New("pow challenge expired")

// ErrPoWUserMismatch 挑战不属于当前用户。
var ErrPoWUserMismatch = errors.New("pow challenge belongs to another user")

// ErrPoWInvalidNonce nonce 未满足难度要求。
var ErrPoWInvalidNonce = errors.New("pow nonce does not satisfy difficulty")

// ActivationPoWChallenge 一次人机校验挑战。
type PoWChallenge struct {
	Id        string
	Challenge string
	Purpose   string
	UserId    int
	Ip        string
	Bits      int
	CreatedAt time.Time
	ExpireAt  time.Time
}

var (
	poWMu         sync.Mutex
	poWChallenges = map[string]*PoWChallenge{}
)

// IssuePoWChallenge 签发一道挑战（bits <= 0 时由调用方直接跳过校验）。
// userId 为 0 表示未登录场景（登录/注册），此时按 IP 计数。
func IssuePoWChallenge(purpose string, userId int, ip string, bits int) (*PoWChallenge, error) {
	if purpose == "" {
		return nil, errors.New("pow purpose 不能为空")
	}
	if bits <= 0 {
		return nil, errors.New("pow bits 必须为正数")
	}
	now := time.Now()
	challenge := PoWChallenge{
		Id:        randomPoWToken(16),
		Challenge: randomPoWToken(24),
		Purpose:   purpose,
		UserId:    userId,
		Ip:        ip,
		Bits:      bits,
		CreatedAt: now,
		ExpireAt:  now.Add(ActivationPoWChallengeTTL),
	}

	poWMu.Lock()
	defer poWMu.Unlock()
	prunePoWChallengesLocked(now)
	if len(poWChallenges) >= activationPoWMaxTotal {
		return nil, fmt.Errorf("pow challenge pool is full (%d)", len(poWChallenges))
	}
	if userId > 0 {
		evictOldestPoWChallengesLocked(activationPoWMaxPerUser-1, func(record *PoWChallenge) bool {
			return record.UserId == userId
		})
	} else if ip != "" {
		evictOldestPoWChallengesLocked(poWMaxPerIP-1, func(record *PoWChallenge) bool {
			return record.Ip == ip && record.UserId == 0
		})
	}
	poWChallenges[challenge.Id] = &challenge
	return &challenge, nil
}

// ConsumePoWChallenge 校验并消费一道挑战（一次性：校验通过即失效）。
// 用途或用户不符一律按"不存在"处理，不向调用方区分原因。
func ConsumePoWChallenge(id string, purpose string, userId int, nonce string) error {
	if id == "" {
		return ErrPoWNotFound
	}
	poWMu.Lock()
	defer poWMu.Unlock()
	record, ok := poWChallenges[id]
	if !ok {
		return ErrPoWNotFound
	}
	if time.Now().After(record.ExpireAt) {
		delete(poWChallenges, id)
		return ErrPoWExpired
	}
	if record.Purpose != purpose {
		return ErrPoWNotFound
	}
	if record.UserId != userId {
		return ErrPoWUserMismatch
	}
	if !VerifyPoW(record.Challenge, nonce, record.Bits) {
		return ErrPoWInvalidNonce
	}
	delete(poWChallenges, id)
	return nil
}

// VerifyPoW 校验 nonce 是否让 sha256(challenge:nonce) 达到难度要求。
// 纯函数，便于单测。
func VerifyPoW(challenge string, nonce string, bits int) bool {
	if challenge == "" || bits <= 0 {
		return false
	}
	if !isDecimalNonce(nonce) {
		return false
	}
	sum := sha256.Sum256([]byte(challenge + ":" + nonce))
	return CountLeadingZeroBits(sum[:]) >= bits
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

// CountPoWChallenges 当前池中的挑战数（运维核对/测试用）。
func CountPoWChallenges() int {
	poWMu.Lock()
	defer poWMu.Unlock()
	prunePoWChallengesLocked(time.Now())
	return len(poWChallenges)
}

// PrunePoWChallenges 清理过期挑战，返回清理条数（每分钟由系统任务调用）。
func PrunePoWChallenges() int {
	poWMu.Lock()
	defer poWMu.Unlock()
	return prunePoWChallengesLocked(time.Now())
}

// ResetPoWChallengesForTest 清空挑战池（跨包单测用：controller 的用例要先清干净）。
func ResetPoWChallengesForTest() {
	resetPoWChallenges()
}

// resetPoWChallenges 清空挑战池（单测用）。
func resetPoWChallenges() {
	poWMu.Lock()
	defer poWMu.Unlock()
	poWChallenges = map[string]*PoWChallenge{}
}

func prunePoWChallengesLocked(now time.Time) int {
	removed := 0
	for id, record := range poWChallenges {
		if now.After(record.ExpireAt) {
			delete(poWChallenges, id)
			removed++
		}
	}
	return removed
}

// evictOldestPoWChallengesLocked 按 match 选出一组挑战，压到 keep 条以内（淘汰最旧的）。
func evictOldestPoWChallengesLocked(keep int, match func(*PoWChallenge) bool) {
	if keep < 0 {
		keep = 0
	}
	var owned []*PoWChallenge
	for _, record := range poWChallenges {
		if match(record) {
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
		delete(poWChallenges, oldest.Id)
		owned = removePoWChallenge(owned, oldest.Id)
	}
}

func removePoWChallenge(list []*PoWChallenge, id string) []*PoWChallenge {
	for i, record := range list {
		if record.Id == id {
			return append(list[:i], list[i+1:]...)
		}
	}
	return list
}

func randomPoWToken(bytes int) string {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand 失败极罕见；用时间戳兜底，宁可挑战弱一点也不要整条激活链路挂掉。
		common.SysError("pow token rand failed: " + err.Error())
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
