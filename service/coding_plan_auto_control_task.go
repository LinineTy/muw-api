package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	// codingPlanAutoControlTickInterval 编码套餐自动启停轮询间隔。禁用拦截要赶在
	// 缓冲耗尽前(默认禁用阈值 98%,2% 缓冲按当前用量可能撑不满一个长间隔),恢复要
	// 跟得上 5 小时窗滚动/周重置。套餐余量端点是轻量 GET,一账户一请求,几个套餐账号
	// 每分钟仅数次请求,负担可忽略。
	codingPlanAutoControlTickInterval = 30 * time.Second
)

var (
	codingPlanAutoControlOnce    sync.Once
	codingPlanAutoControlRunning atomic.Bool
)

func StartCodingPlanAutoControlTask() {
	codingPlanAutoControlOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}

		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("coding plan auto-control task started: tick=%s", codingPlanAutoControlTickInterval))

			ticker := time.NewTicker(codingPlanAutoControlTickInterval)
			defer ticker.Stop()

			runCodingPlanAutoControlOnce()
			for range ticker.C {
				runCodingPlanAutoControlOnce()
			}
		})
	})
}

// runCodingPlanAutoControlOnce 跑一轮自动启停(账户版,凭证与渠道解耦后配置/状态都在
// 账户上):查开了自动管理的账户 → 每账户一次余量查询 → 账户级滞回决策 → 禁用=禁
// 账户+联动禁用全部引用渠道(status_reason=套餐耗尽),恢复=恢复账户+只恢复由本任务
// 禁用的渠道(手动禁用/relay 错误禁用不碰)。查询失败(瞬时或确定性)一律跳过本轮,
// 绝不基于失败结果翻状态。
func runCodingPlanAutoControlOnce() {
	if !codingPlanAutoControlRunning.CompareAndSwap(false, true) {
		return
	}
	defer codingPlanAutoControlRunning.Store(false)

	ctx := context.Background()

	var accounts []*model.Account
	err := model.DB.
		Select("id", "name", "type", "key", "base_url", "status", "other_info",
			"coding_plan_provider", "coding_plan_key",
			"coding_plan_auto_control", "coding_plan_disable_threshold", "coding_plan_enable_threshold").
		Where("coding_plan_auto_control = ?", true).
		Find(&accounts).Error
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: query accounts failed: %v", err))
		return
	}
	if len(accounts) == 0 {
		return
	}

	// 引用渠道一次加载(含 other_info/status,供联动过滤),按账户分组。
	var channels []*model.Channel
	err = model.DB.
		Select("id", "name", "account_id", "status", "other_info").
		Where("account_id IN ?", accountIds(accounts)).
		Find(&channels).Error
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: query member channels failed: %v", err))
		return
	}
	channelsByAccount := make(map[int][]*model.Channel)
	for _, ch := range channels {
		channelsByAccount[ch.AccountId] = append(channelsByAccount[ch.AccountId], ch)
	}

	changed := false
	for _, account := range accounts {
		members := channelsByAccount[account.Id]
		if len(members) == 0 {
			continue // 无引用渠道:无可联动对象,跳过(账户余额卡仍可单独查)
		}
		provider, err := ResolveAccountCodingPlanProvider(account)
		if err != nil {
			continue // 厂商无法解析(如显式 none 却残留开关),跳过
		}
		key := account.CodingPlanKey
		if key == "" {
			key = account.Key
		}
		if strings.Contains(key, "\n") {
			continue // 多 key 账户无单一套餐账号,跳过(专用 key 未配)
		}
		quota, err := QueryCodingPlanQuota(ctx, provider, key)
		if err != nil {
			// 瞬时传输失败(超时/断连),本轮跳过,等下一轮。
			logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: quota query failed: account_id=%d provider=%s err=%v", account.Id, provider, err))
			continue
		}
		if !quota.Success {
			// 确定性失败(鉴权失败/业务错误/解析失败),也跳过,不据失败翻状态。
			logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: quota query failed: account_id=%d provider=%s error=%s", account.Id, provider, quota.Error))
			continue
		}
		utilization := CodingPlanEffectiveUtilization(quota)
		statusReason := fmt.Sprint(account.GetOtherInfo()["status_reason"])
		disable, enable := CodingPlanAccountAutoControlThresholds(account)
		switch decideCodingPlanAutoControl(account.Status, statusReason, utilization, disable, enable) {
		case CodingPlanAutoControlDisable:
			if disableAccountWithChannels(ctx, account, members) {
				changed = true
			}
		case CodingPlanAutoControlEnable:
			if enableAccountWithChannels(ctx, account, members) {
				changed = true
			}
		}
	}
	if changed {
		model.InitChannelCache()
	}
}

// accountIds 提取账户 id 列表(成员渠道查询用)。
func accountIds(accounts []*model.Account) []int {
	ids := make([]int, 0, len(accounts))
	for _, a := range accounts {
		ids = append(ids, a.Id)
	}
	return ids
}

// disableAccountWithChannels 禁用落点(maintainer拍板):禁账户 + 联动禁用全部引用渠道。
// 渠道侧 status_reason 用套餐耗尽标记,恢复只认这个标记(手动禁用不误伤)。
// disableAccountWithChannels 禁用账户自身（套餐耗尽）。
//
// 语义（2026-09-10 maintainer定，随渠道↔账户 N:N 改造）：**不再连带禁用引用它的渠道**——
// 一个渠道可绑多个账户，某个账户烧完只让该渠道在选路时跳过它（见
// model.Channel.getNextKeyAcrossAccounts）。只有当渠道绑定的账户**全部**不可用时，
// 才把渠道自己也置为不可用，保持"渠道不可用"的对外语义（单账户渠道行为与旧版一致）。
func disableAccountWithChannels(ctx context.Context, account *model.Account, members []*model.Channel) bool {
	changed := false
	// 账户置禁用 + 状态原因(滞回判据)。
	info := account.GetOtherInfo()
	info["status_reason"] = CodingPlanExhaustedReason
	info["status_time"] = common.GetTimestamp()
	account.SetOtherInfo(info)
	account.Status = common.ChannelStatusAutoDisabled
	if err := account.SaveStatusState(); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: failed to disable account: account_id=%d err=%v", account.Id, err))
		return false
	}
	logger.LogInfo(ctx, fmt.Sprintf("coding plan auto-control: disabled account_id=%d name=%s", account.Id, account.Name))
	// 渠道侧：绑定的账户还有能用的就只跳过本账户；全不可用才禁用渠道。
	for _, ch := range members {
		usable, err := model.HasUsableBoundAccount(ch.Id)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: check channel accounts failed: channel_id=%d err=%v", ch.Id, err))
			continue
		}
		if usable {
			logger.LogInfo(ctx, fmt.Sprintf("coding plan auto-control: account skipped by channel (still has usable account): account_id=%d channel_id=%d name=%s", account.Id, ch.Id, ch.Name))
			continue
		}
		if model.UpdateChannelStatus(ch.Id, "", common.ChannelStatusAutoDisabled, CodingPlanExhaustedReason) {
			changed = true
			logger.LogInfo(ctx, fmt.Sprintf("coding plan auto-control: channel disabled (all bound accounts unusable): account_id=%d channel_id=%d name=%s", account.Id, ch.Id, ch.Name))
		}
	}
	return changed
}

// enableAccountWithChannels 恢复:恢复账户 + 只恢复由本任务禁用的渠道
// (status_reason == 套餐恢复/耗尽标记);手动禁用与 relay 错误禁用的渠道不动。
func enableAccountWithChannels(ctx context.Context, account *model.Account, members []*model.Channel) bool {
	changed := false
	info := account.GetOtherInfo()
	info["status_reason"] = CodingPlanRecoveredReason
	info["status_time"] = common.GetTimestamp()
	account.SetOtherInfo(info)
	account.Status = common.ChannelStatusEnabled
	if err := account.SaveStatusState(); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: failed to enable account: account_id=%d err=%v", account.Id, err))
		return false
	}
	logger.LogInfo(ctx, fmt.Sprintf("coding plan auto-control: re-enabled account_id=%d name=%s", account.Id, account.Name))
	for _, ch := range members {
		// 只恢复自己禁的:渠道状态是自动禁用且原因匹配套餐标记。
		if ch.Status != common.ChannelStatusAutoDisabled {
			continue
		}
		if fmt.Sprint(ch.GetOtherInfo()["status_reason"]) != CodingPlanExhaustedReason {
			continue
		}
		if model.UpdateChannelStatus(ch.Id, "", common.ChannelStatusEnabled, CodingPlanRecoveredReason) {
			changed = true
			logger.LogInfo(ctx, fmt.Sprintf("coding plan auto-control: linked channel re-enabled: account_id=%d channel_id=%d name=%s", account.Id, ch.Id, ch.Name))
		}
	}
	return changed
}
