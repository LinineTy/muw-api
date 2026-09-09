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

// TestGetUserBillingRecords 合并查询：充值记录 + 订阅订单统一列表，用户隔离 +
// 两种类型都返回 + 按时间倒序 + 行 id 唯一（订阅为负 id）。
func TestGetUserBillingRecords(t *testing.T) {
	truncateTables(t)
	insertTopUpForPaymentGuardTest(t, "TOPUP100NO1", 100, PaymentProviderEpay)
	insertTopUpForPaymentGuardTest(t, "TOPUP100NO2", 100, PaymentProviderBalance)
	insertTopUpForPaymentGuardTest(t, "TOPUP200NO1", 200, PaymentProviderEpay)
	insertSubscriptionOrderForQueryTest(t, "SUBUSR100NO1", 100, 1, common.TopUpStatusSuccess, "alipay")
	insertSubscriptionOrderForQueryTest(t, "SUBUSR200NO1", 200, 1, common.TopUpStatusSuccess, "alipay")

	pageInfo := &common.PageInfo{Page: 1, PageSize: 10}

	// 用户 100 只见本人：2 充值 + 1 订阅。
	records, total, err := GetUserBillingRecords(100, pageInfo, "", "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	require.Len(t, records, 3)

	types := map[string]bool{}
	seenIds := map[int]bool{}
	for _, r := range records {
		assert.Equal(t, 100, r.UserId)
		types[r.Type] = true
		// 行 id 全局唯一（订阅取负，充值保持正数）。
		assert.False(t, seenIds[r.Id], "duplicate row id %d", r.Id)
		seenIds[r.Id] = true
	}
	assert.True(t, types["topup"])
	assert.True(t, types["subscription"])

	// 订阅行携带 plan_id 且 id 为负；充值行不带 plan_id。
	var sub *BillingRecord
	for _, r := range records {
		if r.Type == "subscription" {
			sub = r
		}
	}
	require.NotNil(t, sub)
	assert.Equal(t, 1, sub.PlanId)
	assert.Less(t, sub.Id, 0)
	var topup *BillingRecord
	for _, r := range records {
		if r.Type == "topup" {
			topup = r
		}
	}
	require.NotNil(t, topup)
	assert.Equal(t, 0, topup.PlanId)
	assert.Greater(t, topup.Id, 0)

	// 按 create_time 倒序。
	for i := 1; i < len(records); i++ {
		assert.GreaterOrEqual(t, records[i-1].CreateTime, records[i].CreateTime)
	}

	// 类型筛选：只看订阅订单。
	subs, subTotal, err := GetUserBillingRecords(100, pageInfo, "", "", "", "subscription")
	require.NoError(t, err)
	assert.Equal(t, int64(1), subTotal)
	require.Len(t, subs, 1)
	assert.Equal(t, "subscription", subs[0].Type)

	// 类型筛选：只看充值记录。
	tops, topTotal, err := GetUserBillingRecords(100, pageInfo, "", "", "", "topup")
	require.NoError(t, err)
	assert.Equal(t, int64(2), topTotal)
	require.Len(t, tops, 2)
	for _, r := range tops {
		assert.Equal(t, "topup", r.Type)
	}
}

// TestGetAllBillingRecords 管理员合并查询：全平台充值 + 订阅，不做用户隔离。
func TestGetAllBillingRecords(t *testing.T) {
	truncateTables(t)
	insertTopUpForPaymentGuardTest(t, "TOPUP100NO1", 100, PaymentProviderEpay)
	insertSubscriptionOrderForQueryTest(t, "SUBUSR200NO1", 200, 1, common.TopUpStatusSuccess, "alipay")

	pageInfo := &common.PageInfo{Page: 1, PageSize: 10}
	records, total, err := GetAllBillingRecords(pageInfo, "", "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, records, 2)
}

// TestBillingRecordsResolveGroupPinTitles 固定分组订单与订阅订单同表：kind=group_pin
// 的行必须带上商品标题（订单中心此前按 plan_id=0 兜底显示 #0），且不误用套餐字段。
func TestBillingRecordsResolveGroupPinTitles(t *testing.T) {
	truncateTables(t)
	product := &GroupPinProduct{Title: "Pin A", Group: "tier1", PriceAmount: 1.5, Enabled: true}
	require.NoError(t, DB.Create(product).Error)
	require.NoError(t, (&SubscriptionOrder{
		UserId:          100,
		Kind:            OrderKindGroupPin,
		PinProductId:    product.Id,
		Money:           1.5,
		TradeNo:         "PINGRP100NO1",
		PaymentMethod:   PaymentMethodBalance,
		PaymentProvider: PaymentProviderBalance,
		Status:          common.TopUpStatusSuccess,
		CreateTime:      time.Now().Unix(),
	}).Insert())
	// 存量订阅订单 kind 为空串（迁移前落库），按订阅语义处理。
	insertSubscriptionOrderForQueryTest(t, "SUBUSR100NO1", 100, 1, common.TopUpStatusSuccess, "alipay")

	pageInfo := &common.PageInfo{Page: 1, PageSize: 10}
	records, _, err := GetUserBillingRecords(100, pageInfo, "", "", "", "subscription")
	require.NoError(t, err)
	require.Len(t, records, 2)

	var pin, sub *BillingRecord
	for _, r := range records {
		switch r.Kind {
		case OrderKindGroupPin:
			pin = r
		case OrderKindSubscription:
			sub = r
		}
	}
	require.NotNil(t, pin)
	assert.Equal(t, "Pin A", pin.PlanTitle)
	assert.Equal(t, product.Id, pin.PinProductId)
	assert.Zero(t, pin.PlanId)

	require.NotNil(t, sub)
	assert.Equal(t, 1, sub.PlanId)
	assert.Zero(t, sub.PinProductId)
}
