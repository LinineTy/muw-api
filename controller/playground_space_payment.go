package controller

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type PlaygroundSpaceEpayRequest struct {
	Mb            int    `json:"mb"`
	PaymentMethod string `json:"payment_method"`
}

// maxPendingPlaygroundSpaceOrders 每用户同时存在的 pending 云空间订单上限。
// 与 pending 预留配合：防止用户无限下单占住预留额度/刷管理列表。
const maxPendingPlaygroundSpaceOrders = 5

// RequestPlaygroundSpaceEpay 云空间在线支付下单：mb×ratio 展示货币值 → getPayMoney
// 换算实际付款（与充值同价，先充再买等价）。订单 pending 落库后拉起易支付。
func RequestPlaygroundSpaceEpay(c *gin.Context) {
	var req PlaygroundSpaceEpayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	maxMB := setting.UserSpaceMaxPurchaseMB
	if maxMB < 1 {
		maxMB = maxPurchaseSpaceMB
	}
	if req.Mb < 1 || req.Mb > maxMB {
		common.ApiErrorMsg(c, "购买容量需在 1~上限之间")
		return
	}
	if !operation_setting.ContainsPayMethod(req.PaymentMethod) {
		common.ApiErrorMsg(c, "支付方式不存在")
		return
	}
	// 累计购买上限预检查（回调内原子条件兜底并发，这里只为给出准确提示）。
	// 已购量 + 本用户所有 pending 订单预留 + 本次，一起对比上限：epay 订单 pending
	// 期间未累加 space_purchased_bytes，若只算已购量，并发多单会互相通过预检，
	// 支付后回调超限卡死（收钱不给货）。预留 + pending 单数上限把竞争窗口收窄
	// 到真正的并发边界（逾期订单由后台任务置 expired，预留随之释放）。
	pendingMb, pendingCount, err := model.SumPendingPlaygroundSpaceOrdersByUser(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if pendingCount >= maxPendingPlaygroundSpaceOrders {
		common.ApiErrorMsg(c, "待支付订单过多，请稍后再试")
		return
	}
	if setting.UserSpaceMaxPurchasedMB > 0 {
		user, err := model.GetUserById(userId, false)
		if err != nil {
			common.ApiErrorMsg(c, "无效的用户")
			return
		}
		reserved := user.SpacePurchasedBytes + int64(pendingMb)<<20
		if reserved+int64(req.Mb)<<20 > int64(setting.UserSpaceMaxPurchasedMB)<<20 {
			common.ApiErrorMsg(c, "购买容量超过累计上限")
			return
		}
	}

	// 展示货币值 = mb × ratio（四舍五入，与余额购买的 userSpacePurchaseRawQuota
	// 取整口径一致，避免两链路对同一 mb 的计费基准差 1 个单位）；实际付款走充值
	// 同款换算（Price×分组折扣），与「先充值再用余额买」等价。分组折扣用会话
	// user_group（与登录一致，价格锁定）。
	costDisplay := int64(common.QuotaRound(float64(req.Mb) * setting.UserSpacePurchaseRatio))
	money := getPayMoney(costDisplay, c.GetString("user_group"))
	if money < 0.01 {
		common.ApiErrorMsg(c, "支付金额过低")
		return
	}
	cost := userSpacePurchaseRawQuota(req.Mb, setting.UserSpacePurchaseRatio)

	callBackAddress := service.GetCallbackAddress()
	returnUrl, _ := url.Parse(callBackAddress + "/api/playground/space/epay/return")
	notifyUrl, _ := url.Parse(callBackAddress + "/api/playground/space/epay/notify")
	tradeNo := fmt.Sprintf("%s%d", common.GetRandomString(6), time.Now().Unix())
	tradeNo = fmt.Sprintf("SPCUSR%dNO%s", userId, tradeNo)

	client := GetEpayClient()
	if client == nil {
		common.ApiErrorMsg(c, "当前管理员未配置支付信息")
		return
	}

	order := &model.PlaygroundSpaceOrder{
		UserId:          userId,
		Mb:              req.Mb,
		Cost:            cost,
		Money:           money,
		TradeNo:         tradeNo,
		PaymentMethod:   req.PaymentMethod,
		PaymentProvider: model.PaymentProviderEpay,
		Status:          common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("易支付 创建云空间订单失败 user_id=%d trade_no=%s mb=%d error=%q", userId, tradeNo, req.Mb, err.Error()))
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}
	uri, params, err := client.Purchase(&epay.PurchaseArgs{
		Type:           req.PaymentMethod,
		ServiceTradeNo: tradeNo,
		Name:           fmt.Sprintf("SPC:%dMB", req.Mb),
		Money:          strconv.FormatFloat(money, 'f', 2, 64),
		Device:         epay.PC,
		NotifyUrl:      notifyUrl,
		ReturnUrl:      returnUrl,
	})
	if err != nil {
		_ = model.ExpirePlaygroundSpaceOrder(tradeNo, model.PaymentProviderEpay)
		logger.LogError(c.Request.Context(), fmt.Sprintf("易支付 拉起云空间支付失败 user_id=%d trade_no=%s mb=%d error=%q", userId, tradeNo, req.Mb, err.Error()))
		common.ApiErrorMsg(c, "拉起支付失败")
		return
	}
	logger.LogInfo(c.Request.Context(), fmt.Sprintf("易支付 云空间订单创建成功 user_id=%d trade_no=%s mb=%d money=%.2f", userId, tradeNo, req.Mb, money))
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": params, "url": uri, "money": money})
}

// PlaygroundSpaceEpayNotify 易支付回调：验签 → tradeNo 进程锁 → 幂等完成（扩容）。
// 每条失败分支都记录后端日志（含 client_ip），与充值 webhook 的审计覆盖对齐。
func PlaygroundSpaceEpayNotify(c *gin.Context) {
	if !isEpayWebhookEnabled() {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("易支付 云空间回调被拒绝 reason=webhook_disabled path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	params, ok := parseEpayParams(c)
	if !ok {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("易支付 云空间回调参数为空 path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	client := GetEpayClient()
	if client == nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("易支付 云空间回调 client 未初始化 path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("易支付 云空间回调验签失败 path=%q client_ip=%s verify_error=%v", c.Request.RequestURI, c.ClientIP(), err))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	if verifyInfo.TradeStatus != epay.StatusTradeSuccess {
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("易支付 云空间回调忽略非成功事件 trade_no=%s trade_status=%s client_ip=%s", verifyInfo.ServiceTradeNo, verifyInfo.TradeStatus, c.ClientIP()))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	LockOrder(verifyInfo.ServiceTradeNo)
	defer UnlockOrder(verifyInfo.ServiceTradeNo)
	if err := completePlaygroundSpaceOrder(verifyInfo); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("易支付 云空间回调完成失败 trade_no=%s client_ip=%s error=%q", verifyInfo.ServiceTradeNo, c.ClientIP(), err.Error()))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	logger.LogInfo(c.Request.Context(), fmt.Sprintf("易支付 云空间回调完成成功 trade_no=%s client_ip=%s", verifyInfo.ServiceTradeNo, c.ClientIP()))
	_, _ = c.Writer.Write([]byte("success"))
}

// PlaygroundSpaceEpayReturn 支付后浏览器跳回：验签 → 幂等完成 → 302 到云空间页。
func PlaygroundSpaceEpayReturn(c *gin.Context) {
	if !isEpayWebhookEnabled() {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("易支付 云空间回跳被拒绝 reason=webhook_disabled path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
		return
	}
	params, ok := parseEpayParams(c)
	if !ok {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("易支付 云空间回跳参数为空 path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
		return
	}
	client := GetEpayClient()
	if client == nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("易支付 云空间回跳 client 未初始化 path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("易支付 云空间回跳验签失败 path=%q client_ip=%s verify_error=%v", c.Request.RequestURI, c.ClientIP(), err))
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
		return
	}
	if verifyInfo.TradeStatus == epay.StatusTradeSuccess {
		LockOrder(verifyInfo.ServiceTradeNo)
		defer UnlockOrder(verifyInfo.ServiceTradeNo)
		if err := completePlaygroundSpaceOrder(verifyInfo); err != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("易支付 云空间回跳完成失败 trade_no=%s client_ip=%s error=%q", verifyInfo.ServiceTradeNo, c.ClientIP(), err.Error()))
			c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
			return
		}
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("易支付 云空间回跳完成成功 trade_no=%s client_ip=%s", verifyInfo.ServiceTradeNo, c.ClientIP()))
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=success"))
		return
	}
	logger.LogInfo(c.Request.Context(), fmt.Sprintf("易支付 云空间回跳忽略非成功事件 trade_no=%s trade_status=%s client_ip=%s", verifyInfo.ServiceTradeNo, verifyInfo.TradeStatus, c.ClientIP()))
	c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=pending"))
}

// completePlaygroundSpaceOrder 用验签结果幂等完成云空间订单（初始容量与累计上限取当前设置）。
func completePlaygroundSpaceOrder(verifyInfo *epay.VerifyRes) error {
	return model.CompletePlaygroundSpaceOrder(
		verifyInfo.ServiceTradeNo,
		common.GetJsonString(verifyInfo),
		model.PaymentProviderEpay,
		verifyInfo.Type,
		int64(setting.UserSpaceInitialMB)<<20,
		int64(setting.UserSpaceMaxPurchasedMB)<<20,
	)
}

// parseEpayParams 兼容 POST 表单与 GET Query 解析易支付回调参数。
func parseEpayParams(c *gin.Context) (map[string]string, bool) {
	var params map[string]string
	if c.Request.Method == "POST" {
		if err := c.Request.ParseForm(); err != nil {
			return nil, false
		}
		params = lo.Reduce(lo.Keys(c.Request.PostForm), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.PostForm.Get(t)
			return r
		}, map[string]string{})
	} else {
		params = lo.Reduce(lo.Keys(c.Request.URL.Query()), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.URL.Query().Get(t)
			return r
		}, map[string]string{})
	}
	return params, len(params) > 0
}

// GetUserPlaygroundSpaceOrders 当前用户的云空间购买订单（分页 + 可选 trade_no 搜索 + status/payment_method 过滤）。
func GetUserPlaygroundSpaceOrders(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}
	pageInfo := common.GetPageQuery(c)
	orders, total, err := model.GetUserPlaygroundSpaceOrders(userId, pageInfo, c.Query("keyword"), c.Query("status"), c.Query("method"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

// AdminListPlaygroundSpaceOrders 管理员查看全平台云空间购买订单（分页 + 可选 trade_no 搜索 + status/payment_method 过滤）。
func AdminListPlaygroundSpaceOrders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	orders, total, err := model.GetAllPlaygroundSpaceOrders(pageInfo, c.Query("keyword"), c.Query("status"), c.Query("method"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

type AdminCompletePlaygroundSpaceOrderRequest struct {
	TradeNo string `json:"trade_no"`
}

// AdminCompletePlaygroundSpaceOrder 管理员补单云空间订单。用于 epay 回调丢失/失败、
// 或累计上限卡单（收钱不给货）时的人工处置，与充值的 AdminCompleteTopUp 对齐。
func AdminCompletePlaygroundSpaceOrder(c *gin.Context) {
	var req AdminCompletePlaygroundSpaceOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	// 订单级互斥，防止并发补单。
	LockOrder(req.TradeNo)
	defer UnlockOrder(req.TradeNo)
	if err := model.AdminCompletePlaygroundSpaceOrder(req.TradeNo, c.ClientIP(),
		int64(setting.UserSpaceInitialMB)<<20, int64(setting.UserSpaceMaxPurchasedMB)<<20); err != nil {
		common.ApiError(c, err)
		return
	}
	// 资金处置高危操作：补单留管理审计。
	recordManageAudit(c, "playground.order_complete", map[string]interface{}{
		"trade_no": req.TradeNo,
	})
	common.ApiSuccess(c, nil)
}

// AdminRejectPlaygroundSpaceOrder 管理员关闭待支付云空间订单（pending → expired）。
// 用于无法完成的订单的人工收尾。
func AdminRejectPlaygroundSpaceOrder(c *gin.Context) {
	var req AdminCompletePlaygroundSpaceOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	LockOrder(req.TradeNo)
	defer UnlockOrder(req.TradeNo)
	if err := model.RejectPlaygroundSpaceOrder(req.TradeNo, c.ClientIP()); err != nil {
		common.ApiError(c, err)
		return
	}
	// 资金处置高危操作：关单留管理审计。
	recordManageAudit(c, "playground.order_reject", map[string]interface{}{
		"trade_no": req.TradeNo,
	})
	common.ApiSuccess(c, nil)
}
