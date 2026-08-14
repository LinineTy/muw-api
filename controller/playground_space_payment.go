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
	if setting.UserSpaceMaxPurchasedMB > 0 {
		user, err := model.GetUserById(userId, false)
		if err != nil {
			common.ApiErrorMsg(c, "无效的用户")
			return
		}
		if user.SpacePurchasedBytes+int64(req.Mb)<<20 > int64(setting.UserSpaceMaxPurchasedMB)<<20 {
			common.ApiErrorMsg(c, "购买容量超过累计上限")
			return
		}
	}

	// 展示货币值 = mb × ratio；实际付款走充值同款换算（Price×分组折扣），与
	// 「先充值再用余额买」等价。分组折扣用会话 user_group（与登录一致，价格锁定）。
	costDisplay := int64(float64(req.Mb) * setting.UserSpacePurchaseRatio)
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
func PlaygroundSpaceEpayNotify(c *gin.Context) {
	params, ok := parseEpayParams(c)
	if !ok {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	client := GetEpayClient()
	if client == nil {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	if verifyInfo.TradeStatus != epay.StatusTradeSuccess {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	LockOrder(verifyInfo.ServiceTradeNo)
	defer UnlockOrder(verifyInfo.ServiceTradeNo)
	if err := completePlaygroundSpaceOrder(verifyInfo); err != nil {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	_, _ = c.Writer.Write([]byte("success"))
}

// PlaygroundSpaceEpayReturn 支付后浏览器跳回：验签 → 幂等完成 → 302 到云空间页。
func PlaygroundSpaceEpayReturn(c *gin.Context) {
	params, ok := parseEpayParams(c)
	if !ok {
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
		return
	}
	client := GetEpayClient()
	if client == nil {
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
		return
	}
	if verifyInfo.TradeStatus == epay.StatusTradeSuccess {
		LockOrder(verifyInfo.ServiceTradeNo)
		defer UnlockOrder(verifyInfo.ServiceTradeNo)
		if err := completePlaygroundSpaceOrder(verifyInfo); err != nil {
			c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=fail"))
			return
		}
		c.Redirect(http.StatusFound, paymentReturnPath("/space?pay=success"))
		return
	}
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

// GetUserPlaygroundSpaceOrders 当前用户的云空间购买订单（分页 + 可选 trade_no 搜索）。
func GetUserPlaygroundSpaceOrders(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}
	pageInfo := common.GetPageQuery(c)
	orders, total, err := model.GetUserPlaygroundSpaceOrders(userId, pageInfo, c.Query("keyword"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

// AdminListPlaygroundSpaceOrders 管理员查看全平台云空间购买订单（分页 + 可选 trade_no 搜索）。
func AdminListPlaygroundSpaceOrders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	orders, total, err := model.GetAllPlaygroundSpaceOrders(pageInfo, c.Query("keyword"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}
