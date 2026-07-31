/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// ---- 用户端 ----

// GetQuotaPools 获取已启用的额度池列表 + 当前用户领取状态
func GetQuotaPools(c *gin.Context) {
	if !operation_setting.IsQuotaPoolEnabled() {
		common.ApiErrorMsg(c, "额度池功能未启用")
		return
	}
	userId := c.GetInt("id")
	pools, err := model.GetEnabledQuotaPools()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]gin.H, 0, len(pools))
	for _, p := range pools {
		status, sErr := model.GetQuotaPoolClaimStatus(userId, &p)
		if sErr != nil {
			common.ApiError(c, sErr)
			return
		}
		result = append(result, gin.H{
			"id":          p.Id,
			"name":        p.Name,
			"description": p.Description,
			"amount_type": p.AmountType,
			"amount":      p.Amount,
			"min_amount":  p.MinAmount,
			"max_amount":  p.MaxAmount,
			"period":      p.Period,
			"balance_mode":   p.BalanceMode,
			"balance_limit":  p.BalanceLimit,
			"pool_period_cap": p.PoolPeriodCap,
			"user_period_cap": p.UserPeriodCap,
			"user_period_count_limit": p.UserPeriodCountLimit,
			"time_rule":      p.TimeRule,
			"status":         status,
		})
	}
	common.ApiSuccess(c, result)
}

// ClaimQuotaPool 用户从额度池领取
func ClaimQuotaPool(c *gin.Context) {
	if !operation_setting.IsQuotaPoolEnabled() {
		common.ApiErrorMsg(c, "额度池功能未启用")
		return
	}
	userId := c.GetInt("id")
	poolId, err := strconv.Atoi(c.Param("id"))
	if err != nil || poolId <= 0 {
		common.ApiErrorMsg(c, "无效的池 ID")
		return
	}

	record, err := model.UserClaimPoolQuota(userId, poolId)
	if err != nil {
		common.ApiErrorMsg(c, quotaPoolErrMessage(err))
		return
	}
	common.ApiSuccess(c, gin.H{
		"quota": record.Quota,
	})
}

// ---- 管理端 ----

func AdminGetQuotaPools(c *gin.Context) {
	pools, err := model.GetAllQuotaPools()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, pools)
}

type QuotaPoolRequest struct {
	Name                 string `json:"name"`
	Description          string `json:"description"`
	Enabled              bool   `json:"enabled"`
	Period               string `json:"period"`
	AmountType           string `json:"amount_type"`
	Amount               int    `json:"amount"`
	MinAmount            int    `json:"min_amount"`
	MaxAmount            int    `json:"max_amount"`
	TimeRule             string `json:"time_rule"`
	PoolPeriodCap        int    `json:"pool_period_cap"`
	UserPeriodCap        int    `json:"user_period_cap"`
	BalanceMode          string `json:"balance_mode"`
	BalanceLimit         int    `json:"balance_limit"`
	UserPeriodCountLimit int    `json:"user_period_count_limit"`
}

func (req *QuotaPoolRequest) validate() (string, bool) {
	if req.Name == "" {
		return "池名称不能为空", false
	}
	if req.Period != model.QuotaPoolPeriodDaily &&
		req.Period != model.QuotaPoolPeriodWeekly &&
		req.Period != model.QuotaPoolPeriodMonthly {
		return "周期必须为 daily/weekly/monthly", false
	}
	if req.AmountType != model.QuotaPoolAmountFixed &&
		req.AmountType != model.QuotaPoolAmountRandom {
		return "发放模式必须为 fixed/random", false
	}
	// 所有额度/上限字段必须落在 [0, MaxQuota] 内，防止 int32 额度列溢出变成负数
	amountFields := []struct {
		name  string
		value int
	}{
		{"固定额度", req.Amount},
		{"随机下限", req.MinAmount},
		{"随机上限", req.MaxAmount},
		{"全池周期上限", req.PoolPeriodCap},
		{"单用户周期上限", req.UserPeriodCap},
		{"余额门槛", req.BalanceLimit},
		{"领取次数上限", req.UserPeriodCountLimit},
	}
	for _, f := range amountFields {
		if f.value < 0 || f.value > common.MaxQuota {
			return f.name + "超出允许范围", false
		}
	}
	if req.AmountType == model.QuotaPoolAmountRandom && req.MaxAmount < req.MinAmount {
		return "随机额度区间不合法", false
	}
	if req.BalanceMode != model.QuotaPoolBalanceOff &&
		req.BalanceMode != model.QuotaPoolBalanceBelow &&
		req.BalanceMode != model.QuotaPoolBalanceAbove {
		return "余额模式必须为 off/below/above", false
	}
	return "", true
}

func AdminCreateQuotaPool(c *gin.Context) {
	var req QuotaPoolRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if msg, ok := req.validate(); !ok {
		common.ApiErrorMsg(c, msg)
		return
	}
	pool := &model.QuotaPool{
		Name:                 req.Name,
		Description:          req.Description,
		Enabled:              req.Enabled,
		Period:               req.Period,
		AmountType:           req.AmountType,
		Amount:               req.Amount,
		MinAmount:            req.MinAmount,
		MaxAmount:            req.MaxAmount,
		TimeRule:             req.TimeRule,
		PoolPeriodCap:        req.PoolPeriodCap,
		UserPeriodCap:        req.UserPeriodCap,
		BalanceMode:          req.BalanceMode,
		BalanceLimit:         req.BalanceLimit,
		UserPeriodCountLimit: req.UserPeriodCountLimit,
	}
	if err := model.CreateQuotaPool(pool); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, pool)
}

func AdminUpdateQuotaPool(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的池 ID")
		return
	}
	pool, err := model.GetQuotaPool(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req QuotaPoolRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if msg, ok := req.validate(); !ok {
		common.ApiErrorMsg(c, msg)
		return
	}
	pool.Name = req.Name
	pool.Description = req.Description
	pool.Enabled = req.Enabled
	pool.Period = req.Period
	pool.AmountType = req.AmountType
	pool.Amount = req.Amount
	pool.MinAmount = req.MinAmount
	pool.MaxAmount = req.MaxAmount
	pool.TimeRule = req.TimeRule
	pool.PoolPeriodCap = req.PoolPeriodCap
	pool.UserPeriodCap = req.UserPeriodCap
	pool.BalanceMode = req.BalanceMode
	pool.BalanceLimit = req.BalanceLimit
	pool.UserPeriodCountLimit = req.UserPeriodCountLimit
	if err := model.UpdateQuotaPool(pool); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, pool)
}

func AdminToggleQuotaPool(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的池 ID")
		return
	}
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	pool, err := model.GetQuotaPool(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pool.Enabled = req.Enabled
	if err := model.UpdateQuotaPool(pool); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminDeleteQuotaPool(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的池 ID")
		return
	}
	if err := model.DeleteQuotaPool(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminGetQuotaPoolRecords(c *gin.Context) {
	poolId, err := strconv.Atoi(c.Param("id"))
	if err != nil || poolId <= 0 {
		common.ApiErrorMsg(c, "无效的池 ID")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	records, total, err := model.GetQuotaPoolRecords(poolId, (page-1)*size, size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":     records,
		"total":     total,
		"page":      page,
		"page_size": size,
	})
}

func quotaPoolErrMessage(err error) string {
	switch {
	case errors.Is(err, model.ErrQuotaPoolNotFound):
		return "额度池不存在"
	case errors.Is(err, model.ErrQuotaPoolDisabled):
		return "额度池已停用"
	case errors.Is(err, model.ErrQuotaPoolTimeRestricted):
		return "当前不在可领取时间段"
	case errors.Is(err, model.ErrQuotaPoolPoolCapReached):
		return "本周期该池额度已发放完"
	case errors.Is(err, model.ErrQuotaPoolUserCapReached):
		return "已达本周期个人领取上限"
	case errors.Is(err, model.ErrQuotaPoolBalanceNotAllowed):
		return "当前余额不满足领取条件"
	case errors.Is(err, model.ErrQuotaPoolCountLimitReached):
		return "已达本周期领取次数上限"
	default:
		return "领取失败"
	}
}
