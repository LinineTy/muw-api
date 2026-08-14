package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// PlaygroundSpaceOrder 云空间在线支付订单（易支付）。支付成功后直接扩容
// users.space_capacity + 累计 space_purchased_bytes，不经过 quota（与余额购买
// 互补：余额购买扣 quota，在线支付收现金）。回调幂等，见 CompletePlaygroundSpaceOrder。
type PlaygroundSpaceOrder struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id" gorm:"index"`
	Mb              int     `json:"mb"`
	Cost            int64   `json:"cost"` // 原始额度（= userSpacePurchaseRawQuota），与余额购买同口径，供审计
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string  `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string  `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	Status          string  `json:"status"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time"`
	ProviderPayload string  `json:"provider_payload" gorm:"type:text"`
}

func (PlaygroundSpaceOrder) TableName() string { return "playground_space_orders" }

func (o *PlaygroundSpaceOrder) Insert() error {
	if o.CreateTime == 0 {
		o.CreateTime = common.GetTimestamp()
	}
	return DB.Create(o).Error
}

func (o *PlaygroundSpaceOrder) Update() error {
	return DB.Save(o).Error
}

func GetPlaygroundSpaceOrderByTradeNo(tradeNo string) *PlaygroundSpaceOrder {
	if tradeNo == "" {
		return nil
	}
	var order PlaygroundSpaceOrder
	if err := DB.Where("trade_no = ?", tradeNo).First(&order).Error; err != nil {
		return nil
	}
	return &order
}

var (
	ErrPlaygroundSpaceOrderNotFound       = errors.New("playground space order not found")
	ErrPlaygroundSpaceOrderStatusInvalid  = errors.New("playground space order status invalid")
	ErrPlaygroundSpaceOrderCapacityExceed = errors.New("playground space cumulative limit exceeded")
)

// CompletePlaygroundSpaceOrder 幂等完成云空间支付订单：事务内锁定订单行，校验
// 支付网关（防跨网关回调）与状态（success 早退幂等），然后对用户行做原子容量增量
// （CASE 防并发覆盖）并累加已购量。累计上限并入 UPDATE 条件：支付等待期用户又
// 余额购买导致超限时回滚、订单保持 pending、记日志供管理员介入——宁可订单不完成
// 也不超配容量。initialBytes/maxPurchasedBytes 由 controller 传（model 不依赖 setting）。
func CompletePlaygroundSpaceOrder(tradeNo string, providerPayload string, expectedPaymentProvider string, actualPaymentMethod string, initialBytes int64, maxPurchasedBytes int64) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}
	var logUserId int
	var logMb int
	var logMoney float64
	var logPaymentMethod string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order PlaygroundSpaceOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrPlaygroundSpaceOrderNotFound
		}
		if expectedPaymentProvider != "" && order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status == common.TopUpStatusSuccess {
			return nil
		}
		if order.Status != common.TopUpStatusPending {
			return ErrPlaygroundSpaceOrderStatusInvalid
		}

		deltaBytes := int64(order.Mb) << 20
		query := tx.Model(&User{}).Where("id = ?", order.UserId)
		// COALESCE 兜底存量 NULL（v6 新列无默认值），NULL + x 会得 NULL 使条件恒假/写回 NULL。
		if maxPurchasedBytes > 0 {
			query = query.Where("COALESCE(space_purchased_bytes, 0) + ? <= ?", deltaBytes, maxPurchasedBytes)
		}
		result := query.Updates(map[string]interface{}{
			"space_capacity": gorm.Expr(
				"CASE WHEN space_capacity > 0 THEN space_capacity + ? ELSE ? + ? END",
				deltaBytes, initialBytes, deltaBytes,
			),
			"space_purchased_bytes": gorm.Expr("COALESCE(space_purchased_bytes, 0) + ?", deltaBytes),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrPlaygroundSpaceOrderCapacityExceed
		}

		order.Status = common.TopUpStatusSuccess
		order.CompleteTime = common.GetTimestamp()
		if providerPayload != "" {
			order.ProviderPayload = providerPayload
		}
		if actualPaymentMethod != "" && order.PaymentMethod != actualPaymentMethod {
			order.PaymentMethod = actualPaymentMethod
		}
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logMb = order.Mb
		logMoney = order.Money
		logPaymentMethod = order.PaymentMethod
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrPlaygroundSpaceOrderCapacityExceed) {
			common.SysLog(fmt.Sprintf("playground space order %s exceeded cumulative limit, order left pending for admin review", tradeNo))
		}
		return err
	}
	if logUserId > 0 {
		common.SysLog(fmt.Sprintf("user %d purchased %d MB playground space via epay (money %.2f, method %s)", logUserId, logMb, logMoney, logPaymentMethod))
		// 用户可见日志（usage-logs 页）：与充值/订阅购买一致，事务外记录。
		RecordLog(logUserId, LogTypeTopup, fmt.Sprintf("云空间购买成功，容量: %d MB，支付金额: %.2f，支付方式: %s", logMb, logMoney, logPaymentMethod))
	}
	return nil
}

// ExpirePlaygroundSpaceOrder 关闭未支付的云空间订单（拉起支付失败/超时）。幂等：
// 只有 pending 才会置为 expired。
func ExpirePlaygroundSpaceOrder(tradeNo string, expectedPaymentProvider string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var order PlaygroundSpaceOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrPlaygroundSpaceOrderNotFound
		}
		if expectedPaymentProvider != "" && order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status != common.TopUpStatusPending {
			return nil
		}
		order.Status = common.TopUpStatusExpired
		order.CompleteTime = common.GetTimestamp()
		return tx.Save(&order).Error
	})
}
