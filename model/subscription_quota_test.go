/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 复用独立计数器模型，验证四个限额各自独立生效：
// - Bug 3：自然周/月限额在订阅周期重置（daily）后仍累计，不被清零。
// - Bug 4：总额度设为 0（无限）时，周期/周/月限额仍然生效。
// - advanceSubscriptionWindows 的窗口推进边界。

func seedQuotaPlan(t *testing.T, id int, plan *SubscriptionPlan) {
	t.Helper()
	plan.Id = id
	require.NoError(t, DB.Create(plan).Error)
	InvalidateSubscriptionPlanCache(id)
}

func seedQuotaSub(t *testing.T, id int, sub *UserSubscription) {
	t.Helper()
	sub.Id = id
	require.NoError(t, DB.Create(sub).Error)
}

func newActiveQuotaSub(userId, planId int) *UserSubscription {
	now := GetDBTimestamp()
	return &UserSubscription{
		UserId:       userId,
		PlanId:       planId,
		AmountTotal:  0,
		Status:       "active",
		StartTime:    now - 86400,
		EndTime:      now + 30*24*3600,
		WeekStartAt:  weekStartUnix(time.Unix(now, 0)),
		MonthStartAt: monthStartUnix(time.Unix(now, 0)),
	}
}

func TestPreConsumeWeeklyCapSurvivesDailyReset(t *testing.T) {
	truncateTables(t)

	seedQuotaPlan(t, 7001, &SubscriptionPlan{
		Title: "daily+weekly", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		TotalAmount:       1000,
		QuotaResetPeriod:  SubscriptionResetDaily,
		WeeklyAmountLimit: 100,
	})
	sub := newActiveQuotaSub(701, 7001)
	sub.AmountTotal = 1000
	sub.NextCycleResetAt = GetDBTimestamp() - 10 // 周期已到期：首次预扣即触发重置
	seedQuotaSub(t, 7701, sub)

	res, err := PreConsumeUserSubscription("req-daily-1", 701, "gpt-4", 1, 80)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 80, res.PreConsumed)

	// daily 重置已发生，但自然周已用 80 → 本周只剩 20，预扣 50 必须被拒。
	_, err = PreConsumeUserSubscription("req-daily-2", 701, "gpt-4", 1, 50)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "subscription quota insufficient")

	var after UserSubscription
	require.NoError(t, DB.Where("id = ?", 7701).First(&after).Error)
	assert.EqualValues(t, 80, after.WeekUsed, "周用量必须保留")
	assert.EqualValues(t, 80, after.CycleUsed)
}

func TestPreConsumeWeeklyCapEnforcedWhenTotalAmountZero(t *testing.T) {
	truncateTables(t)

	seedQuotaPlan(t, 7002, &SubscriptionPlan{
		Title: "zero-total+weekly", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		TotalAmount:       0, // 无限总额
		WeeklyAmountLimit: 100,
	})
	seedQuotaSub(t, 7702, newActiveQuotaSub(702, 7002))

	res, err := PreConsumeUserSubscription("req-zero-1", 702, "gpt-4", 1, 60)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 60, res.PreConsumed)

	// 总额无限，但周限仍生效：剩余 40 < 50 → 拒绝。
	_, err = PreConsumeUserSubscription("req-zero-2", 702, "gpt-4", 1, 50)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "subscription quota insufficient")
}

func TestPreConsumeUnlimitedWhenNoCaps(t *testing.T) {
	truncateTables(t)

	seedQuotaPlan(t, 7003, &SubscriptionPlan{
		Title: "unlimited", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		TotalAmount: 0,
	})
	seedQuotaSub(t, 7703, newActiveQuotaSub(703, 7003))

	res, err := PreConsumeUserSubscription("req-unlim-1", 703, "gpt-4", 1, 1_000_000)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 1_000_000, res.PreConsumed)
}

func TestPreConsumeCycleCapGrantedFreshlyAfterReset(t *testing.T) {
	truncateTables(t)

	seedQuotaPlan(t, 7004, &SubscriptionPlan{
		Title: "cycle-cap", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		TotalAmount:      0,
		QuotaResetPeriod: SubscriptionResetCustom,
		QuotaResetCustomSeconds: 3600,
		ResetAmountLimit: 100,
	})
	sub := newActiveQuotaSub(704, 7004)
	sub.NextCycleResetAt = GetDBTimestamp() - 10
	seedQuotaSub(t, 7704, sub)

	res, err := PreConsumeUserSubscription("req-cycle-1", 704, "gpt-4", 1, 100)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 100, res.PreConsumed)

	// 周期已用满 100 → 拒绝，直到窗口推进后重新获得 100。
	_, err = PreConsumeUserSubscription("req-cycle-2", 704, "gpt-4", 1, 1)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "subscription quota insufficient")

	// 手动把窗口推到已过期，下一次预扣应先重置周期再放行。
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", 7704).
		Update("next_cycle_reset_at", GetDBTimestamp()-1).Error)

	res, err = PreConsumeUserSubscription("req-cycle-3", 704, "gpt-4", 1, 50)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.EqualValues(t, 50, res.PreConsumed)
}

func TestAdvanceSubscriptionWindowsWeeklyRollover(t *testing.T) {
	now := GetDBTimestamp()
	weekStart := weekStartUnix(time.Unix(now, 0))
	monthStart := monthStartUnix(time.Unix(now, 0))

	// 上上周的窗口，带残留用量 → 推进到本周并清零周用量。
	sub := &UserSubscription{
		WeekStartAt: weekStart - 14*86400, WeekUsed: 50,
		MonthStartAt: monthStart, MonthUsed: 0,
	}
	changed := advanceSubscriptionWindows(sub, &SubscriptionPlan{}, now)
	assert.True(t, changed)
	assert.Equal(t, weekStart, sub.WeekStartAt)
	assert.Zero(t, sub.WeekUsed)

	// 窗口未变 → 不动。
	sub2 := &UserSubscription{
		WeekStartAt: weekStart, WeekUsed: 50,
		MonthStartAt: monthStart, MonthUsed: 0,
	}
	assert.False(t, advanceSubscriptionWindows(sub2, &SubscriptionPlan{}, now))
}

func TestAdvanceSubscriptionWindowsCustomCycle(t *testing.T) {
	now := GetDBTimestamp()
	plan := &SubscriptionPlan{
		QuotaResetPeriod:       SubscriptionResetCustom,
		QuotaResetCustomSeconds: 3600,
	}
	sub := &UserSubscription{NextCycleResetAt: now - 1, CycleUsed: 100}
	changed := advanceSubscriptionWindows(sub, plan, now)
	assert.True(t, changed)
	assert.Zero(t, sub.CycleUsed)
	assert.InDelta(t, float64(now+3600), float64(sub.NextCycleResetAt), 5)
}

// TestRenewPreservesResetSchedule 保护续费语义：续费只延长订阅有效期并累加总额，
// 不能重新武装已排期的重置周期（否则会吞掉下一次重置，用户损失一个周期的配额）。
func TestRenewPreservesResetSchedule(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	nextReset := now + 11*86400 // 已排期的下次重置（如每月 1 号）
	plan := &SubscriptionPlan{
		Id: 7205, Title: "monthly-reset", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		TotalAmount: 1000, QuotaResetPeriod: SubscriptionResetMonthly,
	}
	require.NoError(t, DB.Create(plan).Error)
	InvalidateSubscriptionPlanCache(7205)

	sub := &UserSubscription{
		Id: 7206, UserId: 902, PlanId: plan.Id, Status: "active",
		AmountTotal: 1000, AmountUsed: 100,
		StartTime: now - 20 * 86400, EndTime: nextReset,
		CycleStartAt: now - 20 * 86400, CycleUsed: 40, NextCycleResetAt: nextReset,
	}
	require.NoError(t, DB.Create(sub).Error)

	// 在下一次重置之前续费。
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		var locked UserSubscription
		require.NoError(t, tx.Where("id = ?", sub.Id).First(&locked).Error)
		return RenewSubscriptionTx(tx, &locked, plan, now)
	}))

	var after UserSubscription
	require.NoError(t, DB.Where("id = ?", sub.Id).First(&after).Error)
	assert.Equal(t, nextReset, after.NextCycleResetAt, "续费不应推后已排期的重置周期")
	assert.Greater(t, after.EndTime, nextReset, "续费应延长订阅有效期")
	assert.EqualValues(t, 2000, after.AmountTotal)
}

// TestCancelAtEndBlocksRenewal 保护到期取消语义：cancel_at_end 的订阅禁止任何续费。
// RenewSubscriptionTx 是余额/自动/epay 回调的公共咽喉，ValidateSubscriptionPurchaseGate
// 是 epay 创建订单前的网关，两处都必须拒绝续费目标，且被拒后订阅有效期不得改变。
func TestCancelAtEndBlocksRenewal(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	seedQuotaPlan(t, 7101, &SubscriptionPlan{
		Title: "cancel-at-end", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		TotalAmount: 1000,
	})
	seedQuotaSub(t, 7102, &UserSubscription{
		UserId: 720, PlanId: 7101, Status: "active",
		AmountTotal: 1000, CancelAtEnd: true,
		StartTime: now - 86400, EndTime: now + 30*86400,
	})

	// 公共续费咽喉直接拒绝。
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := tx.Where("id = ?", 7102).First(&sub).Error; err != nil {
			return err
		}
		plan, err := getSubscriptionPlanByIdTx(tx, 7101)
		if err != nil {
			return err
		}
		return RenewSubscriptionTx(tx, &sub, plan, now)
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "到期取消")

	var after UserSubscription
	require.NoError(t, DB.Where("id = ?", 7102).First(&after).Error)
	assert.Equal(t, now+30*86400, after.EndTime, "续费被拒后订阅有效期不得改变")

	// epay 网关：创建订单前拒绝续费目标（否则订单已支付后回调才发现不能续，变成坏账）。
	require.NoError(t, DB.Create(&User{Id: 720, Username: "cancel-at-end-user"}).Error)
	plan, err := GetSubscriptionPlanById(7101)
	require.NoError(t, err)
	err = ValidateSubscriptionPurchaseGate(720, plan, 7102)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "到期取消")

	// 对照组：非 cancel_at_end 的订阅可通过续费目标检查，不被误伤。
	seedQuotaSub(t, 7103, &UserSubscription{
		UserId: 720, PlanId: 7101, Status: "active",
		AmountTotal: 1000,
		StartTime: now - 86400, EndTime: now + 30*86400,
	})
	require.NoError(t, ValidateSubscriptionPurchaseGate(720, plan, 7103))
}
