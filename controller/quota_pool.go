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
	"fmt"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetQuotaPoolStatus 获取单池配置 + 当前用户周期领取状态 + 生命周期累计
func GetQuotaPoolStatus(c *gin.Context) {
	if !operation_setting.IsQuotaPoolEnabled() {
		common.ApiErrorMsg(c, "额度池功能未启用")
		return
	}
	userId := c.GetInt("id")
	s := operation_setting.GetQuotaPoolSetting()
	status, err := model.GetQuotaClaimStatus(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"enabled":                 s.Enabled,
		"pool_period":             s.PoolPeriod,
		"user_period":             s.UserPeriod,
		"amount_type":             s.AmountType,
		"amount":                  s.Amount,
		"min_amount":              s.MinAmount,
		"max_amount":              s.MaxAmount,
		"pool_period_cap":         s.PoolPeriodCap,
		"user_period_cap":         s.UserPeriodCap,
		"user_period_count_limit": s.UserPeriodCountLimit,
		"time_rule":               s.TimeRule,
		"balance_mode":            s.BalanceMode,
		"balance_limit":           s.BalanceLimit,
		"status":                  status,
	})
}

// GetQuotaPoolRecords 获取用户某月按天聚合的领取/打卡记录（日历视图用）
func GetQuotaPoolRecords(c *gin.Context) {
	if !operation_setting.IsQuotaPoolEnabled() {
		common.ApiErrorMsg(c, "额度池功能未启用")
		return
	}
	userId := c.GetInt("id")
	month := c.DefaultQuery("month", time.Now().Format("2006-01"))
	start, err := time.ParseInLocation("2006-01", month, time.Local)
	if err != nil {
		common.ApiErrorMsg(c, "无效的月份")
		return
	}
	startTs := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.Local).Unix()
	endTs := time.Date(start.Year(), start.Month()+1, 1, 0, 0, 0, 0, time.Local).Unix()

	records, err := model.GetUserQuotaClaimRecords(userId, startTs, endTs)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	type dayAgg struct {
		Count        int
		Quota        int
		CheckinCount int
	}
	byDate := make(map[string]*dayAgg)
	for _, r := range records {
		date := time.Unix(r.ClaimedAt, 0).Format("2006-01-02")
		agg := byDate[date]
		if agg == nil {
			agg = &dayAgg{}
			byDate[date] = agg
		}
		if r.Kind == model.QuotaRecordKindCheckin {
			agg.CheckinCount++
		} else {
			agg.Count++
			agg.Quota += r.Quota
		}
	}

	result := make([]gin.H, 0, len(byDate))
	for date, agg := range byDate {
		result = append(result, gin.H{
			"date":          date,
			"count":         agg.Count,
			"quota":         agg.Quota,
			"checkin_count": agg.CheckinCount,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i]["date"].(string) < result[j]["date"].(string)
	})
	common.ApiSuccess(c, gin.H{
		"month":   month,
		"records": result,
	})
}

// ClaimQuotaPool 用户从额度池领取
func ClaimQuotaPool(c *gin.Context) {
	if !operation_setting.IsQuotaPoolEnabled() {
		common.ApiErrorMsg(c, "额度池功能未启用")
		return
	}
	userId := c.GetInt("id")
	record, err := model.ClaimQuota(userId)
	if err != nil {
		common.ApiErrorMsg(c, quotaPoolErrMessage(err))
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("从额度池领取 %s", logger.LogQuota(record.Quota)))
	common.ApiSuccess(c, gin.H{
		"quota": record.Quota,
	})
}

// QuotaCheckIn 用户打卡（不发额度，只记录）
func QuotaCheckIn(c *gin.Context) {
	if !operation_setting.IsQuotaPoolEnabled() {
		common.ApiErrorMsg(c, "额度池功能未启用")
		return
	}
	userId := c.GetInt("id")
	record, err := model.CheckInQuota(userId)
	if err != nil {
		common.ApiErrorMsg(c, quotaPoolErrMessage(err))
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, "额度池打卡成功")
	common.ApiSuccess(c, gin.H{
		"checked_in_at": record.ClaimedAt,
	})
}

func quotaPoolErrMessage(err error) string {
	switch {
	case errors.Is(err, model.ErrQuotaPoolDisabled):
		return "额度池未启用"
	case errors.Is(err, model.ErrQuotaPoolTimeRestricted):
		return "当前不在可领取时间段"
	case errors.Is(err, model.ErrQuotaPoolPoolCapReached):
		return "本周期全站额度已发放完"
	case errors.Is(err, model.ErrQuotaPoolUserCapReached):
		return "已达本周期个人领取上限"
	case errors.Is(err, model.ErrQuotaPoolBalanceNotAllowed):
		return "当前余额不满足领取条件"
	case errors.Is(err, model.ErrQuotaPoolCountLimitReached):
		return "已达本周期领取次数上限"
	case errors.Is(err, model.ErrQuotaCheckinAlreadyToday):
		return "今天已打卡"
	default:
		return "操作失败"
	}
}
