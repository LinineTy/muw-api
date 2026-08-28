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
	// 跟得上 5 小时窗滚动/周重置。套餐余量端点是轻量 GET,一组一请求,几个套餐账号
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

// runCodingPlanAutoControlOnce 跑一轮自动启停:查开了自动管理的渠道 → 按 (厂商, 生效
// key) 分组 → 每组一次余量查询 → 组内每渠道按各自阈值决策禁用/恢复。查询失败(瞬时
// 或确定性)一律跳过本轮,绝不基于失败结果翻状态。
func runCodingPlanAutoControlOnce() {
	if !codingPlanAutoControlRunning.CompareAndSwap(false, true) {
		return
	}
	defer codingPlanAutoControlRunning.Store(false)

	ctx := context.Background()

	var channels []*model.Channel
	err := model.DB.
		Select("id", "name", "type", "key", "base_url", "status", "other_info",
			"coding_plan_provider", "coding_plan_key",
			"coding_plan_auto_control", "coding_plan_disable_threshold", "coding_plan_enable_threshold").
		Where("coding_plan_auto_control = ?", true).
		Find(&channels).Error
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: query channels failed: %v", err))
		return
	}
	if len(channels) == 0 {
		return
	}

	// 按 (厂商, 生效 key) 分组:同套餐账号的渠道共享一次余量查询。
	type codingPlanGroup struct {
		provider CodingPlanProvider
		key      string
		members  []*model.Channel
	}
	groups := make(map[string]*codingPlanGroup)
	for _, ch := range channels {
		provider, err := ResolveChannelCodingPlanProvider(ch)
		if err != nil {
			continue // 厂商无法解析(如显式 none 却残留开关),跳过
		}
		key := ch.CodingPlanKey
		if key == "" {
			key = ch.Key
		}
		if strings.Contains(key, "\n") {
			continue // 多 key 渠道无单一套餐账号,跳过
		}
		groupKey := string(provider) + "\x00" + key
		g := groups[groupKey]
		if g == nil {
			g = &codingPlanGroup{provider: provider, key: key}
			groups[groupKey] = g
		}
		g.members = append(g.members, ch)
	}

	changed := false
	for _, g := range groups {
		quota, err := QueryCodingPlanQuota(ctx, g.provider, g.key)
		if err != nil {
			// 瞬时传输失败(超时/断连),本轮跳过,等下一轮。
			logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: quota query failed: provider=%s err=%v", g.provider, err))
			continue
		}
		if !quota.Success {
			// 确定性失败(鉴权失败/业务错误/解析失败),也跳过,不据失败翻状态。
			logger.LogWarn(ctx, fmt.Sprintf("coding plan auto-control: quota query failed: provider=%s error=%s", g.provider, quota.Error))
			continue
		}
		utilization := CodingPlanEffectiveUtilization(quota)
		for _, ch := range g.members {
			statusReason := fmt.Sprint(ch.GetOtherInfo()["status_reason"])
			disable, enable := CodingPlanAutoControlThresholds(ch)
			switch decideCodingPlanAutoControl(ch.Status, statusReason, utilization, disable, enable) {
			case CodingPlanAutoControlDisable:
				if model.UpdateChannelStatus(ch.Id, "", common.ChannelStatusAutoDisabled, CodingPlanExhaustedReason) {
					changed = true
					logger.LogInfo(ctx, fmt.Sprintf("coding plan auto-control: disabled channel_id=%d name=%s (utilization=%.1f%%)", ch.Id, ch.Name, utilization))
				}
			case CodingPlanAutoControlEnable:
				if model.UpdateChannelStatus(ch.Id, "", common.ChannelStatusEnabled, CodingPlanRecoveredReason) {
					changed = true
					logger.LogInfo(ctx, fmt.Sprintf("coding plan auto-control: re-enabled channel_id=%d name=%s (utilization=%.1f%%)", ch.Id, ch.Name, utilization))
				}
			}
		}
	}
	if changed {
		model.InitChannelCache()
	}
}
