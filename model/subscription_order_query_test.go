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

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func insertSubscriptionOrderForQueryTest(t *testing.T, tradeNo string, userID, planID int, status, method string) {
	t.Helper()
	order := &SubscriptionOrder{
		UserId:          userID,
		PlanId:          planID,
		Money:           9.99,
		TradeNo:         tradeNo,
		PaymentMethod:   method,
		PaymentProvider: method,
		Status:          status,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, order.Insert())
}

// TestGetUserSubscriptionOrders 用户侧订阅订单查询：用户隔离 + trade_no 搜索 + 状态/支付方式过滤。
// 订阅订单是资金记录，用户只能看到本人订单，接口契约必须守住隔离。
func TestGetUserSubscriptionOrders(t *testing.T) {
	truncateTables(t)
	insertSubscriptionOrderForQueryTest(t, "SUBUSR100NO1", 100, 1, common.TopUpStatusSuccess, "alipay")
	insertSubscriptionOrderForQueryTest(t, "SUBUSR100NO2", 100, 1, common.TopUpStatusPending, "epay")
	insertSubscriptionOrderForQueryTest(t, "SUBUSR200NO1", 200, 1, common.TopUpStatusSuccess, "alipay")

	pageInfo := &common.PageInfo{Page: 1, PageSize: 10}

	// 用户隔离：100 只见本人 2 单，看不到 200 的单。
	orders, total, err := GetUserSubscriptionOrders(100, pageInfo, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, orders, 2)
	for _, o := range orders {
		assert.Equal(t, 100, o.UserId)
	}

	// trade_no 精确搜索命中 1 单。
	orders, total, err = GetUserSubscriptionOrders(100, pageInfo, "SUBUSR100NO2", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, orders, 1)
	assert.Equal(t, "SUBUSR100NO2", orders[0].TradeNo)

	// 状态过滤：pending。
	orders, total, err = GetUserSubscriptionOrders(100, pageInfo, "", common.TopUpStatusPending, "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, orders, 1)
	assert.Equal(t, "SUBUSR100NO2", orders[0].TradeNo)

	// 支付方式过滤：alipay。
	orders, total, err = GetUserSubscriptionOrders(100, pageInfo, "", "", "alipay")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, orders, 1)
	assert.Equal(t, "SUBUSR100NO1", orders[0].TradeNo)
}

// TestGetAllSubscriptionOrders 管理员全平台查询：不做用户隔离，返回所有订单。
func TestGetAllSubscriptionOrders(t *testing.T) {
	truncateTables(t)
	insertSubscriptionOrderForQueryTest(t, "SUBUSR100NO1", 100, 1, common.TopUpStatusSuccess, "alipay")
	insertSubscriptionOrderForQueryTest(t, "SUBUSR100NO2", 100, 1, common.TopUpStatusPending, "epay")
	insertSubscriptionOrderForQueryTest(t, "SUBUSR200NO1", 200, 1, common.TopUpStatusSuccess, "alipay")

	pageInfo := &common.PageInfo{Page: 1, PageSize: 10}
	orders, total, err := GetAllSubscriptionOrders(pageInfo, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	require.Len(t, orders, 3)

	// 按 status 过滤全平台 pending。
	orders, total, err = GetAllSubscriptionOrders(pageInfo, "", common.TopUpStatusPending, "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, orders, 1)
	assert.Equal(t, "SUBUSR100NO2", orders[0].TradeNo)
}
