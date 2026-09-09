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
import type { GroupPinProduct, PlanRecord } from '../types'
import { PLAN_FORM_DEFAULTS, parseAllowedGroups, type PlanFormValues } from './plan-form'

// 固定分组商品（独立表 group_pin_products）与订阅套餐共用同一张表/卡片/抽屉，
// 这里集中做两边的形状转换：商品 → 行模型（管理端表）、商品 → 表单值、表单值 → 商品。

// 商品行模型：无时长/额度/互斥组，这些字段填零值即可 —— 相关列与卡片字段在
// kind === 'group_pin' 时按 kind 分支渲染，不会显示这些零值。
export function planRecordFromGroupPinProduct(
  product: GroupPinProduct
): PlanRecord {
  return {
    kind: 'group_pin',
    groupPin: product,
    plan: {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle,
      price_amount: Number(product.price_amount || 0),
      currency: 'USD',
      duration_unit: 'month',
      duration_value: 0,
      max_cumulative_seconds: 0,
      exclusive_group: '',
      allowed_groups: product.allowed_groups || '',
      enabled: product.enabled !== false,
      sort_order: Number(product.sort_order || 0),
      is_recommended: product.is_recommended === true,
      priority: 0,
      allow_balance_pay: product.allow_balance_pay !== false,
      allow_wallet_overflow: false,
      max_purchase_per_user: 0,
      // 目标固定分组由 upgrade_group 承载（商品没有独立的 group 表单字段）。
      upgrade_group: product.group || '',
      downgrade_group: '',
      reset_windows: '',
    },
  }
}

// 商品 → 套餐表单值：只填商品面上存在的字段，其余保持套餐默认值（商品模式下不渲染）。
export function groupPinToFormValues(
  product: GroupPinProduct
): PlanFormValues {
  return {
    ...PLAN_FORM_DEFAULTS,
    title: product.title || '',
    subtitle: product.subtitle || '',
    price_amount: Number(product.price_amount || 0),
    sort_order: Number(product.sort_order || 0),
    allowed_groups: parseAllowedGroups(product.allowed_groups),
    is_recommended: product.is_recommended === true,
    allow_balance_pay: product.allow_balance_pay !== false,
    enabled: product.enabled !== false,
    upgrade_group: product.group || '',
  }
}

// 套餐表单值 → 商品请求体：显式只取商品面字段（不能复用 formValuesToPlanPayload，
// 否则 duration/reset_windows 等套餐字段会被塞进商品请求）。enabled 必须显式提交，
// 后端缺省为 true，省略就永远关不掉。
export function planValuesToGroupPinPayload(
  values: PlanFormValues,
  id?: number
): GroupPinProduct {
  return {
    id: id ?? 0,
    title: values.title.trim(),
    subtitle: values.subtitle || '',
    group: (values.upgrade_group || '').trim(),
    price_amount: Number(values.price_amount || 0),
    enabled: values.enabled,
    is_recommended: values.is_recommended,
    allow_balance_pay: values.allow_balance_pay,
    sort_order: Number(values.sort_order || 0),
    allowed_groups:
      values.allowed_groups && values.allowed_groups.length > 0
        ? JSON.stringify(values.allowed_groups)
        : '',
  }
}
