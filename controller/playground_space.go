package controller

import (
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// maxPurchaseSpaceMB 单次购买容量上限由设置控制（setting.UserSpaceMaxPurchaseMB），
// 有界防止 cost 换算溢出。此常量仅作兜底下限。
const maxPurchaseSpaceMB = 1024

// userSpacePurchaseRawQuota 把「展示货币价格 × MB」换算成原始额度。
// 与前端 quotaUnitsToDollars 互为逆运算（USD/CNY/CUSTOM: display = raw/QuotaPerUnit × rate；
// TOKENS: display = raw），保证显示与扣减一致。
func userSpacePurchaseRawQuota(mb int, pricePerMB float64) int64 {
	amount := pricePerMB * float64(mb)
	switch operation_setting.GetQuotaDisplayType() {
	case operation_setting.QuotaDisplayTypeTokens:
		return int64(common.QuotaRound(amount))
	case operation_setting.QuotaDisplayTypeCNY:
		rate := operation_setting.USDExchangeRate
		if rate <= 0 {
			rate = 1
		}
		return int64(common.QuotaRound(amount / rate * common.QuotaPerUnit))
	case operation_setting.QuotaDisplayTypeCustom:
		rate := operation_setting.GetGeneralSetting().CustomCurrencyExchangeRate
		if rate <= 0 {
			rate = 1
		}
		return int64(common.QuotaRound(amount / rate * common.QuotaPerUnit))
	default: // USD
		return int64(common.QuotaRound(amount * common.QuotaPerUnit))
	}
}

// GetUserPlaygroundSpace 返回当前用户的云空间用量与购买信息。
// capacity_bytes 对 root 为 -1（无限制）；普通用户为 SpaceCapacity>0 ? 之 : 全局初始。
func GetUserPlaygroundSpace(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	used, err := model.SumPlaygroundImageSizesByUserAll(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	globalTransient, err := model.SumPlaygroundImageSizesGlobal(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	globalPermanent, err := model.SumPlaygroundImageSizesGlobal(true)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 当前用户临时/永久拆分（云空间页各区展示）。
	transientCount, err := model.CountPlaygroundImagesByUser(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	transientBytes, err := model.SumPlaygroundImageSizesByUser(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	permanentCount, err := model.CountPlaygroundImagesByUser(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	permanentBytes, err := model.SumPlaygroundImageSizesByUser(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	isRoot := c.GetInt("role") == common.RoleRootUser
	capacityBytes := int64(-1)
	if !isRoot {
		capacityBytes = int64(setting.UserSpaceInitialMB) << 20
		if user, err := model.GetUserById(userId, false); err == nil && user.SpaceCapacity > 0 {
			capacityBytes = user.SpaceCapacity
		}
	}

	common.ApiSuccess(c, gin.H{
		"capacity_bytes":    capacityBytes,
		"used_bytes":        used,
		"purchase_ratio":    setting.UserSpacePurchaseRatio,
		"max_purchase_mb":   setting.UserSpaceMaxPurchaseMB,
		"global_used_bytes": globalTransient + globalPermanent,
		"global_max_bytes":  int64(setting.UserSpaceGlobalMaxMB) << 20,
		"transient_count":   transientCount,
		"transient_bytes":   transientBytes,
		"permanent_count":   permanentCount,
		"permanent_bytes":   permanentBytes,
	})
}

// PurchasePlaygroundSpace 用余额 quota 购买云空间容量。body {mb int}。
// cost = mb * UserSpacePurchaseRatio，单次 mb∈[1, maxPurchaseSpaceMB]。
// 原子条件更新保证余额充足才扣费扩容，防止负余额。
func PurchasePlaygroundSpace(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}

	var request struct {
		Mb int `json:"mb"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	// 单次购买上限：管理员可调（默认 1024 MB），同时硬性兜底防溢出。
	maxMB := setting.UserSpaceMaxPurchaseMB
	if maxMB < 1 {
		maxMB = maxPurchaseSpaceMB
	}
	if request.Mb < 1 || request.Mb > maxMB {
		common.ApiErrorMsg(c, "购买容量需在 1~上限之间")
		return
	}

	cost := userSpacePurchaseRawQuota(request.Mb, setting.UserSpacePurchaseRatio)
	if cost > math.MaxInt32 {
		common.ApiErrorMsg(c, "购买容量超出范围")
		return
	}
	if cost <= 0 {
		common.ApiErrorMsg(c, "购买比例配置错误")
		return
	}

	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}
	// 有效容量 = 已配置容量，否则全局初始。
	effective := int64(setting.UserSpaceInitialMB) << 20
	if user.SpaceCapacity > 0 {
		effective = user.SpaceCapacity
	}
	newCapacity := effective + int64(request.Mb)<<20

	ok, err := model.PurchaseUserSpaceCapacity(userId, int(cost), newCapacity)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !ok {
		common.ApiErrorMsg(c, "余额不足")
		return
	}
	// 同步 Redis 缓存中的 quota，避免后续按旧余额读取。
	_, _ = model.GetUserQuota(userId, true)

	common.ApiSuccess(c, gin.H{
		"cost":           cost,
		"capacity_bytes": newCapacity,
	})
}
