package service

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// 信誉分变动来源（credit_score_logs.source）。
const (
	CreditSourceUpstreamViolation = "upstream_violation"
	CreditSourceLocalKeyword      = "local_keyword"
	CreditSourceAdminAdjust       = "admin_adjust"
	CreditSourcePassiveRecover    = "passive_recover"
	CreditSourcePledge            = "pledge"
	// CreditSourceFullScoreReset 管理端全站信誉分重置（所有用户归一到新满分）。
	CreditSourceFullScoreReset = "full_score_reset"
	// CreditSourceRevert 管理端打回误判的敏感词扣分（审核撤销，恢复分数）。
	CreditSourceRevert = "admin_revert"
)

// ErrPledgeCooldown 保证书冷却中，nextPledgeAt 由 ApplyUserPledge 的返回值给出。
// 与 model.ErrPledgeCooldown 同值，controller 用 errors.Is 判定冷却态。
var ErrPledgeCooldown = model.ErrPledgeCooldown

// ErrPledgeAtFullScore 已达满分，无需完成保证书。
var ErrPledgeAtFullScore = errors.New("pledge at full score")

// ErrPledgeDisabled 保证书功能未启用（总开关关闭或加分点数未配置）。
var ErrPledgeDisabled = errors.New("pledge disabled")

// convSizeCache 缓存对话留存总用量（概览展示用）。SumConversationSize 对整表做
// 聚合，表涨到 GB 级后每次概览加载都扫全表代价高，这里做 60s 短 TTL 缓存。
var convSizeCache struct {
	sync.Mutex
	ts  int64
	val int64
}

func cachedConversationSize() (int64, error) {
	now := time.Now().Unix()
	convSizeCache.Lock()
	defer convSizeCache.Unlock()
	if convSizeCache.ts != 0 && now-convSizeCache.ts < 60 {
		return convSizeCache.val, nil
	}
	v, err := model.SumConversationSize(nil)
	if err != nil {
		return 0, err
	}
	convSizeCache.ts = now
	convSizeCache.val = v
	return v, nil
}

// GetRiskControlOverview 风控中心概览统计。单项统计失败只记日志不拖垮整页
// （面板继续显示其余可用数据），避免迁移未完成等瞬态故障让整个页面 500。
func GetRiskControlOverview() (map[string]any, error) {
	setting := operation_setting.GetCreditScoreSetting()
	now := time.Now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()

	overview := make(map[string]any)
	collect := func(key string, fn func() (int64, error)) {
		v, err := fn()
		if err != nil {
			common.SysLog(fmt.Sprintf("risk control overview: %s failed: %v", key, err))
			return
		}
		overview[key] = v
	}
	collect("low_score_users", func() (int64, error) {
		return model.CountUsersBelowCreditScore(setting.FreezeThreshold)
	})
	collect("today_deductions", func() (int64, error) {
		sum, err := model.SumAllDeductionsSince(dayStart)
		return int64(sum), err
	})
	collect("today_violation_events", func() (int64, error) {
		return model.CountCreditScoreLogsSince(dayStart, []string{CreditSourceUpstreamViolation, CreditSourceLocalKeyword})
	})
	collect("today_conversations", func() (int64, error) {
		return model.CountConversationRecordsSince(dayStart)
	})
	collect("total_credit_logs", func() (int64, error) {
		return model.CountCreditScoreLogsSince(0, nil)
	})

	convSetting := operation_setting.GetConversationRetentionSetting()
	overview["conversations_cap_bytes"] = convSetting.MaxTotalBytes
	if used, err := cachedConversationSize(); err != nil {
		common.SysLog("risk control overview: conversation storage sum failed: " + err.Error())
	} else {
		overview["conversations_used_bytes"] = used
	}

	// 信用分百分比分桶分布（按满分等比缩放，改数值不影响展示）。
	if dist, err := model.CountUsersByCreditScoreSegment(setting.FullScore); err != nil {
		common.SysLog("risk control overview: credit score distribution failed: " + err.Error())
	} else if len(dist) > 0 {
		overview["credit_score_distribution"] = dist
	}

	overview["freeze_threshold"] = setting.FreezeThreshold
	overview["full_score"] = setting.FullScore
	overview["freeze_enabled"] = setting.Enabled && setting.AutoFreezeEnabled
	return overview, nil
}

// GetUserCreditStatus 返回用户可见的信誉分状态（个人中心展示 + 保证书入口）。
func GetUserCreditStatus(ctx *gin.Context, userId int) (map[string]any, error) {
	score, err := model.GetUserCreditScore(userId)
	if err != nil {
		return nil, err
	}
	setting := operation_setting.GetCreditScoreSetting()
	last, _ := model.GetLastCreditScoreLog(userId, CreditSourcePledge)
	cooldown := int64(setting.PledgeCooldownDays) * 86400
	nextPledgeAt := int64(0)
	pledgeCount := int64(0)
	if last != nil {
		nextPledgeAt = last.CreatedAt + cooldown
	}
	pledgeCount, _ = model.CountCreditScoreLogs(userId, CreditSourcePledge, 0)
	return map[string]any{
		"credit_score":            score,
		"enabled":                 setting.Enabled,
		"frozen":                  setting.IsFrozen(score),
		"freeze_threshold":        setting.FreezeThreshold,
		"full_score":              setting.FullScore,
		"pledge_points":           setting.PledgePoints,
		"pledge_cooldown_seconds": cooldown,
		"next_pledge_at":          nextPledgeAt,
		"pledge_read_count":       pledgeCount,
	}, nil
}

// ApplyUserPledge 用户完成保证书：冷却期内拒绝；否则 +PledgePoints（clamp 满分级），
// 落 audit 明细（source=pledge）。冷却检查与加分在行锁内原子完成（model.ApplyUserPledge），
// 并发下不会重复领分。返回新余额与下次可做保证书的时间。
func ApplyUserPledge(ctx *gin.Context, userId int) (newBalance int, nextPledgeAt int64, err error) {
	if userId <= 0 {
		return 0, 0, fmt.Errorf("invalid user id")
	}
	setting := operation_setting.GetCreditScoreSetting()
	if !setting.Enabled || setting.PledgePoints <= 0 {
		return 0, 0, ErrPledgeDisabled
	}
	// 已达满分无分可恢复：拒绝并避免烧掉冷却（软检查，最终由 clamp 兜底）。
	if score, err := model.GetUserCreditScore(userId); err == nil && setting.FullScore > 0 && score >= setting.FullScore {
		return 0, 0, ErrPledgeAtFullScore
	}
	cooldown := int64(setting.PledgeCooldownDays) * 86400
	if cooldown <= 0 {
		cooldown = 7 * 86400
	}
	log := &model.CreditScoreLog{
		Source: CreditSourcePledge,
		Reason: "完成保证书",
	}
	newBalance, nextPledgeAt, err = model.ApplyUserPledge(userId, setting.PledgePoints, setting.FullScore, cooldown, CreditSourcePledge, log)
	if errors.Is(err, model.ErrPledgeCooldown) {
		return 0, nextPledgeAt, ErrPledgeCooldown
	}
	if err != nil {
		return 0, 0, err
	}
	if err := model.UpdateUserCreditScoreCache(userId, newBalance); err != nil {
		_ = model.InvalidateUserCache(userId)
	}
	logger.LogInfo(ctx, fmt.Sprintf("user pledge: user=%d balance=%d", userId, newBalance))
	return newBalance, nextPledgeAt, nil
}

// ApplyViolationCreditDeduction 上游返回违规标记（可配标记词命中）时扣分。
// 挂在 controller/relay.go 的失败 defer，与 ChargeViolationFeeIfNeeded 并列。
func ApplyViolationCreditDeduction(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, apiErr *types.NewAPIError) {
	if ctx == nil || relayInfo == nil || apiErr == nil {
		return
	}
	setting := operation_setting.GetCreditScoreSetting()
	if !setting.Enabled || setting.DeductionUpstreamViolation <= 0 {
		return
	}
	msg := apiErr.Error()
	if msg == "" {
		msg = apiErr.ToOpenAIError().Message
	}
	marker := setting.MatchedViolationMarker(msg)
	if marker == "" {
		return
	}
	reason := fmt.Sprintf("上游违规标记词: %s; %s", marker, truncateForCreditReason(msg))
	applyCreditDeduction(ctx, relayInfo, CreditSourceUpstreamViolation, setting.DeductionUpstreamViolation, reason)
}

// ApplyKeywordCreditDeduction 本地敏感词命中时扣分。
func ApplyKeywordCreditDeduction(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, matchedWords []string) {
	if ctx == nil || relayInfo == nil {
		return
	}
	setting := operation_setting.GetCreditScoreSetting()
	if !setting.Enabled || setting.DeductionLocalKeyword <= 0 {
		return
	}
	reason := fmt.Sprintf("敏感词命中: %s", strings.Join(matchedWords, ", "))
	applyCreditDeduction(ctx, relayInfo, CreditSourceLocalKeyword, setting.DeductionLocalKeyword, reason)
}

// applyCreditDeduction 公共扣分路径：守卫 → 行锁内完成"24h 重复倍率 + 每日上限 + 原子扣分 + 审计明细"。
func applyCreditDeduction(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, source string, basePoints int, reason string) {
	if relayInfo == nil || relayInfo.UserId <= 0 {
		return
	}
	// 内部子请求（视觉兜底描述等）不扣分——它的内容不代表主请求违规。
	if common.GetContextKeyBool(ctx, constant.ContextKeyInternalSubRequest) {
		return
	}
	if relayInfo.IsChannelTest {
		return
	}
	setting := operation_setting.GetCreditScoreSetting()

	log := &model.CreditScoreLog{
		Source:    source,
		RequestId: relayInfo.RequestId,
		Reason:    reason,
	}
	// 倍率/每日上限在拿到用户行锁之后、事务内计算，并发扣分不会绕过每日上限。
	// 倍率开关关闭时传 nil 阶梯：model 层以"阶梯非空"作为是否启用递增的判断。
	repeatTiers := setting.RepeatMultiplierTiers
	if !setting.RepeatMultiplierEnabled {
		repeatTiers = nil
	}
	applied, newBalance, err := model.ApplyCreditScoreDeduction(
		relayInfo.UserId, source, basePoints, setting.FullScore,
		repeatTiers, setting.MaxDailyDeduction,
		time.Now().Unix()-24*3600, log)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("credit score deduction failed: %s", err.Error()))
		return
	}
	if applied <= 0 {
		return // 已达每日上限或无实际扣分
	}
	if err := model.UpdateUserCreditScoreCache(relayInfo.UserId, newBalance); err != nil {
		_ = model.InvalidateUserCache(relayInfo.UserId)
	}
	logger.LogInfo(ctx, fmt.Sprintf("credit score deduction: user=%d source=%s points=%d balance=%d request_id=%s",
		relayInfo.UserId, source, applied, newBalance, relayInfo.RequestId))
}

// AdjustUserCreditScore 管理端手动调整信用分（delta 正=恢复，负=扣分），clamp 到
// [0, FullScore]，落审计明细 + 刷缓存。返回新余额。
func AdjustUserCreditScore(ctx *gin.Context, userId int, delta int, reason string) (int, error) {
	if userId <= 0 {
		return 0, fmt.Errorf("invalid user id")
	}
	setting := operation_setting.GetCreditScoreSetting()
	log := &model.CreditScoreLog{
		Source: CreditSourceAdminAdjust,
		Reason: reason,
	}
	newBalance, err := model.ApplyCreditScoreDelta(userId, delta, setting.FullScore, log)
	if err != nil {
		return 0, err
	}
	if err := model.UpdateUserCreditScoreCache(userId, newBalance); err != nil {
		_ = model.InvalidateUserCache(userId)
	}
	logger.LogInfo(ctx, fmt.Sprintf("admin adjust credit score: user=%d delta=%d balance=%d", userId, delta, newBalance))
	return newBalance, nil
}

// parseSensitiveWordsFromReason 从扣分原因里解析命中的敏感词。reason 格式由
// ApplyKeywordCreditDeduction 生成："敏感词命中: 词A, 词B"。解析失败返回 nil。
func parseSensitiveWordsFromReason(reason string) []string {
	const prefix = "敏感词命中:"
	if !strings.HasPrefix(reason, prefix) {
		return nil
	}
	rest := strings.TrimSpace(strings.TrimPrefix(reason, prefix))
	if rest == "" {
		return nil
	}
	parts := strings.Split(rest, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if w := strings.TrimSpace(p); w != "" {
			out = append(out, w)
		}
	}
	return out
}

// removeSensitiveWordsFromLibrary 从全局敏感词库移除指定词并持久化 option。
// 词库更新后 AC 缓存 key 变化自动重建，无需手动清缓存。要删的词不在库里也视为成功。
func removeSensitiveWordsFromLibrary(words []string) error {
	if len(words) == 0 {
		return nil
	}
	remove := make(map[string]bool, len(words))
	for _, w := range words {
		if t := strings.ToLower(strings.TrimSpace(w)); t != "" {
			remove[t] = true
		}
	}
	kept := make([]string, 0, len(setting.SensitiveWords))
	for _, w := range setting.SensitiveWords {
		if !remove[strings.ToLower(strings.TrimSpace(w))] {
			kept = append(kept, w)
		}
	}
	setting.SensitiveWords = kept
	return model.UpdateOption("SensitiveWords", setting.SensitiveWordsToString())
}

// RevertKeywordDeduction 管理端打回一条敏感词扣分记录（审核认定误判）：
//  1. 校验记录存在、是 local_keyword 扣分、未打回；
//  2. 校验 removeWords 都是该记录命中的词；
//  3. 可选先从敏感词库删词（失败即中止，分数不动）；
//  4. 原子加回分数 + 标记原记录已打回（幂等），落恢复审计明细。
//
// 返回更新后余额、被打回的用户 id、恢复的点数（正），供管理审计记录"打回了谁、多少分"。
func RevertKeywordDeduction(logID int64, removeWords []string) (newBalance int, userId int, points int, err error) {
	var scoreLog model.CreditScoreLog
	if err := model.DB.First(&scoreLog, logID).Error; err != nil {
		return 0, 0, 0, fmt.Errorf("扣分记录不存在")
	}
	if scoreLog.Source != CreditSourceLocalKeyword {
		return 0, 0, 0, fmt.Errorf("仅敏感词扣分可打回")
	}
	if scoreLog.Points >= 0 {
		return 0, 0, 0, fmt.Errorf("该记录不是扣分")
	}
	if scoreLog.RevertedAt != 0 {
		return 0, 0, 0, model.ErrCreditScoreLogAlreadyReverted
	}
	hitWords := parseSensitiveWordsFromReason(scoreLog.Reason)
	for _, w := range removeWords {
		word := strings.TrimSpace(w)
		if word == "" {
			continue
		}
		matched := false
		for _, hit := range hitWords {
			if strings.EqualFold(hit, word) {
				matched = true
				break
			}
		}
		if !matched {
			return 0, 0, 0, fmt.Errorf("词 %q 不在该记录命中的词中", word)
		}
	}
	// 先删词后加分：删词失败时分数保持不动、整体失败。
	if err := removeSensitiveWordsFromLibrary(removeWords); err != nil {
		return 0, 0, 0, fmt.Errorf("敏感词库更新失败: %s", err)
	}
	setting := operation_setting.GetCreditScoreSetting()
	revertLog := &model.CreditScoreLog{
		Source:    CreditSourceRevert,
		RequestId: scoreLog.RequestId,
		Reason:    fmt.Sprintf("管理端打回误判扣分 #%d（原始原因: %s）", scoreLog.Id, scoreLog.Reason),
	}
	newBalance, err = model.ApplyCreditScoreRevert(scoreLog.Id, scoreLog.UserId, -scoreLog.Points, setting.FullScore, revertLog)
	if err != nil {
		return 0, 0, 0, err
	}
	return newBalance, scoreLog.UserId, -scoreLog.Points, nil
}

func truncateForCreditReason(msg string) string {
	const maxLen = 200
	if len(msg) <= maxLen {
		return msg
	}
	// 回退到 rune 边界，避免切出非法 UTF-8（reason 列在 MySQL/PG 下会拒绝插入）。
	cut := maxLen
	for cut > 0 && !utf8.RuneStart(msg[cut]) {
		cut--
	}
	return msg[:cut] + "..."
}
