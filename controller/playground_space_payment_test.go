package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// migratePlaygroundSpaceOrder 在共享测试库上补建云空间支付订单表。
func migratePlaygroundSpaceOrder(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.PlaygroundSpaceOrder{}))
}

// migrateLog 在共享测试库上补建日志表（RecordLog 写 LOG_DB）。
func migrateLog(t *testing.T) {
	t.Helper()
	require.NoError(t, model.LOG_DB.AutoMigrate(&model.Log{}))
}

// countTopupLogs 统计某用户的 LogTypeTopup 日志条数。
func countTopupLogs(t *testing.T, userId int) int64 {
	t.Helper()
	var cnt int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).
		Where("user_id = ? AND type = ?", userId, model.LogTypeTopup).Count(&cnt).Error)
	return cnt
}

func newPendingSpaceOrder(t *testing.T, userId, mb int, tradeNo string) *model.PlaygroundSpaceOrder {
	t.Helper()
	order := &model.PlaygroundSpaceOrder{
		UserId:          userId,
		Mb:              mb,
		Money:           1.0,
		TradeNo:         tradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: model.PaymentProviderEpay,
		Status:          common.TopUpStatusPending,
	}
	require.NoError(t, order.Insert())
	return order
}

func mustGetUser(t *testing.T, id int) *model.User {
	t.Helper()
	user, err := model.GetUserById(id, false)
	require.NoError(t, err)
	return user
}

// restoreEpaySettings 保存并恢复 operation_setting 的易支付配置。
func restoreEpaySettings(t *testing.T) {
	t.Helper()
	payAddress, epayID, epayKey := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey
	payMethods := operation_setting.PayMethods
	t.Cleanup(func() {
		operation_setting.PayAddress = payAddress
		operation_setting.EpayId = epayID
		operation_setting.EpayKey = epayKey
		operation_setting.PayMethods = payMethods
	})
}

func newPlaygroundSpacePayTestEngine(userId int) *gin.Engine {
	router := gin.New()
	router.POST("/pay", func(c *gin.Context) {
		c.Set("id", userId)
		c.Set("user_group", "default")
		RequestPlaygroundSpaceEpay(c)
	})
	return router
}

// TestCompletePlaygroundSpaceOrder 幂等完成：首次扩容，重复回调不重复扩容、不重复记日志。
func TestCompletePlaygroundSpaceOrder(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	migrateLog(t)
	insertTestUserWithSpace(t, 100, 0, 0)
	initial := int64(setting.UserSpaceInitialMB) << 20
	order := newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOidem1")

	require.NoError(t, model.CompletePlaygroundSpaceOrder(order.TradeNo, "{}", model.PaymentProviderEpay, "alipay", initial, 0))

	user := mustGetUser(t, 100)
	assert.Equal(t, initial+10<<20, user.SpaceCapacity)
	assert.Equal(t, int64(10)<<20, user.SpacePurchasedBytes)
	got := model.GetPlaygroundSpaceOrderByTradeNo(order.TradeNo)
	require.NotNil(t, got)
	assert.Equal(t, common.TopUpStatusSuccess, got.Status)
	assert.Equal(t, "alipay", got.PaymentMethod)

	// 幂等：再次回调（换支付方式）不扩容。
	require.NoError(t, model.CompletePlaygroundSpaceOrder(order.TradeNo, "{}", model.PaymentProviderEpay, "wxpay", initial, 0))
	user = mustGetUser(t, 100)
	assert.Equal(t, initial+10<<20, user.SpaceCapacity)
	assert.Equal(t, int64(10)<<20, user.SpacePurchasedBytes)
	// 用户日志只记一条（重复回调不重复记录）。
	assert.Equal(t, int64(1), countTopupLogs(t, 100))
}

// TestPurchasePlaygroundSpaceLogs 余额购买成功后记录 LogTypeTopup 用户日志。
func TestPurchasePlaygroundSpaceLogs(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migrateLog(t)
	expectedCost := userSpacePurchaseRawQuota(10, setting.UserSpacePurchaseRatio)
	insertTestUserWithSpace(t, 100, int(expectedCost), 0)
	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/purchase",
		bytes.NewBufferString(`{"mb":10}`)))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
	assert.Equal(t, int64(1), countTopupLogs(t, 100))
}

// TestGetPlaygroundSpaceOrders 订单查询：用户隔离 + 分页 + trade_no 搜索 + 管理员全平台。
func TestGetPlaygroundSpaceOrders(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insert := func(userId, mb int, tradeNo string) {
		t.Helper()
		require.NoError(t, (&model.PlaygroundSpaceOrder{
			UserId: userId, Mb: mb, Money: float64(mb) / 10, TradeNo: tradeNo,
			PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess,
		}).Insert())
	}
	insert(100, 10, "SPCUSR100NO1")
	insert(100, 5, "SPCUSR100NO2")
	insert(101, 20, "SPCUSR101NO1")

	pageInfo := &common.PageInfo{Page: 1, PageSize: 10}

	// 用户隔离：100 只见自己 2 单。
	orders, total, err := model.GetUserPlaygroundSpaceOrders(100, pageInfo, "")
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, orders, 2)

	// trade_no 搜索命中 1 单。
	orders, total, err = model.GetUserPlaygroundSpaceOrders(100, pageInfo, "SPCUSR100NO2")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, orders, 1)
	assert.Equal(t, "SPCUSR100NO2", orders[0].TradeNo)

	// 管理员全平台 3 单。
	orders, total, err = model.GetAllPlaygroundSpaceOrders(pageInfo, "")
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Len(t, orders, 3)
}

func newPlaygroundSpaceOrdersTestEngine(userId, role int) *gin.Engine {
	router := gin.New()
	router.GET("/space/orders", func(c *gin.Context) {
		c.Set("id", userId)
		c.Set("role", role)
		GetUserPlaygroundSpaceOrders(c)
	})
	router.GET("/admin/orders", func(c *gin.Context) {
		c.Set("id", userId)
		c.Set("role", role)
		AdminListPlaygroundSpaceOrders(c)
	})
	return router
}

// TestPlaygroundSpaceOrdersEndpoints 用户接口只返回本人订单；管理员接口返回全平台。
func TestPlaygroundSpaceOrdersEndpoints(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUser(t, 100, false)
	insertTestUser(t, 101, false)
	require.NoError(t, (&model.PlaygroundSpaceOrder{
		UserId: 100, Mb: 10, TradeNo: "SPCUSR100NOa",
		PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess,
	}).Insert())
	require.NoError(t, (&model.PlaygroundSpaceOrder{
		UserId: 101, Mb: 20, TradeNo: "SPCUSR101NOa",
		PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess,
	}).Insert())

	userRouter := newPlaygroundSpaceOrdersTestEngine(100, common.RoleCommonUser)
	rec := httptest.NewRecorder()
	userRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/space/orders?p=1&page_size=10", nil))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, float64(1), raw["total"])
	items := raw["items"].([]any)
	require.Len(t, items, 1)
	assert.Equal(t, "SPCUSR100NOa", items[0].(map[string]any)["trade_no"])

	adminRouter := newPlaygroundSpaceOrdersTestEngine(100, common.RoleRootUser)
	rec = httptest.NewRecorder()
	adminRouter.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin/orders?p=1&page_size=10", nil))
	env = playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
	raw = map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.Equal(t, float64(2), raw["total"])
}

// TestCompletePlaygroundSpaceOrderCumulativeLimit 累计上限兜底：已购 45MB、上限 50MB
// 再买 10MB 超限 → 订单不完成、不扩容、保持 pending；恰好等于上限放行。
func TestCompletePlaygroundSpaceOrderCumulativeLimit(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUserWithSpace(t, 100, 0, 0)
	initial := int64(setting.UserSpaceInitialMB) << 20
	max := int64(setting.UserSpaceMaxPurchasedMB) << 20 // 默认 50MB

	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 100).
		Update("space_purchased_bytes", int64(45)<<20).Error)
	order := newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOlim1")

	err := model.CompletePlaygroundSpaceOrder(order.TradeNo, "{}", model.PaymentProviderEpay, "alipay", initial, max)
	require.Error(t, err)
	assert.ErrorIs(t, err, model.ErrPlaygroundSpaceOrderCapacityExceed)
	user := mustGetUser(t, 100)
	assert.Equal(t, int64(0), user.SpaceCapacity) // 未扩容
	assert.Equal(t, int64(45)<<20, user.SpacePurchasedBytes)
	assert.Equal(t, common.TopUpStatusPending, model.GetPlaygroundSpaceOrderByTradeNo(order.TradeNo).Status)

	// 已购 40MB + 10MB = 50MB，恰好达上限，放行。
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 100).
		Update("space_purchased_bytes", int64(40)<<20).Error)
	order2 := newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOlim2")
	require.NoError(t, model.CompletePlaygroundSpaceOrder(order2.TradeNo, "{}", model.PaymentProviderEpay, "alipay", initial, max))
	user = mustGetUser(t, 100)
	assert.Equal(t, int64(50)<<20, user.SpacePurchasedBytes)
	assert.Equal(t, initial+10<<20, user.SpaceCapacity)
}

// TestCompletePlaygroundSpaceOrderCrossGateway 跨支付网关回调被拒，不扩容。
func TestCompletePlaygroundSpaceOrderCrossGateway(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUserWithSpace(t, 100, 0, 0)
	order := newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOcross")

	err := model.CompletePlaygroundSpaceOrder(order.TradeNo, "{}", model.PaymentProviderBalance, "alipay", 0, 0)
	require.Error(t, err)
	assert.ErrorIs(t, err, model.ErrPaymentMethodMismatch)
	user := mustGetUser(t, 100)
	assert.Equal(t, int64(0), user.SpaceCapacity)
}

// TestCompletePlaygroundSpaceOrderNullPurchased 回调时用户 space_purchased_bytes 为 NULL
// （v6 新列无默认值的存量数据）→ COALESCE 兜底：条件不恒假、写回不再是 NULL。
func TestCompletePlaygroundSpaceOrderNullPurchased(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUserWithSpace(t, 100, 0, 0)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 100).
		Update("space_purchased_bytes", nil).Error)
	initial := int64(setting.UserSpaceInitialMB) << 20
	max := int64(setting.UserSpaceMaxPurchasedMB) << 20
	order := newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOnull1")

	require.NoError(t, model.CompletePlaygroundSpaceOrder(order.TradeNo, "{}", model.PaymentProviderEpay, "alipay", initial, max))
	user := mustGetUser(t, 100)
	assert.Equal(t, int64(10)<<20, user.SpacePurchasedBytes) // NULL → 10MB，而非 NULL
	assert.Equal(t, initial+10<<20, user.SpaceCapacity)
}

// TestPurchasePlaygroundSpaceNullPurchased 余额购买：存量用户已购量 NULL（累计上限开启）
// 时购买不被拒，容量正常累加。
func TestPurchasePlaygroundSpaceNullPurchased(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	expectedCost := userSpacePurchaseRawQuota(10, setting.UserSpacePurchaseRatio)
	insertTestUserWithSpace(t, 100, int(expectedCost), 0)
	prevMax := setting.UserSpaceMaxPurchasedMB
	setting.UserSpaceMaxPurchasedMB = 50
	t.Cleanup(func() { setting.UserSpaceMaxPurchasedMB = prevMax })
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 100).
		Update("space_purchased_bytes", nil).Error)
	router := newPlaygroundSpaceTestEngine(100, common.RoleCommonUser)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/purchase",
		bytes.NewBufferString(`{"mb":10}`)))
	env := playgroundDecodeEnvelope(t, rec)
	require.True(t, env.Success, env.Message)
	user := mustGetUser(t, 100)
	assert.Equal(t, int64(10)<<20, user.SpacePurchasedBytes)
	assert.Equal(t, int64(setting.UserSpaceInitialMB+10)<<20, user.SpaceCapacity)
}

// TestRequestPlaygroundSpaceEpayRejectsBadMb mb 越界（0 / 超单次上限）被拒。
func TestRequestPlaygroundSpaceEpayRejectsBadMb(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUser(t, 100, false)
	restoreEpaySettings(t)
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	router := newPlaygroundSpacePayTestEngine(100)

	for _, body := range []string{`{"mb":0,"payment_method":"alipay"}`, `{"mb":2000,"payment_method":"alipay"}`} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pay", bytes.NewBufferString(body)))
		env := playgroundDecodeEnvelope(t, rec)
		assert.False(t, env.Success, body)
		assert.Contains(t, env.Message, "购买容量", body)
	}
}

// TestRequestPlaygroundSpaceEpayRejectsBadPaymentMethod 未知支付方式被拒。
func TestRequestPlaygroundSpaceEpayRejectsBadPaymentMethod(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUser(t, 100, false)
	restoreEpaySettings(t)
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	router := newPlaygroundSpacePayTestEngine(100)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pay",
		bytes.NewBufferString(`{"mb":1,"payment_method":"not-a-method"}`)))
	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "支付方式不存在")
}

// TestRequestPlaygroundSpaceEpayRejectsCumulativeLimit 已购 49MB、上限 50MB 时再买 10MB 超限被拒。
func TestRequestPlaygroundSpaceEpayRejectsCumulativeLimit(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUserWithSpace(t, 100, 0, 0)
	restoreEpaySettings(t)
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	prevMax := setting.UserSpaceMaxPurchasedMB
	setting.UserSpaceMaxPurchasedMB = 50
	t.Cleanup(func() { setting.UserSpaceMaxPurchasedMB = prevMax })
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 100).
		Update("space_purchased_bytes", int64(49)<<20).Error)
	router := newPlaygroundSpacePayTestEngine(100)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pay",
		bytes.NewBufferString(`{"mb":10,"payment_method":"alipay"}`)))
	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "累计上限")
}

// TestRequestPlaygroundSpaceEpayNoEpayConfig 管理员未配置支付信息时下单被拒。
func TestRequestPlaygroundSpaceEpayNoEpayConfig(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUser(t, 100, false)
	restoreEpaySettings(t)
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	operation_setting.PayAddress = ""
	operation_setting.EpayId = ""
	operation_setting.EpayKey = ""
	router := newPlaygroundSpacePayTestEngine(100)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pay",
		bytes.NewBufferString(`{"mb":1,"payment_method":"alipay"}`)))
	env := playgroundDecodeEnvelope(t, rec)
	assert.False(t, env.Success)
	assert.Contains(t, env.Message, "未配置支付信息")
}

// TestRequestPlaygroundSpaceEpaySuccess 配置易支付后成功下单：返回 url + 签名参数，
// 订单落库 pending，Money=mb×ratio 走充值换算。
func TestRequestPlaygroundSpaceEpaySuccess(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUserWithSpace(t, 100, 0, 0)
	restoreEpaySettings(t)
	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "epay_id"
	operation_setting.EpayKey = "epay_key"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay", "name": "Alipay"}}
	router := newPlaygroundSpacePayTestEngine(100)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pay",
		bytes.NewBufferString(`{"mb":10,"payment_method":"alipay"}`)))
	env := playgroundDecodeEnvelope(t, rec)
	require.Equal(t, "success", env.Message, string(rec.Body.Bytes()))
	raw := map[string]any{}
	require.NoError(t, json.Unmarshal(env.Data, &raw))
	assert.NotEmpty(t, raw["sign"])
	assert.NotEmpty(t, raw["out_trade_no"])

	var orders []model.PlaygroundSpaceOrder
	require.NoError(t, model.DB.Where("user_id = ?", 100).Order("id desc").Limit(1).Find(&orders).Error)
	require.Len(t, orders, 1)
	assert.Equal(t, 10, orders[0].Mb)
	assert.Equal(t, common.TopUpStatusPending, orders[0].Status)
	assert.Equal(t, model.PaymentProviderEpay, orders[0].PaymentProvider)
	assert.Equal(t, fmt.Sprintf("%.2f", 10*100*operation_setting.Price*1.0), fmt.Sprintf("%.2f", orders[0].Money))
}

// TestAdminCompletePlaygroundSpaceOrder 管理员补单：pending → success + 扩容 + 用户日志；
// 重复补单幂等（不重复扩容/记日志）。
func TestAdminCompletePlaygroundSpaceOrder(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	migrateLog(t)
	insertTestUserWithSpace(t, 100, 0, 0)
	initial := int64(setting.UserSpaceInitialMB) << 20
	order := newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOadmin1")

	require.NoError(t, model.AdminCompletePlaygroundSpaceOrder(order.TradeNo, "127.0.0.1", initial, 0))

	user := mustGetUser(t, 100)
	assert.Equal(t, initial+10<<20, user.SpaceCapacity)
	assert.Equal(t, int64(10)<<20, user.SpacePurchasedBytes)
	got := model.GetPlaygroundSpaceOrderByTradeNo(order.TradeNo)
	require.NotNil(t, got)
	assert.Equal(t, common.TopUpStatusSuccess, got.Status)
	assert.Equal(t, int64(1), countTopupLogs(t, 100))

	// 幂等：重复补单不重复扩容/记日志。
	require.NoError(t, model.AdminCompletePlaygroundSpaceOrder(order.TradeNo, "127.0.0.1", initial, 0))
	user = mustGetUser(t, 100)
	assert.Equal(t, initial+10<<20, user.SpaceCapacity)
	assert.Equal(t, int64(1), countTopupLogs(t, 100))
}

// TestAdminRejectPlaygroundSpaceOrder 管理员驳回：pending → expired，不影响容量；重复驳回幂等。
func TestAdminRejectPlaygroundSpaceOrder(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	insertTestUserWithSpace(t, 100, 0, 0)
	order := newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOrejct1")

	require.NoError(t, model.RejectPlaygroundSpaceOrder(order.TradeNo, "127.0.0.1"))

	got := model.GetPlaygroundSpaceOrderByTradeNo(order.TradeNo)
	require.NotNil(t, got)
	assert.Equal(t, common.TopUpStatusExpired, got.Status)
	user := mustGetUser(t, 100)
	assert.Equal(t, int64(0), user.SpacePurchasedBytes)
	require.NoError(t, model.RejectPlaygroundSpaceOrder(order.TradeNo, "127.0.0.1"))
}

// TestExpireTimeoutPlaygroundSpaceOrders 批量过期超时 pending 订单，只影响 pending、不动新鲜订单。
func TestExpireTimeoutPlaygroundSpaceOrders(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	ttl := int64(setting.PlaygroundSpacePendingOrderTTLSeconds)
	cutoff := common.GetTimestamp() - ttl
	oldOrder := newPendingSpaceOrder(t, 100, 5, "SPCUSR100NOexpire1")
	require.NoError(t, model.DB.Model(&model.PlaygroundSpaceOrder{}).
		Where("trade_no = ?", oldOrder.TradeNo).Update("create_time", cutoff-100).Error)
	freshOrder := newPendingSpaceOrder(t, 100, 5, "SPCUSR100NOexpire2")

	affected, err := model.ExpireTimeoutPlaygroundSpaceOrders(cutoff)
	require.NoError(t, err)
	assert.Equal(t, int64(1), affected)
	assert.Equal(t, common.TopUpStatusExpired, model.GetPlaygroundSpaceOrderByTradeNo(oldOrder.TradeNo).Status)
	assert.Equal(t, common.TopUpStatusPending, model.GetPlaygroundSpaceOrderByTradeNo(freshOrder.TradeNo).Status)
}

// TestSumPendingPlaygroundSpaceOrdersByUser 预留统计：只统计该用户 pending 订单。
func TestSumPendingPlaygroundSpaceOrdersByUser(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOsum1")
	newPendingSpaceOrder(t, 100, 20, "SPCUSR100NOsum2")
	newPendingSpaceOrder(t, 200, 5, "SPCUSR200NOsum1")

	mb, count, err := model.SumPendingPlaygroundSpaceOrdersByUser(100)
	require.NoError(t, err)
	assert.Equal(t, 30, mb)
	assert.Equal(t, int64(2), count)
}

// TestRequestPlaygroundSpaceEpayPendingReservation 下单预留：已购 + pending + 本次 > 累计上限时
// 拒单；pending 单数达到上限时拒单。
func TestRequestPlaygroundSpaceEpayPendingReservation(t *testing.T) {
	setupPlaygroundImageTestDB(t)
	migratePlaygroundSpaceOrder(t)
	restoreEpaySettings(t)
	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "epay_id"
	operation_setting.EpayKey = "epay_key"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay", "name": "Alipay"}}

	insertTestUserWithSpace(t, 100, 0, 0)
	prevMax := setting.UserSpaceMaxPurchasedMB
	prevMaxPurchase := setting.UserSpaceMaxPurchaseMB
	setting.UserSpaceMaxPurchasedMB = 25
	setting.UserSpaceMaxPurchaseMB = 20
	t.Cleanup(func() {
		setting.UserSpaceMaxPurchasedMB = prevMax
		setting.UserSpaceMaxPurchaseMB = prevMaxPurchase
	})

	// 两笔 pending 占 20MB，第三笔 10MB → 0+20+10 > 25 被累计上限拦下。
	newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOres1")
	newPendingSpaceOrder(t, 100, 10, "SPCUSR100NOres2")
	router := newPlaygroundSpacePayTestEngine(100)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pay",
		bytes.NewBufferString(`{"mb":10,"payment_method":"alipay"}`)))
	env := playgroundDecodeEnvelope(t, rec)
	require.NotEqual(t, "success", env.Message, string(rec.Body.Bytes()))

	// 再补 3 笔（共 5 笔 pending），第 6 笔因 pending 单数上限被拒。
	for i := 0; i < 3; i++ {
		newPendingSpaceOrder(t, 100, 1, fmt.Sprintf("SPCUSR100NOcnt%d", i))
	}
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pay",
		bytes.NewBufferString(`{"mb":1,"payment_method":"alipay"}`)))
	env = playgroundDecodeEnvelope(t, rec)
	require.NotEqual(t, "success", env.Message, string(rec.Body.Bytes()))
}
