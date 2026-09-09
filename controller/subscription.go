package controller

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---- Shared types ----

type SubscriptionPlanDTO struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

type BillingPreferenceRequest struct {
	BillingPreference string `json:"billing_preference"`
}

type SubscriptionBalancePayRequest struct {
	PlanId int `json:"plan_id"`
}

// validateResetWindows 校验动态重置窗口列表：单位白名单、时长 > 0、额度 >= 0、无重复定义。
func validateResetWindows(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var windows []model.ResetWindow
	if err := common.UnmarshalJsonStr(raw, &windows); err != nil {
		return errors.New("重置窗口格式错误，应为 JSON 数组")
	}
	seen := make(map[string]struct{}, len(windows))
	prevSeconds := int64(-1)
	for i, w := range windows {
		switch w.Unit {
		case model.SubscriptionWindowUnitHour, model.SubscriptionWindowUnitDay,
			model.SubscriptionWindowUnitWeek, model.SubscriptionWindowUnitMonth:
		default:
			return fmt.Errorf("第 %d 个窗口时长单位无效", i+1)
		}
		if w.Value <= 0 {
			return fmt.Errorf("第 %d 个窗口时长数值必须大于 0", i+1)
		}
		if w.Limit < 0 {
			return fmt.Errorf("第 %d 个窗口额度不能为负数", i+1)
		}
		key := fmt.Sprintf("%s:%d", w.Unit, w.Value)
		if _, ok := seen[key]; ok {
			return fmt.Errorf("存在重复窗口定义（第 %d 个）：每%s %d 已配置", i+1, w.Unit, w.Value)
		}
		seen[key] = struct{}{}
		// 严格递增：后一个窗口时长必须大于前一个（月按 30 天估，与前端校验一致），
		// 保证窗口列表天然按时长升序，展示与状态索引不依赖顺序调整。
		secs := int64(0)
		switch w.Unit {
		case model.SubscriptionWindowUnitHour:
			secs = int64(w.Value) * 3600
		case model.SubscriptionWindowUnitDay:
			secs = int64(w.Value) * 86400
		case model.SubscriptionWindowUnitWeek:
			secs = int64(w.Value) * 7 * 86400
		case model.SubscriptionWindowUnitMonth:
			secs = int64(w.Value) * 30 * 86400
		}
		// 上界：窗口时长 ≤ 一年（约 366 天）。既保证 calcWindowNextReset 的
		// time.Duration(w.Value)*unit 不溢出（int64 纳秒），也避免管理端误配巨大窗口。
		if secs > 366*86400 {
			return fmt.Errorf("第 %d 个窗口时长不能超过一年（约 366 天）", i+1)
		}
		if i > 0 && secs <= prevSeconds {
			return fmt.Errorf("第 %d 个窗口时长必须严格大于前一个（窗口列表需按时长递增排列）", i+1)
		}
		prevSeconds = secs
	}
	return nil
}

// validatePlanResetWindows 对套餐的 reset_windows 做校验：动态窗口是唯一额度模型，
// 列表必须非空；全部窗口额度为 0 = 无限额度（合法）。
func validatePlanResetWindows(p model.SubscriptionPlan) error {
	if strings.TrimSpace(p.ResetWindowsRaw) == "" {
		return errors.New("动态窗口至少需要配置一个窗口（全部额度为 0 即无限额度）")
	}
	if err := validateResetWindows(p.ResetWindowsRaw); err != nil {
		return err
	}
	windows := p.ResetWindows()
	if len(windows) == 0 {
		return errors.New("动态窗口至少需要配置一个窗口（全部额度为 0 即无限额度）")
	}
	return nil
}

// ---- User APIs ----

func GetSubscriptionPlans(c *gin.Context) {
	var plans []model.SubscriptionPlan
	if err := model.DB.Where("enabled = ?", true).Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		p.NormalizeDefaults()
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

func GetSubscriptionSelf(c *gin.Context) {
	userId := c.GetInt("id")
	settingMap, _ := model.GetUserSetting(userId, false)
	pref := common.NormalizeBillingPreference(settingMap.BillingPreference)

	// Get all subscriptions (including expired)
	allSubscriptions, err := model.GetAllUserSubscriptions(userId)
	if err != nil {
		allSubscriptions = []model.SubscriptionSummary{}
	}

	// Get active subscriptions for backward compatibility
	activeSubscriptions, err := model.GetAllActiveUserSubscriptions(userId)
	if err != nil {
		activeSubscriptions = []model.SubscriptionSummary{}
	}

	common.ApiSuccess(c, gin.H{
		"billing_preference": pref,
		"subscriptions":      activeSubscriptions, // all active subscriptions
		"all_subscriptions":  allSubscriptions,    // all subscriptions including expired
		"max_simultaneous":   common.SubscriptionMaxSimultaneous,
	})
}

func UpdateSubscriptionPreference(c *gin.Context) {
	userId := c.GetInt("id")
	var req BillingPreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	pref := common.NormalizeBillingPreference(req.BillingPreference)

	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	current := user.GetSetting()
	current.BillingPreference = pref
	if err := model.UpdateUserSetting(user.Id, current); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"billing_preference": pref})
}

func SubscriptionRequestBalancePay(c *gin.Context) {

	userId := c.GetInt("id")
	var req SubscriptionBalancePayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	msg, err := model.PurchaseWithStrategy(userId, req.PlanId, 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"message": msg})
}

// ---- User self-service: cancel / renew / auto-renew / priority / expiring ----

type SubscriptionCancelRequest struct {
	SubscriptionId int    `json:"subscription_id"`
	Mode           string `json:"mode"`
}

func SubscriptionCancel(c *gin.Context) {
	userId := c.GetInt("id")
	var req SubscriptionCancelRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SubscriptionId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	msg, err := model.UserCancelSubscription(userId, req.SubscriptionId, req.Mode)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"message": msg})
}

type SubscriptionRenewRequest struct {
	SubscriptionId int `json:"subscription_id"`
}

func SubscriptionRequestRenewBalance(c *gin.Context) {
	userId := c.GetInt("id")
	var req SubscriptionRenewRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SubscriptionId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	var sub model.UserSubscription
	if err := model.DB.Where("id = ? AND user_id = ?", req.SubscriptionId, userId).First(&sub).Error; err != nil {
		common.ApiErrorMsg(c, "订阅不存在")
		return
	}
	msg, err := model.PurchaseWithStrategy(userId, sub.PlanId, req.SubscriptionId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"message": msg})
}

type SubscriptionAutoRenewRequest struct {
	SubscriptionId int  `json:"subscription_id"`
	Enabled        bool `json:"enabled"`
}

func SubscriptionUpdateAutoRenew(c *gin.Context) {
	userId := c.GetInt("id")
	var req SubscriptionAutoRenewRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SubscriptionId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	var sub model.UserSubscription
	if err := model.DB.Where("id = ? AND user_id = ? AND status = ?", req.SubscriptionId, userId, "active").First(&sub).Error; err != nil {
		common.ApiErrorMsg(c, "订阅不存在或已失效")
		return
	}
	if req.Enabled {
		// 已到期取消（cancel_at_end）的订阅不允许重开自动续费：否则会静默清掉
		// cancel_at_end 标记，把用户的"到期取消"悄悄撤销。
		if sub.CancelAtEnd {
			common.ApiErrorMsg(c, "订阅已到期取消，无法开启自动续费")
			return
		}
		plan, err := model.GetSubscriptionPlanById(sub.PlanId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if plan.AllowBalancePay != nil && !*plan.AllowBalancePay {
			common.ApiErrorMsg(c, "该套餐不允许余额支付，无法开启自动续费")
			return
		}
	}
	if err := model.DB.Model(&model.UserSubscription{}).
		Where("id = ? AND user_id = ?", req.SubscriptionId, userId).
		Updates(map[string]interface{}{
			"auto_renew":        req.Enabled,
			"auto_renew_failed": false,
			"cancel_at_end":     false,
			"updated_at":        common.GetTimestamp(),
		}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type SubscriptionPriorityRequest struct {
	SubscriptionId int `json:"subscription_id"`
}

func SubscriptionUpdatePriority(c *gin.Context) {
	userId := c.GetInt("id")
	var req SubscriptionPriorityRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SubscriptionId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.SetSubscriptionPriority(userId, req.SubscriptionId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetSubscriptionExpiring(c *gin.Context) {
	userId := c.GetInt("id")
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days <= 0 {
		days = 7
	}
	items, err := model.GetExpiringSubscriptions(userId, days)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, items)
}

// GetUserSubscriptionOrders 当前用户的订阅订单（分页 + 可选 trade_no 搜索 + status/payment_method 过滤）。
// 订阅购买/续费的支付记录在此列表，与充值记录分离展示。
func GetUserSubscriptionOrders(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户")
		return
	}
	pageInfo := common.GetPageQuery(c)
	orders, total, err := model.GetUserSubscriptionOrders(userId, pageInfo, c.Query("keyword"), c.Query("status"), c.Query("method"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

// ---- Admin APIs ----

func AdminListSubscriptionPlans(c *gin.Context) {
	var plans []model.SubscriptionPlan
	if err := model.DB.Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		p.NormalizeDefaults()
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

type AdminUpsertSubscriptionPlanRequest struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

func AdminCreateSubscriptionPlan(c *gin.Context) {

	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	req.Plan.Id = 0
	if strings.TrimSpace(req.Plan.Title) == "" {
		common.ApiErrorMsg(c, "套餐标题不能为空")
		return
	}
	if req.Plan.PriceAmount < 0 {
		common.ApiErrorMsg(c, "价格不能为负数")
		return
	}
	if req.Plan.PriceAmount > 9999 {
		common.ApiErrorMsg(c, "价格不能超过9999")
		return
	}
	if req.Plan.Currency == "" {
		req.Plan.Currency = "USD"
	}
	req.Plan.Currency = "USD"
	if req.Plan.AllowBalancePay == nil {
		req.Plan.AllowBalancePay = common.GetPointer(true)
	}
	if req.Plan.AllowWalletOverflow == nil {
		req.Plan.AllowWalletOverflow = common.GetPointer(true)
	}
	if req.Plan.DurationUnit == "" {
		req.Plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if req.Plan.DurationValue <= 0 && req.Plan.DurationUnit != model.SubscriptionDurationCustom {
		req.Plan.DurationValue = 1
	}
	if req.Plan.MaxPurchasePerUser < 0 {
		common.ApiErrorMsg(c, "购买上限不能为负数")
		return
	}
	req.Plan.UpgradeGroup = strings.TrimSpace(req.Plan.UpgradeGroup)
	if req.Plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.UpgradeGroup]; !ok {
			common.ApiErrorMsg(c, "升级分组不存在")
			return
		}
	}
	req.Plan.DowngradeGroup = strings.TrimSpace(req.Plan.DowngradeGroup)
	if req.Plan.DowngradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.DowngradeGroup]; !ok {
			common.ApiErrorMsg(c, "降级分组不存在")
			return
		}
	}
	if req.Plan.MaxCumulativeSeconds < 0 {
		common.ApiErrorMsg(c, "累计时长上限不能为负数")
		return
	}
	req.Plan.ExclusiveGroup = strings.TrimSpace(req.Plan.ExclusiveGroup)
	if req.Plan.Priority < 0 {
		common.ApiErrorMsg(c, "套餐优先级不能为负数")
		return
	}
	if req.Plan.AllowedGroups != "" {
		var groups []string
		if err := common.UnmarshalJsonStr(req.Plan.AllowedGroups, &groups); err != nil {
			common.ApiErrorMsg(c, "允许订阅组格式错误，应为 JSON 数组")
			return
		}
	}
	req.Plan.AllowedGroups = model.NormalizeSubscriptionPlanAllowedGroups(req.Plan.AllowedGroups)
	if err := validatePlanResetWindows(req.Plan); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	err := model.DB.Create(&req.Plan).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(req.Plan.Id)
	common.ApiSuccess(c, req.Plan)
}

func AdminUpdateSubscriptionPlan(c *gin.Context) {

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.Plan.Title) == "" {
		common.ApiErrorMsg(c, "套餐标题不能为空")
		return
	}
	if req.Plan.PriceAmount < 0 {
		common.ApiErrorMsg(c, "价格不能为负数")
		return
	}
	if req.Plan.PriceAmount > 9999 {
		common.ApiErrorMsg(c, "价格不能超过9999")
		return
	}
	req.Plan.Id = id
	if req.Plan.Currency == "" {
		req.Plan.Currency = "USD"
	}
	req.Plan.Currency = "USD"
	if req.Plan.DurationUnit == "" {
		req.Plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if req.Plan.DurationValue <= 0 && req.Plan.DurationUnit != model.SubscriptionDurationCustom {
		req.Plan.DurationValue = 1
	}
	if req.Plan.MaxPurchasePerUser < 0 {
		common.ApiErrorMsg(c, "购买上限不能为负数")
		return
	}
	req.Plan.UpgradeGroup = strings.TrimSpace(req.Plan.UpgradeGroup)
	if req.Plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.UpgradeGroup]; !ok {
			common.ApiErrorMsg(c, "升级分组不存在")
			return
		}
	}
	req.Plan.DowngradeGroup = strings.TrimSpace(req.Plan.DowngradeGroup)
	if req.Plan.DowngradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.DowngradeGroup]; !ok {
			common.ApiErrorMsg(c, "降级分组不存在")
			return
		}
	}
	if req.Plan.MaxCumulativeSeconds < 0 {
		common.ApiErrorMsg(c, "累计时长上限不能为负数")
		return
	}
	req.Plan.ExclusiveGroup = strings.TrimSpace(req.Plan.ExclusiveGroup)
	if req.Plan.Priority < 0 {
		common.ApiErrorMsg(c, "套餐优先级不能为负数")
		return
	}
	if req.Plan.AllowedGroups != "" {
		var groups []string
		if err := common.UnmarshalJsonStr(req.Plan.AllowedGroups, &groups); err != nil {
			common.ApiErrorMsg(c, "允许订阅组格式错误，应为 JSON 数组")
			return
		}
	}
	req.Plan.AllowedGroups = model.NormalizeSubscriptionPlanAllowedGroups(req.Plan.AllowedGroups)
	if err := validatePlanResetWindows(req.Plan); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		// 读取旧 reset_windows，判断窗口列表是否变化（转换/编辑 → 重置活跃订阅）。
		var oldResetWindows string
		if err := tx.Model(&model.SubscriptionPlan{}).Where("id = ?", id).
			Select("reset_windows").Scan(&oldResetWindows).Error; err != nil {
			return err
		}
		// update plan (allow zero values updates with map)
		updateMap := map[string]any{
			"title":                      req.Plan.Title,
			"subtitle":                   req.Plan.Subtitle,
			"price_amount":               req.Plan.PriceAmount,
			"currency":                   req.Plan.Currency,
			"duration_unit":              req.Plan.DurationUnit,
			"duration_value":             req.Plan.DurationValue,
			"custom_seconds":             req.Plan.CustomSeconds,
			"enabled":                    req.Plan.Enabled,
			"sort_order":                 req.Plan.SortOrder,
			"is_recommended":             req.Plan.IsRecommended,
			"max_purchase_per_user":      req.Plan.MaxPurchasePerUser,
			"upgrade_group":              req.Plan.UpgradeGroup,
			"downgrade_group":            req.Plan.DowngradeGroup,
			"max_cumulative_seconds":     req.Plan.MaxCumulativeSeconds,
			"exclusive_group":            req.Plan.ExclusiveGroup,
			"allowed_groups":             req.Plan.AllowedGroups,
			"priority":                   req.Plan.Priority,
			"reset_windows":              req.Plan.ResetWindowsRaw,
			"updated_at":                 common.GetTimestamp(),
		}
		if req.Plan.AllowBalancePay != nil {
			updateMap["allow_balance_pay"] = *req.Plan.AllowBalancePay
		}
		if req.Plan.AllowWalletOverflow != nil {
			updateMap["allow_wallet_overflow"] = *req.Plan.AllowWalletOverflow
		}
		if err := tx.Model(&model.SubscriptionPlan{}).Where("id = ?", id).Updates(updateMap).Error; err != nil {
			return err
		}
		// 窗口列表变化 → 重置该套餐活跃订阅的窗口计数（"改动即重置"，管理端主动重定义额度）。
		// 判等用语义比较（ResetWindowsEqual）：前端保存会重新序列化 JSON，字节差异不算变化。
		// 空列表已在 validatePlanResetWindows 拒绝，此处 reset_windows 必非空。
		windowsChanged := !model.ResetWindowsEqual(oldResetWindows, req.Plan.ResetWindowsRaw)
		if windowsChanged {
			planForReset := &model.SubscriptionPlan{Id: id, ResetWindowsRaw: req.Plan.ResetWindowsRaw}
			if _, err := model.ApplyPlanWindowsToActiveSubscriptions(tx, planForReset, common.GetTimestamp()); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

type AdminUpdateSubscriptionPlanStatusRequest struct {
	Enabled *bool `json:"enabled"`
}

func AdminUpdateSubscriptionPlanStatus(c *gin.Context) {

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminUpdateSubscriptionPlanStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.DB.Model(&model.SubscriptionPlan{}).Where("id = ?", id).Update("enabled", *req.Enabled).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

func AdminDeleteSubscriptionPlan(c *gin.Context) {

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	msg, err := model.DeleteSubscriptionPlan(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

type AdminBindSubscriptionRequest struct {
	UserId int `json:"user_id"`
	PlanId int `json:"plan_id"`
}

func AdminBindSubscription(c *gin.Context) {

	var req AdminBindSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.UserId <= 0 || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	msg, err := model.AdminBindSubscription(req.UserId, req.PlanId, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Admin: user subscription management ----

func AdminListUserSubscriptions(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户ID")
		return
	}
	subs, err := model.GetAllUserSubscriptions(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, subs)
}

// AdminListAllSubscriptions returns a paginated, filterable, sortable list of
// every user subscription across all users. Query params: p, page_size, status,
// user, plan_id, sort_by, sort_order.
func AdminListAllSubscriptions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	status := c.Query("status")
	userKeyword := c.Query("user")
	planId, _ := strconv.Atoi(c.Query("plan_id"))
	sortOptions := model.NewSubscriptionSortOptions(c.Query("sort_by"), c.Query("sort_order"))
	items, total, err := model.GetAllSubscriptionsByAdmin(status, userKeyword, planId,
		pageInfo.GetStartIdx(), pageInfo.GetPageSize(), sortOptions)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

type AdminCreateUserSubscriptionRequest struct {
	PlanId int `json:"plan_id"`
}

type AdminResetSubscriptionRequest struct {
	PlanId           int   `json:"plan_id"`
	AdvanceResetTime *bool `json:"advance_reset_time"`
}

func resolveAdvanceResetTime(value *bool) bool {
	if value == nil {
		return true
	}
	return *value
}

func recordSubscriptionResetUserLogs(c *gin.Context, result *model.SubscriptionResetResult, adminInfo *model.AuditAdminInfo) {
	if result == nil || result.ResetCount == 0 {
		return
	}
	content := fmt.Sprintf("管理员重置订阅套餐 %s（ID: %d）额度", result.PlanTitle, result.PlanId)
	for _, userId := range result.AffectedUserIds {
		model.RecordLogWithAdminInfo(userId, model.LogTypeManage, content, adminInfo, nil, c)
	}
}

// AdminCreateUserSubscription creates a new user subscription from a plan (no payment).
func AdminCreateUserSubscription(c *gin.Context) {

	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户ID")
		return
	}
	var req AdminCreateUserSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	msg, err := model.AdminBindSubscription(userId, req.PlanId, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminResetUserSubscriptionsByPlan(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户ID")
		return
	}
	var req AdminResetSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	advanceResetTime := resolveAdvanceResetTime(req.AdvanceResetTime)
	result, err := model.AdminResetUserSubscriptionsByPlan(userId, req.PlanId, advanceResetTime)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordSubscriptionResetUserLogs(c, result, auditOperatorInfo(c))
	recordManageAuditFor(c, userId, "subscription.user_plan_reset", map[string]any{
		"target_user_id":     userId,
		"plan_id":            result.PlanId,
		"plan_title":         result.PlanTitle,
		"reset_count":        result.ResetCount,
		"user_count":         result.UserCount,
		"advance_reset_time": result.AdvanceResetTime,
	})
	common.ApiSuccess(c, result)
}

func AdminResetPlanSubscriptions(c *gin.Context) {
	planId, _ := strconv.Atoi(c.Param("id"))
	if planId <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminResetSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	advanceResetTime := resolveAdvanceResetTime(req.AdvanceResetTime)
	result, err := model.AdminResetPlanSubscriptions(planId, advanceResetTime)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordSubscriptionResetUserLogs(c, result, auditOperatorInfo(c))
	common.SysLog(fmt.Sprintf("admin reset subscription plan %d quota: reset_count=%d user_count=%d advance_reset_time=%t",
		result.PlanId, result.ResetCount, result.UserCount, result.AdvanceResetTime))
	recordManageAudit(c, "subscription.plan_reset", map[string]any{
		"plan_id":            result.PlanId,
		"plan_title":         result.PlanTitle,
		"reset_count":        result.ResetCount,
		"user_count":         result.UserCount,
		"advance_reset_time": result.AdvanceResetTime,
	})
	common.ApiSuccess(c, result)
}

// AdminInvalidateUserSubscription cancels a user subscription immediately.
func AdminInvalidateUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorMsg(c, "无效的订阅ID")
		return
	}
	msg, err := model.AdminInvalidateUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminDeleteUserSubscription soft-deletes a user subscription (record kept).
func AdminDeleteUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorMsg(c, "无效的订阅ID")
		return
	}
	msg, err := model.AdminDeleteUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminPurgeUserSubscription permanently deletes a non-active user subscription row.
func AdminPurgeUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorMsg(c, "无效的订阅ID")
		return
	}
	msg, err := model.AdminPurgeUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminListSubscriptionOrders 管理员查看全平台订阅订单（分页 + 可选 trade_no 搜索 + status/payment_method 过滤）。
func AdminListSubscriptionOrders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	orders, total, err := model.GetAllSubscriptionOrders(pageInfo, c.Query("keyword"), c.Query("status"), c.Query("method"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

type AdminCompleteSubscriptionOrderRequest struct {
	TradeNo string `json:"trade_no"`
}

// AdminCompleteSubscriptionOrder 管理员补单订阅订单（pending → 已支付并创建/续期订阅）。
// 用于 epay 回调丢失/失败、或订阅购买卡单时的人工处置，与充值补单对齐。
func AdminCompleteSubscriptionOrder(c *gin.Context) {
	var req AdminCompleteSubscriptionOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	// 订单级互斥，防止并发补单。
	LockOrder(req.TradeNo)
	defer UnlockOrder(req.TradeNo)
	// 管理员补单不校验支付网关（ExpectedPaymentProvider 传空跳过校验），
	// ProviderPayload 覆盖为补单来源，便于追溯。
	payload := fmt.Sprintf("admin_complete:%s", c.ClientIP())
	if err := model.CompleteSubscriptionOrder(req.TradeNo, payload, "", ""); err != nil {
		common.ApiError(c, err)
		return
	}
	// 资金处置高危操作：补单留管理审计。
	recordManageAudit(c, "subscription.order_complete", map[string]interface{}{
		"trade_no": req.TradeNo,
	})
	common.ApiSuccess(c, nil)
}

// AdminRejectSubscriptionOrder 管理员关闭待支付订阅订单（pending → expired）。
// 用于无法完成的订单的人工收尾。非 pending 订单显式提示当前状态，避免"点了没反应"。
func AdminRejectSubscriptionOrder(c *gin.Context) {
	var req AdminCompleteSubscriptionOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	LockOrder(req.TradeNo)
	defer UnlockOrder(req.TradeNo)
	order := model.GetSubscriptionOrderByTradeNo(req.TradeNo)
	if order == nil {
		common.ApiErrorMsg(c, "订单不存在")
		return
	}
	if order.Status != common.TopUpStatusPending {
		common.ApiErrorMsg(c, fmt.Sprintf("订单当前状态为 %s，无需驳回", order.Status))
		return
	}
	if err := model.ExpireSubscriptionOrder(req.TradeNo, ""); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "subscription.order_reject", map[string]interface{}{
		"trade_no": req.TradeNo,
	})
	common.ApiSuccess(c, nil)
}
