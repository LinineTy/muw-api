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

// billingMergePage 在内存合并排序后的记录上按 pageInfo 取页。分页参数带下界防护：
// 负的 p / page_size 会得到负的 start 或 end < start，直接切片会 panic。
func billingMergePage(topups []*TopUp, subs []*SubscriptionOrder, planTitles map[int]string, pageInfo *common.PageInfo) ([]*BillingRecord, error) {
	merged := mergeBillingRecords(topups, subs, planTitles)
	start := pageInfo.GetStartIdx()
	if start < 0 {
		start = 0
	}
	if start > len(merged) {
		start = len(merged)
	}
	pageSize := pageInfo.GetPageSize()
	if pageSize < 1 {
		pageSize = common.ItemsPerPage
	}
	end := start + pageSize
	if end > len(merged) {
		end = len(merged)
	}
	if end < start {
		end = start
	}
	return merged[start:end], nil
}

// GetUserBillingRecords 合并查询某用户的充值记录 + 订阅订单（30 天窗口，与充值记录一致），
// 按 create_time 倒序分页。typ 为空查两者，否则只查对应类型。每张表的 Find 用
// LIMIT 截到当前页的结束偏移（start+pageSize）：合并排序后当前页的记录必然落在各表
// 各自的该偏移内，无需把整表拉进内存；两表查询包在同一个只读事务里，total 与 items
// 不会因并发写入而错位。
func GetUserBillingRecords(userId int, pageInfo *common.PageInfo, keyword, status, method, typ string) (records []*BillingRecord, total int64, err error) {
	cutoff := topUpQueryCutoff()
	start := pageInfo.GetStartIdx()
	if start < 0 {
		start = 0
	}
	pageSize := pageInfo.GetPageSize()
	if pageSize < 1 {
		pageSize = common.ItemsPerPage
	}
	limit := start + pageSize
	var topups []*TopUp
	var subs []*SubscriptionOrder
	var topupTotal, subTotal int64

	err = DB.Transaction(func(tx *gorm.DB) error {
		if typ == "" || typ == "topup" {
			topupQuery, qerr := billingQueryFilter(
				tx.Model(&TopUp{}).Where("user_id = ? AND create_time >= ?", userId, cutoff),
				keyword, status, method,
			)
			if qerr != nil {
				return qerr
			}
			if err = topupQuery.Count(&topupTotal).Error; err != nil {
				return err
			}
			if err = topupQuery.Order("create_time desc").Limit(limit).Find(&topups).Error; err != nil {
				return err
			}
		}
		if typ == "" || typ == "subscription" {
			subQuery, qerr := billingQueryFilter(
				tx.Model(&SubscriptionOrder{}).Where("user_id = ? AND create_time >= ?", userId, cutoff),
				keyword, status, method,
			)
			if qerr != nil {
				return qerr
			}
			if err = subQuery.Count(&subTotal).Error; err != nil {
				return err
			}
			if err = subQuery.Order("create_time desc").Limit(limit).Find(&subs).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, 0, err
	}

	total = topupTotal + subTotal
	records, err = billingMergePage(topups, subs, resolvePlanTitles(collectSubscriptionPlanIds(subs)), pageInfo)
	return records, total, err
}

// GetAllBillingRecords 管理员合并查询全平台充值记录 + 订阅订单（不限制时间窗口）。
// typ 为空查两者，否则只查对应类型。同样按页偏移限量拉取并包只读事务，避免每请求
// 全表加载。
func GetAllBillingRecords(pageInfo *common.PageInfo, keyword, status, method, typ string) (records []*BillingRecord, total int64, err error) {
	start := pageInfo.GetStartIdx()
	if start < 0 {
		start = 0
	}
	pageSize := pageInfo.GetPageSize()
	if pageSize < 1 {
		pageSize = common.ItemsPerPage
	}
	limit := start + pageSize
	var topups []*TopUp
	var subs []*SubscriptionOrder
	var topupTotal, subTotal int64

	err = DB.Transaction(func(tx *gorm.DB) error {
		if typ == "" || typ == "topup" {
			topupQuery, qerr := billingQueryFilter(tx.Model(&TopUp{}), keyword, status, method)
			if qerr != nil {
				return qerr
			}
			if err = topupQuery.Count(&topupTotal).Error; err != nil {
				return err
			}
			if err = topupQuery.Order("create_time desc").Limit(limit).Find(&topups).Error; err != nil {
				return err
			}
		}
		if typ == "" || typ == "subscription" {
			subQuery, qerr := billingQueryFilter(tx.Model(&SubscriptionOrder{}), keyword, status, method)
			if qerr != nil {
				return qerr
			}
			if err = subQuery.Count(&subTotal).Error; err != nil {
				return err
			}
			if err = subQuery.Order("create_time desc").Limit(limit).Find(&subs).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, 0, err
	}

	total = topupTotal + subTotal
	records, err = billingMergePage(topups, subs, resolvePlanTitles(collectSubscriptionPlanIds(subs)), pageInfo)
	return records, total, err
}
