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

// 人机校验（PoW）挑战，供激活页与登录/注册入口使用。
//
// 挑战只存在内存中：一次性、5 分钟有效，绑定用途（激活 / 前置）；已登录按用户计数，
// 未登录按 IP 计数（Ip 只用于"每 IP 保留几条"的淘汰，不参与校验 —— 同一 IP 要领多道
// 挑战是正常行为，把消费也钉在 IP 上反而会误伤切换网络/多标签的用户）。
// 校验方式为找出 nonce，使 sha256(challenge:nonce) 具有足够的前导零位。
// 实例重启后未用挑战即失效，客户端会重新领取。
// 挑战用途：不同入口签发的挑战不通用。
const (
	// PoWPurposeActivation 激活页提交邀请码。
	PoWPurposeActivation = "activation"
	// PoWPurposePreAuth 登录、注册与第三方登录的前置校验。
	PoWPurposePreAuth = "preauth"
)

// ActivationPoWChallengeTTL 单个挑战的有效期。
const ActivationPoWChallengeTTL = 5 * time.Minute

// activationPoWMaxPerUser 同一用户保留的未用挑战上限（超出淘汰最旧的）。
const activationPoWMaxPerUser = 5

// poWMaxPerIP 同一 IP 保留的未用挑战上限（超出淘汰最旧的）。
const poWMaxPerIP = 12

// activationPoWMaxTotal 挑战池全局上限，防止内存被批量签发撑爆。
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

// IssuePoWChallenge 签发一道挑战。userId 为 0 表示未登录场景，按 IP 计数。
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

// ConsumePoWChallenge 校验并消费一道挑战（一次性）。用途或用户不符按"不存在"处理。
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

// CountLeadingZeroBits 返回字节序列的前导零位数。
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

// CountPoWChallenges 返回当前池中的挑战数（测试用）。
func CountPoWChallenges() int {
	poWMu.Lock()
	defer poWMu.Unlock()
	prunePoWChallengesLocked(time.Now())
	return len(poWChallenges)
}

// PrunePoWChallenges 清理过期挑战，返回清理条数。
func PrunePoWChallenges() int {
	poWMu.Lock()
	defer poWMu.Unlock()
	return prunePoWChallengesLocked(time.Now())
}

// ResetPoWChallengesForTest 清空挑战池（单测用）。
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

// evictOldestPoWChallengesLocked 按 match 选出的挑战压到 keep 条以内，淘汰最旧的。
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
		// 兜底：随机源异常时退化为时间戳，避免整条链路不可用。
		common.SysError("pow token rand failed: " + err.Error())
		return hex.EncodeToString([]byte(strconv.FormatInt(time.Now().UnixNano(), 10)))
	}
	return hex.EncodeToString(buf)
}

// isDecimalNonce nonce 为不超过 20 位的十进制串。
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
