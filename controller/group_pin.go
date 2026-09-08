// @muw-owned

package controller

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

// ---- 用户端：固定分组商品 / 我的固定分组 / 余额购买 ----

// GetGroupPinProducts 返回上架的固定分组商品（购买页区块）。
func GetGroupPinProducts(c *gin.Context) {
	products, err := model.GetEnabledGroupPinProducts()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, products)
}

// GetMyGroupPin 返回当前用户的 active 固定分组（用户页"固定分组"标签；
// 无钉时 data 为 null）。
func GetMyGroupPin(c *gin.Context) {
	userId := c.GetInt("id")
	var pin model.GroupPin
	err := model.DB.Where("user_id = ? AND status = ?", userId, model.GroupPinStatusActive).
		Order("id desc").First(&pin).Error
	if err != nil {
		common.ApiSuccess(c, nil)
		return
	}
	common.ApiSuccess(c, pin)
}

type GroupPinBalancePayRequest struct {
	PinProductId int `json:"pin_product_id"`
}

// GroupPinBalancePay 用户余额购买固定分组。
func GroupPinBalancePay(c *gin.Context) {
	userId := c.GetInt("id")
	var req GroupPinBalancePayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PinProductId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	msg, err := model.PurchaseGroupPin(userId, req.PinProductId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"message": msg})
}

// ---- 管理端：商品 CRUD / 钉子列表与解除 ----

// AdminListGroupPinProducts 返回全部固定分组商品（含未上架）。
func AdminListGroupPinProducts(c *gin.Context) {
	var products []model.GroupPinProduct
	if err := model.DB.Order("sort_order asc, id asc").Find(&products).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, products)
}

type AdminUpsertGroupPinProductRequest struct {
	Id          int     `json:"id"`
	Title       string  `json:"title"`
	Group       string  `json:"group"`
	PriceAmount float64 `json:"price_amount"`
	Enabled     *bool   `json:"enabled"`
	SortOrder   int     `json:"sort_order"`
}

// AdminSaveGroupPinProduct 新建/更新固定分组商品。目标组必须存在于分组倍率配置。
func AdminSaveGroupPinProduct(c *gin.Context) {
	var req AdminUpsertGroupPinProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Group = strings.TrimSpace(req.Group)
	if req.Title == "" {
		common.ApiErrorMsg(c, "商品名称不能为空")
		return
	}
	if _, ok := ratio_setting.GetGroupRatioCopy()[req.Group]; !ok {
		common.ApiErrorMsg(c, "固定分组目标不存在")
		return
	}
	if req.PriceAmount < 0 {
		common.ApiErrorMsg(c, "价格不能为负数")
		return
	}
	if req.Id > 0 {
		var product model.GroupPinProduct
		if err := model.DB.First(&product, "id = ?", req.Id).Error; err != nil {
			common.ApiErrorMsg(c, "商品不存在")
			return
		}
		product.Title = req.Title
		product.Group = req.Group
		product.PriceAmount = req.PriceAmount
		if req.Enabled != nil {
			product.Enabled = *req.Enabled
		}
		product.SortOrder = req.SortOrder
		if err := model.DB.Save(&product).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, product)
		return
	}
	product := model.GroupPinProduct{
		Title:       req.Title,
		Group:       req.Group,
		PriceAmount: req.PriceAmount,
		Enabled:     req.Enabled == nil || *req.Enabled,
		SortOrder:   req.SortOrder,
	}
	if err := model.DB.Create(&product).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, product)
}

// AdminDeleteGroupPinProduct 删除固定分组商品（用户的 active 钉不受影响）。
func AdminDeleteGroupPinProduct(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.DB.Delete(&model.GroupPinProduct{}, "id = ?", id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminListUserGroupPins 钉子列表：?user_id= 过滤，分页。
func AdminListUserGroupPins(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Query("user_id"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	query := model.DB.Model(&model.GroupPin{})
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var pins []model.GroupPin
	if err := query.Order("id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&pins).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items": pins,
		"total": total,
		"page":  page,
		"size":  pageSize,
	})
}

type AdminReleaseGroupPinRequest struct {
	PinId  int    `json:"pin_id"`
	Reason string `json:"reason"`
}

// AdminReleaseGroupPin 解除固定分组钉（settle 收敛用户组）。
func AdminReleaseGroupPin(c *gin.Context) {
	operatorId := c.GetInt("id")
	var req AdminReleaseGroupPinRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PinId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	var pin model.GroupPin
	if err := model.DB.First(&pin, "id = ?", req.PinId).Error; err != nil {
		common.ApiErrorMsg(c, "固定分组记录不存在")
		return
	}
	target, changed, err := model.ReleaseGroupPinTx(model.DB, req.PinId, operatorId, req.Reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if changed {
		model.RefreshUserGroupCache(pin.UserId)
	}
	common.ApiSuccess(c, gin.H{"group": target, "changed": changed})
}

// ---- 用户端：epay 购买固定分组（回调复用 CompleteSubscriptionOrder 的 kind 分流） ----

type GroupPinEpayPayRequest struct {
	PinProductId  int    `json:"pin_product_id"`
	PaymentMethod string `json:"payment_method"`
}

func GroupPinRequestEpay(c *gin.Context) {
	var req GroupPinEpayPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PinProductId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	product, err := model.GetGroupPinProductById(req.PinProductId)
	if err != nil {
		common.ApiErrorMsg(c, "固定分组商品不存在")
		return
	}
	if !product.Enabled {
		common.ApiErrorMsg(c, "该固定分组商品未上架")
		return
	}
	if product.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, "商品金额过低")
		return
	}
	if !operation_setting.ContainsPayMethod(req.PaymentMethod) {
		common.ApiErrorMsg(c, "支付方式不存在")
		return
	}
	userId := c.GetInt("id")
	if !common.SubscriptionGroupUpgradeEnabled {
		common.ApiErrorMsg(c, "订阅分组功能未启用")
		return
	}

	client := GetEpayClient()
	if client == nil {
		common.ApiErrorMsg(c, "当前管理员未配置支付信息")
		return
	}
	callBackAddress := service.GetCallbackAddress()
	returnUrl, err := url.Parse(callBackAddress + "/api/subscription/epay/return")
	if err != nil {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return
	}
	notifyUrl, err := url.Parse(callBackAddress + "/api/subscription/epay/notify")
	if err != nil {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return
	}

	tradeNo := fmt.Sprintf("PINGRP%dNO%s%d", userId, common.GetRandomString(6), time.Now().Unix())
	order := &model.SubscriptionOrder{
		UserId:          userId,
		Kind:            model.OrderKindGroupPin,
		PinProductId:    product.Id,
		Money:           product.PriceAmount,
		TradeNo:         tradeNo,
		PaymentMethod:   req.PaymentMethod,
		PaymentProvider: model.PaymentProviderEpay,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}
	uri, params, err := client.Purchase(&epay.PurchaseArgs{
		Type:           req.PaymentMethod,
		ServiceTradeNo: tradeNo,
		Name:           fmt.Sprintf("PIN:%s", product.Title),
		Money:          strconv.FormatFloat(product.PriceAmount, 'f', 2, 64),
		Device:         epay.PC,
		NotifyUrl:      notifyUrl,
		ReturnUrl:      returnUrl,
	})
	if err != nil {
		_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderEpay)
		common.ApiErrorMsg(c, "拉起支付失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": params, "url": uri})
}
