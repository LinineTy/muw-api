// @muw-owned

package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
)

// 固定分组（Group Pin）：独立于订阅体系的"永不消失的组锚点"。
// 唯一作用 = 把用户钉在一个分组：管理员改组即建钉（介入即固定），用户也可通过
// group_pin_products 商品购买。锚点态（已配置组优先级）下参与 settle 收敛：
// 用户组 = max(active 订阅锚点, active 固定分组钉)。钉不占订阅"同时持有"名额、
// 不出现在用户订阅列表（独立表），无时长无额度——除分组外没有任何订阅语义。
//
// 单钉模型：一个用户最多一条 active 钉；再次发钉会 release 旧钉（reason=replaced），
// 保证"当前固定分组"语义唯一。

const (
	GroupPinStatusActive   = "active"
	GroupPinStatusReleased = "released"

	GroupPinSourceAdmin    = "admin"
	GroupPinSourcePurchase = "purchase"

	GroupPinReleaseReasonReplaced = "replaced"
)

// GroupPinProduct 固定分组的商品定义：哪些组可钉、价格多少。仅购买路径使用，
// 管理员改组建钉不经过商品。
type GroupPinProduct struct {
	Id          int     `json:"id"`
	Title       string  `json:"title" gorm:"type:varchar(128)"`
	Group       string  `json:"group" gorm:"column:group;type:varchar(64)"`
	PriceAmount float64 `json:"price_amount"`
	Enabled     bool    `json:"enabled" gorm:"default:true"`
	SortOrder   int     `json:"sort_order" gorm:"default:0"`
	CreatedAt   int64   `json:"created_at" gorm:"bigint"`
	UpdatedAt   int64   `json:"updated_at" gorm:"bigint"`
}

func (GroupPinProduct) TableName() string { return "group_pin_products" }

// GroupPin 用户的固定分组记录。active 钉作为永不消失的锚参与组收敛；
// released 钉仅留痕（何时/谁/为何解除）。
type GroupPin struct {
	Id            int    `json:"id"`
	UserId        int    `json:"user_id" gorm:"index"`
	Group         string `json:"group" gorm:"column:group;type:varchar(64)"`
	Status        string `json:"status" gorm:"type:varchar(16);default:'active';index"`
	Source        string `json:"source" gorm:"type:varchar(16);default:'admin'"`
	Note          string `json:"note" gorm:"type:varchar(255)"`
	CreatedAt     int64  `json:"created_at" gorm:"bigint"`
	CreatedBy     int    `json:"created_by"`
	ReleasedAt    int64  `json:"released_at"`
	ReleasedBy    int    `json:"released_by"`
	ReleaseReason string `json:"release_reason" gorm:"type:varchar(255)"`
}

func (GroupPin) TableName() string { return "group_pins" }

func (p *GroupPinProduct) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	p.CreatedAt = now
	p.UpdatedAt = now
	return nil
}

func (p *GroupPinProduct) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

// activeGroupPinGroupTx 返回用户当前 active 固定分组的组名（无钉返回空串）。
// settle 收敛把它当作永不消失的锚点候选。
func activeGroupPinGroupTx(tx *gorm.DB, userId int) (string, error) {
	if tx == nil || userId <= 0 {
		return "", errors.New("invalid pin query args")
	}
	var pin GroupPin
	err := tx.Where("status = ? AND user_id = ?", GroupPinStatusActive, userId).
		Order("id desc").First(&pin).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(pin.Group), nil
}

// PinUserGroupTx 给用户建固定分组钉（管理员改组 / 用户购买共用）。事务内：
//  1. release 该用户现有 active 钉（reason=replaced，单钉模型保证"当前固定分组"唯一）；
//  2. 建新 active 钉；
//  3. 钉组优先级 ≥ 当前组才切组（同购买 R1 ≥ 语义）——给更高组的用户发低组钉只记钉
//     不动组，其更高订阅到期后 settle 自然回落到钉组。
//
// 返回是否切了组；调用方在切组后负责刷用户组缓存。组存在性由调用方校验
// （controller 层对照 group ratio 配置），此处只拦空值。
func PinUserGroupTx(tx *gorm.DB, userId int, group, source, note string, operatorId int) (bool, error) {
	if tx == nil || userId <= 0 {
		return false, errors.New("invalid pin args")
	}
	group = strings.TrimSpace(group)
	if group == "" {
		return false, errors.New("固定分组目标不能为空")
	}
	if source != GroupPinSourceAdmin && source != GroupPinSourcePurchase {
		return false, errors.New("invalid pin source")
	}
	if !common.SubscriptionGroupUpgradeEnabled {
		return false, errors.New("订阅分组功能未启用")
	}
	now := common.GetTimestamp()
	if err := tx.Model(&GroupPin{}).
		Where("status = ? AND user_id = ?", GroupPinStatusActive, userId).
		Updates(map[string]interface{}{
			"status":         GroupPinStatusReleased,
			"released_at":    now,
			"released_by":    operatorId,
			"release_reason": GroupPinReleaseReasonReplaced,
		}).Error; err != nil {
		return false, err
	}
	pin := &GroupPin{
		UserId:    userId,
		Group:     group,
		Status:    GroupPinStatusActive,
		Source:    source,
		Note:      strings.TrimSpace(note),
		CreatedAt: now,
		CreatedBy: operatorId,
	}
	if err := tx.Create(pin).Error; err != nil {
		return false, err
	}
	currentGroup, err := getUserGroupByIdTx(tx, userId)
	if err != nil {
		return false, err
	}
	if group == currentGroup || GroupPriority(group) < GroupPriority(currentGroup) {
		return false, nil
	}
	if err := tx.Model(&User{}).Where("id = ?", userId).Update("group", group).Error; err != nil {
		return false, err
	}
	return true, nil
}

// ReleaseGroupPinTx 解除固定分组钉并收敛用户组（锚点态）。事务内：
//  1. 锁行校验 active 钉存在，置 released；
//  2. settle 重算：剩余锚点（active 订阅 upgrade_group，钉已释放不再贡献）取最高；
//  3. 彻底断档时兜底 = 最近一条带组信息的 ended 订阅的降级目标（与其到期走同一
//     drain 语义），没有 ended 订阅则 default；且只允许真降（同级也拦）。
//
// 返回收敛后的组与是否变更；调用方在变更后负责刷用户组缓存。
func ReleaseGroupPinTx(tx *gorm.DB, pinId, operatorId int, reason string) (string, bool, error) {
	if tx == nil || pinId <= 0 {
		return "", false, errors.New("invalid release args")
	}
	var pin GroupPin
	if err := lockForUpdate(tx).Where("id = ?", pinId).First(&pin).Error; err != nil {
		return "", false, err
	}
	if pin.Status != GroupPinStatusActive {
		return "", false, nil
	}
	if err := tx.Model(&pin).Updates(map[string]interface{}{
		"status":         GroupPinStatusReleased,
		"released_at":    common.GetTimestamp(),
		"released_by":    operatorId,
		"release_reason": strings.TrimSpace(reason),
	}).Error; err != nil {
		return "", false, err
	}
	if !common.SubscriptionGroupUpgradeEnabled || !SubscriptionGroupPrioritiesEnabled() {
		return "", false, nil
	}
	drain := defaultGroupFallbackTx(tx, pin.UserId)
	return settleUserSubscriptionGroupTx(tx, pin.UserId, drain)
}

// defaultGroupFallbackTx 断档兜底目标：最近一条带组信息的 ended 订阅按其降级目标
// 兜底（与到期 drain 同语义）；没有 ended 订阅则 default，防幽灵高档。
func defaultGroupFallbackTx(tx *gorm.DB, userId int) string {
	var lastExpired UserSubscription
	err := tx.Where("user_id = ? AND status = ? AND (downgrade_group <> '' OR upgrade_group <> '')",
		userId, "expired").
		Order("end_time desc, id desc").First(&lastExpired).Error
	if err != nil {
		return "default"
	}
	if target := subscriptionDrainGroup(&lastExpired); target != "" {
		return target
	}
	return "default"
}

// GetGroupPinProductById 按主键读固定分组商品。
func GetGroupPinProductById(id int) (*GroupPinProduct, error) {
	if id <= 0 {
		return nil, errors.New("invalid pin product id")
	}
	var p GroupPinProduct
	if err := DB.First(&p, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// GetEnabledGroupPinProducts 返回上架的固定分组商品（用户购买页，按 sort_order 升序）。
func GetEnabledGroupPinProducts() ([]GroupPinProduct, error) {
	var products []GroupPinProduct
	err := DB.Where("enabled = ?", true).Order("sort_order asc, id asc").Find(&products).Error
	return products, err
}

// createGroupPinOrderTx records a successful wallet-based group-pin order
//（余额购钉的订单流水，kind=group_pin；订阅订单走 createBalanceOrderTx）。
func createGroupPinOrderTx(tx *gorm.DB, userId, pinProductId int, money float64, now int64) error {
	tradeNo := fmt.Sprintf("PINGRP%dNO%s%d", userId, common.GetRandomString(6), time.Now().UnixNano())
	order := &SubscriptionOrder{
		UserId:          userId,
		Kind:            OrderKindGroupPin,
		PinProductId:    pinProductId,
		Money:           money,
		TradeNo:         tradeNo,
		PaymentMethod:   PaymentMethodBalance,
		PaymentProvider: PaymentProviderBalance,
		Status:          common.TopUpStatusSuccess,
		CreateTime:      now,
		CompleteTime:    now,
	}
	return tx.Create(order).Error
}

// PurchaseGroupPin 用户余额购买固定分组。事务内：锁用户行 → 余额校验扣减 →
// PinUserGroupTx（source=purchase，切组同 ≥ 语义）→ 订单流水。返回结果消息。
func PurchaseGroupPin(userId, pinProductId int) (string, error) {
	if userId <= 0 || pinProductId <= 0 {
		return "", errors.New("invalid purchase pin args")
	}
	product, err := GetGroupPinProductById(pinProductId)
	if err != nil {
		return "", errors.New("固定分组商品不存在")
	}
	if !product.Enabled {
		return "", errors.New("该固定分组商品未上架")
	}
	if !common.SubscriptionGroupUpgradeEnabled {
		return "", errors.New("订阅分组功能未启用")
	}
	// 组存在性校验（与套餐 upgrade_group 同口径）。
	if _, ok := ratio_setting.GetGroupRatioCopy()[product.Group]; !ok {
		return "", errors.New("固定分组目标不存在")
	}
	requiredQuota, err := calcSubscriptionBalanceQuota(product.PriceAmount)
	if err != nil {
		return "", err
	}
	now := GetDBTimestamp()
	pinChanged := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		if requiredQuota > 0 && user.Quota < requiredQuota {
			return errors.New("余额不足")
		}
		if requiredQuota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("quota", gorm.Expr("quota - ?", requiredQuota)).Error; err != nil {
				return err
			}
		}
		changed, err := PinUserGroupTx(tx, userId, product.Group, GroupPinSourcePurchase, product.Title, userId)
		if err != nil {
			return err
		}
		pinChanged = changed
		return createGroupPinOrderTx(tx, userId, product.Id, product.PriceAmount, now)
	})
	if err != nil {
		return "", err
	}
	if pinChanged {
		refreshSubscriptionUserGroupCache(userId, "group pin purchase")
	}
	return fmt.Sprintf("固定分组已生效: %s", product.Group), nil
}
