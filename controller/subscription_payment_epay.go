package controller

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type SubscriptionEpayPayRequest struct {
	PlanId         int    `json:"plan_id"`
	PaymentMethod  string `json:"payment_method"`
	SubscriptionId int    `json:"subscription_id"` // >0 renews the target subscription
}

// epayPurchase 一次 epay 下单所需的客户端与回调地址。订阅与固定分组共用：
// 调用方必须在插入订单之前先 prepareEpayPurchase —— 配置缺失时不落脏订单
//（否则会留下 pending 单，既挡住套餐删除又能在订单页被误补单）。
type epayPurchase struct {
	client    *epay.Client
	returnUrl *url.URL
	notifyUrl *url.URL
}

// prepareEpayPurchase 校验支付配置并解析回调地址；失败时已写响应，调用方直接 return。
func prepareEpayPurchase(c *gin.Context) (*epayPurchase, bool) {
	client := GetEpayClient()
	if client == nil {
		common.ApiErrorMsg(c, "当前管理员未配置支付信息")
		return nil, false
	}
	callBackAddress := service.GetCallbackAddress()
	returnUrl, err := url.Parse(callBackAddress + "/api/subscription/epay/return")
	if err != nil {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return nil, false
	}
	notifyUrl, err := url.Parse(callBackAddress + "/api/subscription/epay/notify")
	if err != nil {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return nil, false
	}
	return &epayPurchase{client: client, returnUrl: returnUrl, notifyUrl: notifyUrl}, true
}

// request 拉起支付；失败时作废刚插入的订单。成功返回 (跳转地址, 表单参数)。
func (p *epayPurchase) request(c *gin.Context, tradeNo, subject string, money float64, paymentMethod string) (string, map[string]string, bool) {
	uri, params, err := p.client.Purchase(&epay.PurchaseArgs{
		Type:           paymentMethod,
		ServiceTradeNo: tradeNo,
		Name:           subject,
		Money:          strconv.FormatFloat(money, 'f', 2, 64),
		Device:         epay.PC,
		NotifyUrl:      p.notifyUrl,
		ReturnUrl:      p.returnUrl,
	})
	if err != nil {
		_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderEpay)
		common.ApiErrorMsg(c, "拉起支付失败")
		return "", nil, false
	}
	return uri, params, true
}

func SubscriptionRequestEpay(c *gin.Context) {
	var req SubscriptionEpayPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled && req.SubscriptionId <= 0 {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, "套餐金额过低")
		return
	}
	if !operation_setting.ContainsPayMethod(req.PaymentMethod) {
		common.ApiErrorMsg(c, "支付方式不存在")
		return
	}

	userId := c.GetInt("id")
	if err := model.ValidateSubscriptionPurchaseGate(userId, plan, req.SubscriptionId); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.SubscriptionId == 0 && plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}
	if req.SubscriptionId == 0 && common.SubscriptionMaxSimultaneous > 0 {
		activeCount, err := model.CountActiveUserSubscriptions(userId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if activeCount >= int64(common.SubscriptionMaxSimultaneous) {
			common.ApiErrorMsg(c, fmt.Sprintf("同时持有的订阅数已达上限 %d", common.SubscriptionMaxSimultaneous))
			return
		}
	}
	renewPrice := plan.PriceAmount
	if req.SubscriptionId > 0 {
		// Renewal target must belong to the user and be active.
		var target model.UserSubscription
		if err := model.DB.Where("id = ? AND user_id = ? AND status = ?", req.SubscriptionId, userId, "active").First(&target).Error; err != nil {
			common.ApiErrorMsg(c, "订阅不存在或已失效")
			return
		}
		// 续费按订阅快照的旧条款计价（价格来自购买时的套餐），订单金额对齐实际扣款。
		terms := target.RenewTermsOrPlan(plan)
		if terms.DurationSeconds <= 0 {
			common.ApiErrorMsg(c, "套餐时长配置错误")
			return
		}
		renewPrice = terms.PriceAmount
	}

	purchase, ok := prepareEpayPurchase(c)
	if !ok {
		return
	}

	tradeNo := model.NewSubscriptionTradeNo("SUBUSR", userId)

	order := &model.SubscriptionOrder{
		UserId:               userId,
		PlanId:               plan.Id,
		Money:                renewPrice,
		TradeNo:              tradeNo,
		PaymentMethod:        req.PaymentMethod,
		PaymentProvider:      model.PaymentProviderEpay,
		CreateTime:           time.Now().Unix(),
		Status:               common.TopUpStatusPending,
		ExtendSubscriptionId: req.SubscriptionId,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}
	uri, params, ok := purchase.request(c, tradeNo, fmt.Sprintf("SUB:%s", plan.Title), renewPrice, req.PaymentMethod)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": params, "url": uri})
}

func SubscriptionEpayNotify(c *gin.Context) {
	var params map[string]string

	if c.Request.Method == "POST" {
		// POST 请求：从 POST body 解析参数
		if err := c.Request.ParseForm(); err != nil {
			_, _ = c.Writer.Write([]byte("fail"))
			return
		}
		params = lo.Reduce(lo.Keys(c.Request.PostForm), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.PostForm.Get(t)
			return r
		}, map[string]string{})
	} else {
		// GET 请求：从 URL Query 解析参数
		params = lo.Reduce(lo.Keys(c.Request.URL.Query()), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.URL.Query().Get(t)
			return r
		}, map[string]string{})
	}

	if len(params) == 0 {
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

	if err := model.CompleteSubscriptionOrder(verifyInfo.ServiceTradeNo, common.GetJsonString(verifyInfo), model.PaymentProviderEpay, verifyInfo.Type); err != nil {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	_, _ = c.Writer.Write([]byte("success"))
}

// SubscriptionEpayReturn handles browser return after payment.
// It verifies the payload and completes the order, then redirects to console.
func SubscriptionEpayReturn(c *gin.Context) {
	var params map[string]string

	if c.Request.Method == "POST" {
		// POST 请求：从 POST body 解析参数
		if err := c.Request.ParseForm(); err != nil {
			c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=fail"))
			return
		}
		params = lo.Reduce(lo.Keys(c.Request.PostForm), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.PostForm.Get(t)
			return r
		}, map[string]string{})
	} else {
		// GET 请求：从 URL Query 解析参数
		params = lo.Reduce(lo.Keys(c.Request.URL.Query()), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.URL.Query().Get(t)
			return r
		}, map[string]string{})
	}

	if len(params) == 0 {
		c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=fail"))
		return
	}

	client := GetEpayClient()
	if client == nil {
		c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=fail"))
		return
	}
	if verifyInfo.TradeStatus == epay.StatusTradeSuccess {
		LockOrder(verifyInfo.ServiceTradeNo)
		defer UnlockOrder(verifyInfo.ServiceTradeNo)
		if err := model.CompleteSubscriptionOrder(verifyInfo.ServiceTradeNo, common.GetJsonString(verifyInfo), model.PaymentProviderEpay, verifyInfo.Type); err != nil {
			c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=fail"))
			return
		}
		c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=success"))
		return
	}
	c.Redirect(http.StatusFound, paymentReturnPath("/wallet?pay=pending"))
}
