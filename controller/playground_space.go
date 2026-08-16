package controller

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
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
	// 对话同步消息也计入云空间用量（与图片合并为统一容量）。
	conversationUsed, err := model.SumPlaygroundConversationSizesByUser(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	conversationCount, err := model.CountPlaygroundConversationsByUser(userId)
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
	purchasedBytes := int64(0)
	if !isRoot {
		capacityBytes = int64(setting.UserSpaceInitialMB) << 20
		if user, err := model.GetUserById(userId, false); err == nil {
			if user.SpaceCapacity > 0 {
				capacityBytes = user.SpaceCapacity
			}
			purchasedBytes = user.SpacePurchasedBytes
		}
	}

	common.ApiSuccess(c, gin.H{
		"capacity_bytes":          capacityBytes,
		"used_bytes":              used + conversationUsed,
		"purchase_ratio":          setting.UserSpacePurchaseRatio,
		"max_purchase_mb":         setting.UserSpaceMaxPurchaseMB,
		"max_purchased_mb":        setting.UserSpaceMaxPurchasedMB,
		"purchased_bytes":         purchasedBytes,
		"global_used_bytes":       globalTransient + globalPermanent,
		"global_max_bytes":        int64(setting.UserSpaceGlobalMaxMB) << 20,
		"transient_count":         transientCount,
		"transient_bytes":         transientBytes,
		"permanent_count":         permanentCount,
		"permanent_bytes":         permanentBytes,
		"conversation_count":      conversationCount,
		"conversation_used_bytes": conversationUsed,
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
	if c.GetInt("role") == common.RoleRootUser {
		common.ApiErrorMsg(c, "root 用户无需购买云空间")
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
	// 注意：userSpacePurchaseRawQuota 全部走 common.QuotaRound（已饱和到 int32 且
	// 非正即被下方拦截），极端配置下 cost 会被饱和为 MaxInt32 而非回绕。
	if cost <= 0 {
		common.ApiErrorMsg(c, "购买比例配置错误")
		return
	}

	// 累计购买上限预检查（原子 UPDATE 内有同名条件兜底并发，这里只为给出准确提示）。
	// 与 epay 下单一致：已购量 + 本用户 pending 订单预留 + 本次，一起对比上限，
	// 防止「epay 订单 pending 期间又余额购买」把回调卡死在超限上。
	if setting.UserSpaceMaxPurchasedMB > 0 {
		pendingMb, _, err := model.SumPendingPlaygroundSpaceOrdersByUser(userId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		user, err := model.GetUserById(userId, false)
		if err != nil {
			common.ApiErrorMsg(c, "无效的用户")
			return
		}
		if user.SpacePurchasedBytes+int64(pendingMb)<<20+int64(request.Mb)<<20 > int64(setting.UserSpaceMaxPurchasedMB)<<20 {
			common.ApiErrorMsg(c, "购买容量超过累计上限")
			return
		}
	}

	// 原子条件扣费 + 容量增量（并发购买不会互相覆盖，先买者容量不丢）。
	ok, err := model.PurchaseUserSpaceCapacity(
		userId, int(cost), int64(request.Mb)<<20, int64(setting.UserSpaceInitialMB)<<20,
		int64(setting.UserSpaceMaxPurchasedMB)<<20)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !ok {
		// 区分失败原因：原子 UPDATE 不通过有两种可能（余额不足 / 超累计上限），
		// 读一次用户行给准确提示（原子条件已保证正确性，这里只为文案准确）。
		if setting.UserSpaceMaxPurchasedMB > 0 {
			if user, err := model.GetUserById(userId, false); err == nil &&
				user.SpacePurchasedBytes+int64(request.Mb)<<20 > int64(setting.UserSpaceMaxPurchasedMB)<<20 {
				common.ApiErrorMsg(c, "购买容量超过累计上限")
				return
			}
		}
		common.ApiErrorMsg(c, "余额不足")
		return
	}
	// 同步 Redis 缓存中的 quota，避免后续按旧余额读取。
	_, _ = model.GetUserQuota(userId, true)

	// 重新读取真实容量（并发购买下以 DB 原子增量结果为准）供响应与审计。
	newCapacity := int64(setting.UserSpaceInitialMB) << 20
	purchasedBytes := int64(0)
	if freshUser, err := model.GetUserById(userId, false); err == nil {
		newCapacity = freshUser.SpaceCapacity
		purchasedBytes = freshUser.SpacePurchasedBytes
	}
	common.SysLog(fmt.Sprintf("user %d purchased %d MB playground space (cost %d quota, capacity now %d bytes)",
		userId, request.Mb, cost, newCapacity))
	// 用户可见日志（usage-logs 页）：与充值/订阅购买一致。
	model.RecordLog(userId, model.LogTypeTopup, fmt.Sprintf("云空间购买成功，容量: %d MB，消耗额度: %s", request.Mb, logger.LogQuota(int(cost))))

	common.ApiSuccess(c, gin.H{
		"cost":             cost,
		"capacity_bytes":   newCapacity,
		"max_purchased_mb": setting.UserSpaceMaxPurchasedMB,
		"purchased_bytes":  purchasedBytes,
	})
}
