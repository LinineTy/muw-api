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

// TestAdminBindSubscriptionRespectsSimultaneousCap 保护全局同时持有套餐数量上限：
// 达到上限时绑定被拒，未达上限时允许。
func TestAdminBindSubscriptionRespectsSimultaneousCap(t *testing.T) {
	truncateTables(t)

	prevCap := common.SubscriptionMaxSimultaneous
	common.SubscriptionMaxSimultaneous = 2
	defer func() { common.SubscriptionMaxSimultaneous = prevCap }()

	now := GetDBTimestamp()
	plan := &SubscriptionPlan{
		Id: 7101, Title: "Cap", PriceAmount: 10,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		TotalAmount: 1000,
	}
	require.NoError(t, DB.Create(plan).Error)
	InvalidateSubscriptionPlanCache(7101)

	// AdminBindSubscription 加了用户行锁(并发下 MaxPurchasePerUser 检查按用户串行),
	// 要求绑定目标用户存在,补 fixture。
	require.NoError(t, DB.Create(&User{Id: 801, Username: "cap-test-user"}).Error)

	// 已持 2 个活跃订阅 → 绑定第 3 个被拒。
	for _, id := range []int{7101, 7102} {
		require.NoError(t, DB.Create(&UserSubscription{
			Id: id, UserId: 801, PlanId: plan.Id, Status: "active",
			StartTime: now - 86400, EndTime: now + 86400,
		}).Error)
	}
	_, err := AdminBindSubscription(801, plan.Id, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "上限")

	// 上限放宽到 3 → 允许。
	common.SubscriptionMaxSimultaneous = 3
	_, err = AdminBindSubscription(801, plan.Id, "")
	require.NoError(t, err)
}

func TestCountActiveUserSubscriptions(t *testing.T) {
	truncateTables(t)

	now := GetDBTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{Id: 7201, UserId: 802, Status: "active", StartTime: now - 86400, EndTime: now + 86400}).Error)
	require.NoError(t, DB.Create(&UserSubscription{Id: 7202, UserId: 802, Status: "active", StartTime: now - 86400, EndTime: now + 86400}).Error)
	require.NoError(t, DB.Create(&UserSubscription{Id: 7203, UserId: 802, Status: "expired", StartTime: now - 2 * 86400, EndTime: now - 86400}).Error)

	count, err := CountActiveUserSubscriptions(802)
	require.NoError(t, err)
	assert.EqualValues(t, 2, count)
}
