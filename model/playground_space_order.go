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
		RecordTopupLogWithPayment(logUserId, fmt.Sprintf("云空间购买成功，容量: %d MB，支付金额: %.2f，支付方式: %s", logMb, logMoney, logPaymentMethod), logPaymentMethod)
	}
	return nil
}

// SumPendingPlaygroundSpaceOrdersByUser 返回某用户所有 pending 云空间订单的
// mb 总和与单数。用于下单预检预留容量：epay 订单 pending 期间尚未累加
// space_purchased_bytes，若预检只算已购量，并发多单会互相通过预检，支付后回调
// 超限卡死（收钱不给货）。预留后把竞争窗口收窄到真正的并发边界。
func SumPendingPlaygroundSpaceOrdersByUser(userId int) (mbSum int, count int64, err error) {
	err = DB.Model(&PlaygroundSpaceOrder{}).
		Where("user_id = ? AND status = ?", userId, common.TopUpStatusPending).
		Select("COALESCE(SUM(mb), 0)").Scan(&mbSum).Error
	if err != nil {
		return 0, 0, err
	}
	err = DB.Model(&PlaygroundSpaceOrder{}).
		Where("user_id = ? AND status = ?", userId, common.TopUpStatusPending).
		Count(&count).Error
	return mbSum, count, err
}

// ExpireTimeoutPlaygroundSpaceOrders 批量把超时未支付的 pending 订单置为 expired
// （cutoff 之前的创建时间）。幂等：只影响 pending。返回受影响行数。由后台定时任务
// 调用，防止 pending 订单无限堆积并长期占着下单预检的预留额度。
func ExpireTimeoutPlaygroundSpaceOrders(cutoff int64) (int64, error) {
	result := DB.Model(&PlaygroundSpaceOrder{}).
		Where("status = ? AND create_time < ?", common.TopUpStatusPending, cutoff).
		Updates(map[string]interface{}{
			"status":        common.TopUpStatusExpired,
			"complete_time": common.GetTimestamp(),
		})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// AdminCompletePlaygroundSpaceOrder 管理员补单：事务内行锁 + 幂等 + 原子扩容，
// 逻辑与 CompletePlaygroundSpaceOrder 一致，但跳过跨网关校验（管理员人工确认）
// 并以管理员身份记账。用于 epay 回调丢失/失败或累计上限卡单时的人工处置——
// 这是「收钱不给货」场景的唯一出路。
func AdminCompletePlaygroundSpaceOrder(tradeNo string, callerIp string, initialBytes int64, maxPurchasedBytes int64) error {
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
		if order.Status == common.TopUpStatusSuccess {
			return nil
		}
		if order.Status != common.TopUpStatusPending {
			return ErrPlaygroundSpaceOrderStatusInvalid
		}

		deltaBytes := int64(order.Mb) << 20
		query := tx.Model(&User{}).Where("id = ?", order.UserId)
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
		return err
	}
	if logUserId > 0 {
		common.SysLog(fmt.Sprintf("admin completed playground space order %s: user %d +%d MB (money %.2f, method %s, caller_ip %s)", tradeNo, logUserId, logMb, logMoney, logPaymentMethod, callerIp))
		RecordTopupLogWithPayment(logUserId, fmt.Sprintf("云空间购买补单成功，容量: %d MB，支付金额: %.2f，支付方式: %s", logMb, logMoney, logPaymentMethod), logPaymentMethod)
	}
	return nil
}

// RejectPlaygroundSpaceOrder 管理员驳回/关闭待支付订单（pending → expired）。
// 用于人工处置无法完成的订单（如回调丢失后用户不再支付）。幂等：非 pending 早退。
func RejectPlaygroundSpaceOrder(tradeNo string, callerIp string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}
	var logUserId int
	var logMb int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order PlaygroundSpaceOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrPlaygroundSpaceOrderNotFound
		}
		if order.Status != common.TopUpStatusPending {
			return nil
		}
		order.Status = common.TopUpStatusExpired
		order.CompleteTime = common.GetTimestamp()
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logMb = order.Mb
		return nil
	})
	if err != nil {
		return err
	}
	if logUserId > 0 {
		common.SysLog(fmt.Sprintf("admin rejected playground space order for user %d (%d MB, caller_ip %s)", logUserId, logMb, callerIp))
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

// GetUserPlaygroundSpaceOrders 分页查询某用户的云空间订单（可选按 trade_no 搜索）。
func GetUserPlaygroundSpaceOrders(userId int, pageInfo *common.PageInfo, keyword string) (orders []PlaygroundSpaceOrder, total int64, err error) {
	query := DB.Model(&PlaygroundSpaceOrder{}).Where("user_id = ?", userId)
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}
	if err = query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&orders).Error; err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}

// GetAllPlaygroundSpaceOrders 管理员分页查询全平台云空间订单（可选按 trade_no 搜索）。
func GetAllPlaygroundSpaceOrders(pageInfo *common.PageInfo, keyword string) (orders []PlaygroundSpaceOrder, total int64, err error) {
	query := DB.Model(&PlaygroundSpaceOrder{})
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}
	if err = query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&orders).Error; err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}
