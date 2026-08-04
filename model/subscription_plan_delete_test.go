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

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDeleteSubscriptionPlan 保护订阅计划删除的引用完整性：
// 只有运行时会按 id 回查套餐的记录（活跃订阅、待支付订单）会拦截删除；
// 历史记录（已过期订阅、已完成订单）只影响展示，不拦截，管理端清掉历史后即可删除。
func TestDeleteSubscriptionPlan(t *testing.T) {
	truncateTables(t)

	now := common.GetTimestamp()

	// 无引用套餐：可删除，记录消失。
	require.NoError(t, DB.Create(&SubscriptionPlan{
		Id: 7301, Title: "Unused", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
	}).Error)
	msg, err := DeleteSubscriptionPlan(7301)
	require.NoError(t, err)
	assert.Equal(t, "删除成功", msg)
	var remaining int64
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", 7301).Count(&remaining).Error)
	assert.Zero(t, remaining)

	// 活跃订阅：拒绝删除（计费/重置/续费按 id 回查套餐）。
	require.NoError(t, DB.Create(&SubscriptionPlan{
		Id: 7302, Title: "Subscribed", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
	}).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		Id: 730201, UserId: 803, PlanId: 7302, Status: "active",
		StartTime: now - 86400, EndTime: now + 86400,
	}).Error)
	_, err = DeleteSubscriptionPlan(7302)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "无法删除")

	// 已过期订阅（status 仍为 active 但 end_time 已过）：不拦截。
	require.NoError(t, DB.Create(&SubscriptionPlan{
		Id: 7303, Title: "ExpiredSub", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
	}).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		Id: 730301, UserId: 803, PlanId: 7303, Status: "active",
		StartTime: now - 2*86400, EndTime: now - 86400,
	}).Error)
	msg, err = DeleteSubscriptionPlan(7303)
	require.NoError(t, err)
	assert.Equal(t, "删除成功", msg)

	// 待支付订单：拒绝删除（支付回调按 id 回查套餐）。
	require.NoError(t, DB.Create(&SubscriptionPlan{
		Id: 7304, Title: "PendingOrder", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
	}).Error)
	require.NoError(t, DB.Create(&SubscriptionOrder{
		Id: 730401, UserId: 803, PlanId: 7304, TradeNo: "DEL_TEST_ORDER_PENDING",
		Status: common.TopUpStatusPending,
	}).Error)
	_, err = DeleteSubscriptionPlan(7304)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "无法删除")

	// 已完成订单：不拦截。
	require.NoError(t, DB.Create(&SubscriptionPlan{
		Id: 7305, Title: "CompletedOrder", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
	}).Error)
	require.NoError(t, DB.Create(&SubscriptionOrder{
		Id: 730501, UserId: 803, PlanId: 7305, TradeNo: "DEL_TEST_ORDER_DONE",
		Status: common.TopUpStatusSuccess,
	}).Error)
	msg, err = DeleteSubscriptionPlan(7305)
	require.NoError(t, err)
	assert.Equal(t, "删除成功", msg)

	// 不存在的套餐：报错。
	_, err = DeleteSubscriptionPlan(7309)
	require.Error(t, err)
}
