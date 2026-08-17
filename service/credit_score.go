package service

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
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
	// CreditSourceFullScoreReset 历史用途的管理端全站信誉分重置标识（老版本重置会为每个
	// 被重置用户写一条 source=full_score_reset 记录）。新版重置后明细表完全清空、不写任何
	// 记录，此值仅保留用于前端「来源」筛选兼容存量数据。
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
//  2. 原子加回分数 + 标记原记录已打回（幂等），落恢复审计明细；
//  3. 可选再从敏感词库删词（只按库精确匹配删除，词不在库中视为已删；删词失败即中止）。
//
// 先恢复分数后删词：打回失败时词保持不动（不会"词已删、分没加"）；删词失败发生在分数
// 恢复之后，返回错误提示"分数已恢复但词库更新失败"，重试幂等（已打回跳过 + 补删词）。
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
	// 只按词库精确（大小写不敏感）匹配删除，词不在库中视为已删/无需删。不因"词不在该
	// 记录解析出的命中词里"而整单失败——reason 可能被截断/含逗号词导致解析不全，之前
	// 那种严格校验会让管理员勾选了"同时删除"却整个打回失败。
	if err := removeSensitiveWordsFromLibrary(removeWords); err != nil {
		return 0, 0, 0, fmt.Errorf("分数已恢复但敏感词库更新失败: %s", err)
	}
	return newBalance, scoreLog.UserId, -scoreLog.Points, nil
}

// revertDeductionsByUser 把一批未打回的敏感词扣分记录按用户聚合打回：每个用户行锁内
// 一次完成"批量标记打回 + 聚合加回分数 + 落一条聚合恢复明细"（同一次批量中同一用户
// 只产生一条 admin_revert，Points=聚合点数）。removeWords 为要一并从敏感词库删除的词
// （可空）。先全部打回成功后统一删词：某用户打回失败时词保持不动（不会"词已删、分没
// 加"），删词失败返回错误可重试（已打回跳过 + 补删词）。返回 {userId: 恢复点数}。
func revertDeductionsByUser(logs []*model.CreditScoreLog, removeWords []string) (map[int]int, error) {
	byUser := make(map[int][]*model.CreditScoreLog)
	for _, l := range logs {
		byUser[l.UserId] = append(byUser[l.UserId], l)
	}
	setting := operation_setting.GetCreditScoreSetting()
	summary := make(map[int]int, len(byUser))
	for userId, group := range byUser {
		delta := 0
		ids := make([]int64, 0, len(group))
		for _, l := range group {
			delta += -l.Points
			ids = append(ids, l.Id)
		}
		idParts := make([]string, 0, len(ids))
		for _, id := range ids {
			idParts = append(idParts, strconv.FormatInt(id, 10))
		}
		revertLog := &model.CreditScoreLog{
			Source: CreditSourceRevert,
			Reason: fmt.Sprintf("管理端批量打回误判扣分 %d 条（记录 #%s）", len(group), strings.Join(idParts, ", ")),
		}
		newBalance, err := model.ApplyCreditScoreRevertBatch(ids, userId, delta, setting.FullScore, revertLog)
		if err != nil {
			return summary, fmt.Errorf("用户 #%d 批量打回失败: %s", userId, err.Error())
		}
		if err := model.UpdateUserCreditScoreCache(userId, newBalance); err != nil {
			_ = model.InvalidateUserCache(userId)
		}
		summary[userId] = delta
	}
	// 全部用户打回成功后再删词。即使没有待打回记录（全部已打回）也要执行删词，否则
	// 重试删词会因 byUser 为空而漏删。
	if err := removeSensitiveWordsFromLibrary(removeWords); err != nil {
		return summary, fmt.Errorf("分数已恢复但敏感词库更新失败: %s", err)
	}
	return summary, nil
}

// RevertKeywordDeductions 管理端批量打回多条敏感词扣分（表格勾选多行）：
//  1. 载入源记录，过滤出 local_keyword、points<0、未打回的（已打回跳过=幂等，
//     非 local_keyword 报错）；
//  2. 命中的词并集先从敏感词库删除；
//  3. 按用户聚合打回，同一用户只落一条恢复明细。
//
// 返回 {userId: 恢复点数}，供管理审计与前端汇总展示。
func RevertKeywordDeductions(logIDs []int64) (map[int]int, error) {
	if len(logIDs) == 0 {
		return nil, errors.New("no logs selected")
	}
	var logs []*model.CreditScoreLog
	if err := model.DB.Where("id IN ?", logIDs).Find(&logs).Error; err != nil {
		return nil, err
	}
	if len(logs) == 0 {
		return nil, errors.New("扣分记录不存在")
	}
	valid := make([]*model.CreditScoreLog, 0, len(logs))
	seen := make(map[string]bool)
	for _, l := range logs {
		if l.Source != CreditSourceLocalKeyword {
			return nil, fmt.Errorf("仅敏感词扣分可打回（记录 #%d 来源 %s）", l.Id, l.Source)
		}
		if l.Points >= 0 {
			return nil, fmt.Errorf("记录 #%d 不是扣分", l.Id)
		}
		if l.RevertedAt != 0 {
			continue // 已打回，跳过
		}
		valid = append(valid, l)
		for _, w := range parseSensitiveWordsFromReason(l.Reason) {
			if k := strings.ToLower(strings.TrimSpace(w)); k != "" {
				seen[k] = true
			}
		}
	}
	removeWords := make([]string, 0, len(seen))
	for k := range seen {
		removeWords = append(removeWords, k)
	}
	return revertDeductionsByUser(valid, removeWords)
}

// RevertAllKeywordHits 按关键词一键打回：找到所有命中该关键词（reason 解析出的命中词
// 精确匹配，大小写不敏感）的未打回敏感词扣分记录，按用户聚合打回（同一用户一条恢复
// 明细）。removeFromLibrary 时先把该词从敏感词库删除。返回 {userId: 恢复点数} 与打回的
// 记录条数。用于管理员认定某个词为误伤后"删词 + 清历史误扣"一键完成。
func RevertAllKeywordHits(keyword string, removeFromLibrary bool) (map[int]int, int, error) {
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	if keyword == "" {
		return nil, 0, errors.New("关键词不能为空")
	}
	var logs []*model.CreditScoreLog
	// LIKE 预筛（大小写不敏感）缩小扫描范围，命中与否最终以解析出的词精确匹配为准。
	if err := model.DB.Model(&model.CreditScoreLog{}).
		Where("source = ? AND COALESCE(reverted_at, 0) = 0 AND LOWER(reason) LIKE ?",
			CreditSourceLocalKeyword, "%"+keyword+"%").
		Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	matched := make([]*model.CreditScoreLog, 0, len(logs))
	for _, l := range logs {
		for _, w := range parseSensitiveWordsFromReason(l.Reason) {
			if strings.EqualFold(strings.TrimSpace(w), keyword) {
				matched = append(matched, l)
				break
			}
		}
	}
	removeWords := []string(nil)
	if removeFromLibrary {
		removeWords = []string{keyword}
	}
	summary, err := revertDeductionsByUser(matched, removeWords)
	if err != nil {
		return summary, 0, err
	}
	return summary, len(matched), nil
}

// KeywordHitStat 关键词命中统计的一行。
type KeywordHitStat struct {
	Keyword string `json:"keyword"`
	Count   int64  `json:"count"`
}

// AggregateKeywordHitCounts 统计 since（unix 秒）之后敏感词扣分明细中每个命中关键词的
// 出现次数（从 reason 解析，大小写不敏感合并）。limit 为扫描的扣分记录数上限（兜底内存，
// 不限制返回条数——不同关键词数量有限）。返回按次数降序、同次数按关键词升序。
func AggregateKeywordHitCounts(since int64, limit int) ([]KeywordHitStat, error) {
	if limit <= 0 {
		limit = 200000
	}
	reasons, err := model.ListLocalKeywordReasons(since, limit)
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64)
	for _, r := range reasons {
		for _, w := range parseSensitiveWordsFromReason(r) {
			if k := strings.ToLower(strings.TrimSpace(w)); k != "" {
				counts[k]++
			}
		}
	}
	out := make([]KeywordHitStat, 0, len(counts))
	for k, c := range counts {
		out = append(out, KeywordHitStat{Keyword: k, Count: c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Keyword < out[j].Keyword
	})
	return out, nil
}

// UserHitStat 用户命中统计的一行：关键词命中 + 上游违规命中各记一次，Count 为总次数。
type UserHitStat struct {
	UserId        int    `json:"user_id"`
	Username      string `json:"username"`
	KeywordCount  int64  `json:"keyword_count"`
	UpstreamCount int64  `json:"upstream_count"`
	Count         int64  `json:"count"`
}

// AggregateUserHitCounts 统计 since（unix 秒）之后每个用户「敏感词命中 + 上游违规命中」的
// 次数（各来源每条扣分明细记一次），按总次数降序。limit 为返回的用户数上限（<=0 时默认 200）。
// 供「用户命中」堆叠柱状图：KeywordCount 与 UpstreamCount 拼成一根柱。
func AggregateUserHitCounts(since int64, limit int) ([]UserHitStat, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := model.ListUserHitCountsBySource(since)
	if err != nil {
		return nil, err
	}
	type agg struct{ keyword, upstream int64 }
	byUser := make(map[int]*agg)
	for _, r := range rows {
		a, ok := byUser[r.UserId]
		if !ok {
			a = &agg{}
			byUser[r.UserId] = a
		}
		switch r.Source {
		case CreditSourceLocalKeyword:
			a.keyword += r.Count
		case CreditSourceUpstreamViolation:
			a.upstream += r.Count
		}
	}
	userIds := make([]int, 0, len(byUser))
	for uid := range byUser {
		userIds = append(userIds, uid)
	}
	sort.Slice(userIds, func(i, j int) bool {
		ti := byUser[userIds[i]].keyword + byUser[userIds[i]].upstream
		tj := byUser[userIds[j]].keyword + byUser[userIds[j]].upstream
		if ti != tj {
			return ti > tj
		}
		return userIds[i] < userIds[j]
	})
	if len(userIds) > limit {
		userIds = userIds[:limit]
	}
	names, err := model.GetUserNamesByIds(userIds)
	if err != nil {
		return nil, err
	}
	out := make([]UserHitStat, 0, len(userIds))
	for _, uid := range userIds {
		a := byUser[uid]
		out = append(out, UserHitStat{
			UserId:        uid,
			Username:      names[uid],
			KeywordCount:  a.keyword,
			UpstreamCount: a.upstream,
			Count:         a.keyword + a.upstream,
		})
	}
	return out, nil
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
