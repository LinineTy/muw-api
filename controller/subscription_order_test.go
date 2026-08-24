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
package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupSubscriptionOrdersTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db

	require.NoError(t, db.AutoMigrate(
		&model.User{}, &model.SubscriptionPlan{}, &model.SubscriptionOrder{},
		&model.UserSubscription{}, &model.TopUp{}, &model.Log{},
	))
	return db
}

func insertSubscriptionOrderForEndpointTest(t *testing.T, tradeNo string, userID, planID int, status, method string) {
	t.Helper()
	order := &model.SubscriptionOrder{
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

func insertSubscriptionPlanForEndpointTest(t *testing.T, id int) *model.SubscriptionPlan {
	t.Helper()
	plan := &model.SubscriptionPlan{
		Id:            id,
		Title:         "Endpoint Plan",
		PriceAmount:   9.99,
		Currency:      "USD",
		DurationUnit:  model.SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
	}
	require.NoError(t, model.DB.Create(plan).Error)
	return plan
}

func insertUserForEndpointTest(t *testing.T, id int) {
	t.Helper()
	user := &model.User{
		Id:       id,
		Username: "sub_order_endpoint_user",
		Status:   common.UserStatusEnabled,
		Quota:    100000,
	}
	require.NoError(t, model.DB.Create(user).Error)
}

func newSubscriptionOrdersTestEngine(userId, role int) *gin.Engine {
	router := gin.New()
	router.GET("/orders", func(c *gin.Context) {
		c.Set("id", userId)
		c.Set("role", role)
		GetUserSubscriptionOrders(c)
	})
	router.GET("/admin/orders", func(c *gin.Context) {
		c.Set("id", userId)
		c.Set("role", role)
		AdminListSubscriptionOrders(c)
	})
	router.POST("/admin/orders/complete", func(c *gin.Context) {
		c.Set("id", userId)
		c.Set("role", role)
		AdminCompleteSubscriptionOrder(c)
	})
	router.POST("/admin/orders/reject", func(c *gin.Context) {
		c.Set("id", userId)
		c.Set("role", role)
		AdminRejectSubscriptionOrder(c)
	})
	return router
}

func decodeSubscriptionOrdersEndpoint(t *testing.T, rec *httptest.ResponseRecorder) (items []model.SubscriptionOrder, total int) {
	t.Helper()
	var resp struct {
		Success bool `json:"success"`
		Message string `json:"message"`
		Data    struct {
			Items []model.SubscriptionOrder `json:"items"`
			Total int                       `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &resp))
	require.True(t, resp.Success, resp.Message)
	return resp.Data.Items, resp.Data.Total
}

// TestSubscriptionOrdersEndpointIsolation 查询端点：用户只返回本人订单，管理员返回全平台。
func TestSubscriptionOrdersEndpointIsolation(t *testing.T) {
	setupSubscriptionOrdersTestDB(t)
	insertSubscriptionOrderForEndpointTest(t, "SUBUSR100NO1", 100, 1, common.TopUpStatusSuccess, "alipay")
	insertSubscriptionOrderForEndpointTest(t, "SUBUSR100NO2", 100, 1, common.TopUpStatusPending, "epay")
	insertSubscriptionOrderForEndpointTest(t, "SUBUSR200NO1", 200, 1, common.TopUpStatusSuccess, "alipay")

	userRouter := newSubscriptionOrdersTestEngine(100, common.RoleCommonUser)
	rec := httptest.NewRecorder()
	userRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/orders?p=1&page_size=10", nil))
	items, total := decodeSubscriptionOrdersEndpoint(t, rec)
	assert.Equal(t, 2, total)
	require.Len(t, items, 2)
	for _, o := range items {
		assert.Equal(t, 100, o.UserId)
	}

	adminRouter := newSubscriptionOrdersTestEngine(1, common.RoleRootUser)
	rec = httptest.NewRecorder()
	adminRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin/orders?p=1&page_size=10", nil))
	items, total = decodeSubscriptionOrdersEndpoint(t, rec)
	assert.Equal(t, 3, total)
	require.Len(t, items, 3)
}

// TestAdminRejectSubscriptionOrderEndpoint 管理员驳回：pending → expired。
func TestAdminRejectSubscriptionOrderEndpoint(t *testing.T) {
	setupSubscriptionOrdersTestDB(t)
	insertSubscriptionOrderForEndpointTest(t, "SUBUSR100NOpend", 100, 1, common.TopUpStatusPending, "epay")

	router := newSubscriptionOrdersTestEngine(1, common.RoleRootUser)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/admin/orders/reject",
		bytes.NewBufferString(`{"trade_no":"SUBUSR100NOpend"}`)))

	var resp struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &resp))
	require.True(t, resp.Success, resp.Message)

	order := model.GetSubscriptionOrderByTradeNo("SUBUSR100NOpend")
	require.NotNil(t, order)
	assert.Equal(t, common.TopUpStatusExpired, order.Status)
}

// TestAdminCompleteSubscriptionOrderEndpoint 管理员补单：pending → 已支付 + 创建订阅（资金处置核心契约）。
func TestAdminCompleteSubscriptionOrderEndpoint(t *testing.T) {
	setupSubscriptionOrdersTestDB(t)
	insertUserForEndpointTest(t, 100)
	insertSubscriptionPlanForEndpointTest(t, 1)
	insertSubscriptionOrderForEndpointTest(t, "SUBUSR100NOpend", 100, 1, common.TopUpStatusPending, "epay")

	router := newSubscriptionOrdersTestEngine(1, common.RoleRootUser)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/admin/orders/complete",
		bytes.NewBufferString(`{"trade_no":"SUBUSR100NOpend"}`)))

	var resp struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &resp))
	require.True(t, resp.Success, resp.Message)

	order := model.GetSubscriptionOrderByTradeNo("SUBUSR100NOpend")
	require.NotNil(t, order)
	assert.Equal(t, common.TopUpStatusSuccess, order.Status)

	var subCount int64
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).
		Where("user_id = ?", 100).Count(&subCount).Error)
	assert.Equal(t, int64(1), subCount)
}
