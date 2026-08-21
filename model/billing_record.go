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
package model

import (
	"sort"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// BillingRecord 订单中心「充值记录」合并行：充值记录与订阅订单的统一视图。
// 充值记录 id 保持正数、订阅订单 id 取负，保证两表自增 id 不冲突（前端行 key 唯一）。
type BillingRecord struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id"`
	Type            string  `json:"type"` // topup / subscription
	Amount          int64   `json:"amount"`
	PlanId          int     `json:"plan_id"`
	PlanTitle       string  `json:"plan_title"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no"`
	PaymentMethod   string  `json:"payment_method"`
	PaymentProvider string  `json:"payment_provider"`
	Status          string  `json:"status"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time"`
}

// billingQueryFilter 套用订单状态/支付方式过滤，可选的按 trade_no 关键字搜索。
func billingQueryFilter(query *gorm.DB, keyword, status, method string) (*gorm.DB, error) {
	query = applyOrderStatusMethodFilter(query, status, method)
	if keyword != "" {
		pattern, perr := tradeNoLikePattern(keyword)
		if perr != nil {
			return nil, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}
	return query, nil
}

// resolvePlanTitles 批量查询订阅套餐标题（停售/被删套餐回退为空，由前端兜底 #id）。
func resolvePlanTitles(planIds map[int]struct{}) map[int]string {
	if len(planIds) == 0 {
		return nil
	}
	ids := make([]int, 0, len(planIds))
	for id := range planIds {
		ids = append(ids, id)
	}
	var plans []SubscriptionPlan
	if err := DB.Where("id IN ?", ids).Find(&plans).Error; err != nil {
		return nil
	}
	titles := make(map[int]string, len(plans))
	for _, p := range plans {
		titles[p.Id] = p.Title
	}
	return titles
}

// mergeBillingRecords 充值记录与订阅订单合并为统一视图，按 create_time 倒序。
func mergeBillingRecords(topups []*TopUp, subs []*SubscriptionOrder, planTitles map[int]string) []*BillingRecord {
	merged := make([]*BillingRecord, 0, len(topups)+len(subs))
	for _, t := range topups {
		merged = append(merged, &BillingRecord{
			Id:              t.Id,
			UserId:          t.UserId,
			Type:            "topup",
			Amount:          t.Amount,
			Money:           t.Money,
			TradeNo:         t.TradeNo,
			PaymentMethod:   t.PaymentMethod,
			PaymentProvider: t.PaymentProvider,
			Status:          t.Status,
			CreateTime:      t.CreateTime,
			CompleteTime:    t.CompleteTime,
		})
	}
	for _, s := range subs {
		merged = append(merged, &BillingRecord{
			Id:              -s.Id,
			UserId:          s.UserId,
			Type:            "subscription",
			PlanId:          s.PlanId,
			PlanTitle:       planTitles[s.PlanId],
			Money:           s.Money,
			TradeNo:         s.TradeNo,
			PaymentMethod:   s.PaymentMethod,
			PaymentProvider: s.PaymentProvider,
			Status:          s.Status,
			CreateTime:      s.CreateTime,
			CompleteTime:    s.CompleteTime,
		})
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].CreateTime > merged[j].CreateTime })
	return merged
}

// collectSubscriptionPlanIds 汇总订阅订单里涉及的套餐 id，供标题批量解析。
func collectSubscriptionPlanIds(subs []*SubscriptionOrder) map[int]struct{} {
	ids := make(map[int]struct{}, len(subs))
	for _, s := range subs {
		if s.PlanId > 0 {
			ids[s.PlanId] = struct{}{}
		}
	}
	return ids
}

// GetUserBillingRecords 合并查询某用户的充值记录 + 订阅订单（30 天窗口，与充值记录一致），
// 按 create_time 倒序分页。typ 为空查两者，否则只查对应类型。过滤后记录量级可控，
// 拉全量后内存合并排序分页，避免 UNION 的跨库方言差异。
func GetUserBillingRecords(userId int, pageInfo *common.PageInfo, keyword, status, method, typ string) (records []*BillingRecord, total int64, err error) {
	cutoff := topUpQueryCutoff()
	var topups []*TopUp
	var subs []*SubscriptionOrder
	var topupTotal, subTotal int64

	if typ == "" || typ == "topup" {
		topupQuery, qerr := billingQueryFilter(
			DB.Model(&TopUp{}).Where("user_id = ? AND create_time >= ?", userId, cutoff),
			keyword, status, method,
		)
		if qerr != nil {
			return nil, 0, qerr
		}
		if err = topupQuery.Count(&topupTotal).Error; err != nil {
			return nil, 0, err
		}
		if err = topupQuery.Order("create_time desc").Find(&topups).Error; err != nil {
			return nil, 0, err
		}
	}
	if typ == "" || typ == "subscription" {
		subQuery, qerr := billingQueryFilter(
			DB.Model(&SubscriptionOrder{}).Where("user_id = ? AND create_time >= ?", userId, cutoff),
			keyword, status, method,
		)
		if qerr != nil {
			return nil, 0, qerr
		}
		if err = subQuery.Count(&subTotal).Error; err != nil {
			return nil, 0, err
		}
		if err = subQuery.Order("create_time desc").Find(&subs).Error; err != nil {
			return nil, 0, err
		}
	}

	merged := mergeBillingRecords(topups, subs, resolvePlanTitles(collectSubscriptionPlanIds(subs)))
	total = topupTotal + subTotal
	start := pageInfo.GetStartIdx()
	if start > len(merged) {
		start = len(merged)
	}
	end := start + pageInfo.GetPageSize()
	if end > len(merged) {
		end = len(merged)
	}
	return merged[start:end], total, nil
}

// GetAllBillingRecords 管理员合并查询全平台充值记录 + 订阅订单（不限制时间窗口）。
// typ 为空查两者，否则只查对应类型。
func GetAllBillingRecords(pageInfo *common.PageInfo, keyword, status, method, typ string) (records []*BillingRecord, total int64, err error) {
	var topups []*TopUp
	var subs []*SubscriptionOrder
	var topupTotal, subTotal int64

	if typ == "" || typ == "topup" {
		topupQuery, qerr := billingQueryFilter(DB.Model(&TopUp{}), keyword, status, method)
		if qerr != nil {
			return nil, 0, qerr
		}
		if err = topupQuery.Count(&topupTotal).Error; err != nil {
			return nil, 0, err
		}
		if err = topupQuery.Order("create_time desc").Find(&topups).Error; err != nil {
			return nil, 0, err
		}
	}
	if typ == "" || typ == "subscription" {
		subQuery, qerr := billingQueryFilter(DB.Model(&SubscriptionOrder{}), keyword, status, method)
		if qerr != nil {
			return nil, 0, qerr
		}
		if err = subQuery.Count(&subTotal).Error; err != nil {
			return nil, 0, err
		}
		if err = subQuery.Order("create_time desc").Find(&subs).Error; err != nil {
			return nil, 0, err
		}
	}

	merged := mergeBillingRecords(topups, subs, resolvePlanTitles(collectSubscriptionPlanIds(subs)))
	total = topupTotal + subTotal
	start := pageInfo.GetStartIdx()
	if start > len(merged) {
		start = len(merged)
	}
	end := start + pageInfo.GetPageSize()
	if end > len(merged) {
		end = len(merged)
	}
	return merged[start:end], total, nil
}
