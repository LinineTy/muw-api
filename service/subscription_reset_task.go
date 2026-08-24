package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	// 订阅维护 tick：10s。过期回退/自动续费/窗口重置都受此节奏约束，用户常用 30s 级
	// 短订阅，1 分钟 tick 会让分组回退滞后接近两个订阅生命周期。惰性过期（请求路径）
	// 已让有请求的场景即时生效，这里只作无请求场景的兜底。
	subscriptionResetTickInterval = 10 * time.Second
	subscriptionResetBatchSize    = 300
	subscriptionCleanupInterval   = 30 * time.Minute
)

var (
	subscriptionResetOnce    sync.Once
	subscriptionResetRunning atomic.Bool
	subscriptionCleanupLast  atomic.Int64
)

func StartSubscriptionQuotaResetTask() {
	subscriptionResetOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("subscription quota reset task started: tick=%s", subscriptionResetTickInterval))
			ticker := time.NewTicker(subscriptionResetTickInterval)
			defer ticker.Stop()

			runSubscriptionQuotaResetOnce()
			for range ticker.C {
				runSubscriptionQuotaResetOnce()
			}
		})
	})
}

func runSubscriptionQuotaResetOnce() {
	if !subscriptionResetRunning.CompareAndSwap(false, true) {
		return
	}
	defer subscriptionResetRunning.Store(false)

	ctx := context.Background()
	totalExpired := 0
	for {
		n, err := model.ExpireDueSubscriptions(subscriptionResetBatchSize)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("subscription expire task failed: %v", err))
			return
		}
		if n == 0 {
			break
		}
		totalExpired += n
		if n < subscriptionResetBatchSize {
			break
		}
	}
	totalAutoRenew, err := model.AutoRenewDueSubscriptions(subscriptionResetBatchSize)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("subscription auto-renew task failed: %v", err))
	} else if totalAutoRenew > 0 {
		logger.LogInfo(ctx, fmt.Sprintf("subscription auto-renewed: %d", totalAutoRenew))
	}
	lastCleanup := time.Unix(subscriptionCleanupLast.Load(), 0)
	if time.Since(lastCleanup) >= subscriptionCleanupInterval {
		if _, err := model.CleanupSubscriptionPreConsumeRecords(7 * 24 * 3600); err == nil {
			subscriptionCleanupLast.Store(time.Now().Unix())
		}
	}
	if common.DebugEnabled && totalExpired > 0 {
		logger.LogDebug(ctx, "subscription maintenance: expired_count=%d", totalExpired)
	}
}
