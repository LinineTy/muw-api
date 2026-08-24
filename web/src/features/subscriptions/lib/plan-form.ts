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
import type { TFunction } from 'i18next'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import type { SubscriptionPlan, PlanPayload } from '../types'

export function getPlanFormSchema(t: TFunction) {
  return z.object({
    title: z.string().min(1, t('Please enter plan title')),
    subtitle: z.string().optional(),
    price_amount: z.coerce.number().min(0, t('Please enter amount')),
    duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
    duration_value: z.coerce.number().min(1),
    custom_seconds: z.coerce.number().min(0).optional(),
    max_cumulative_days: z.coerce.number().min(0),
    exclusive_group: z.string().optional(),
    allowed_groups: z.array(z.string()).optional(),
    priority: z.coerce.number().min(0),
    enabled: z.boolean(),
    sort_order: z.coerce.number(),
    is_recommended: z.boolean(),
    allow_balance_pay: z.boolean(),
    allow_wallet_overflow: z.boolean(),
    max_purchase_per_user: z.coerce.number().min(0),
    upgrade_group: z.string().optional(),
    downgrade_group: z.string().optional(),
    // 动态窗口是唯一额度模型：列表必须非空（doSubmit 拦截空列表）；全部窗口额度为 0 =
    // 无限额度（合法，展示为 Unlimited）。
    reset_windows: z
      .array(
        z.object({
          // 表单内稳定行 key（创建时生成、编辑期间不变）；不落库，序列化时剥掉。
          id: z.string(),
          unit: z.enum(['hour', 'day', 'week', 'month']),
          value: z.coerce.number().min(1),
          limit: z.coerce.number().min(0),
        })
      )
      .superRefine((rows, ctx) => {
        // 严格递增：后一个窗口时长必须大于前一个，保证列表天然按时长升序。
        let prev = -1
        for (const row of rows) {
          const secs = windowRowDurationSeconds(row)
          if (secs <= prev) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t(
                'Windows must be ordered by duration: each window must be strictly longer than the previous one.'
              ),
            })
            break
          }
          prev = secs
        }
      }),
  })
}

export type PlanFormValues = z.infer<ReturnType<typeof getPlanFormSchema>>

function parseAllowedGroups(raw?: string): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((g): g is string => typeof g === 'string')
      : []
  } catch {
    return []
  }
}

export const PLAN_FORM_DEFAULTS: PlanFormValues = {
  title: '',
  subtitle: '',
  price_amount: 0,
  duration_unit: 'month',
  duration_value: 1,
  custom_seconds: 0,
  max_cumulative_days: 0,
  exclusive_group: '',
  allowed_groups: [],
  priority: 0,
  enabled: true,
  sort_order: 0,
  is_recommended: false,
  allow_balance_pay: true,
  allow_wallet_overflow: true,
  max_purchase_per_user: 0,
  upgrade_group: '',
  downgrade_group: '',
  reset_windows: [],
}

export function planToFormValues(plan: SubscriptionPlan): PlanFormValues {
  return {
    title: plan.title || '',
    subtitle: plan.subtitle || '',
    price_amount: Number(plan.price_amount || 0),
    duration_unit: plan.duration_unit || 'month',
    duration_value: Number(plan.duration_value || 1),
    custom_seconds: Number(plan.custom_seconds || 0),
    max_cumulative_days: Math.round(Number(plan.max_cumulative_seconds || 0) / 86400),
    exclusive_group: plan.exclusive_group || '',
    allowed_groups: parseAllowedGroups(plan.allowed_groups),
    priority: Number(plan.priority || 0),
    enabled: plan.enabled !== false,
    sort_order: Number(plan.sort_order || 0),
    is_recommended: plan.is_recommended === true,
    allow_balance_pay: plan.allow_balance_pay !== false,
    allow_wallet_overflow: plan.allow_wallet_overflow !== false,
    max_purchase_per_user: Number(plan.max_purchase_per_user || 0),
    upgrade_group: plan.upgrade_group || '',
    downgrade_group: plan.downgrade_group || '',
    // 动态窗口：limit 走额度→美元换算。
    reset_windows: parseResetWindowsRaw(plan.reset_windows).map((w) => ({
      ...w,
      limit: quotaUnitsToDollars(Number(w.limit || 0)),
    })),
  }
}

export function formValuesToPlanPayload(values: PlanFormValues): PlanPayload {
  // reset_windows 是表单专用字段，按动态窗口模型序列化后落库。
  const { reset_windows: resetWindows, ...rest } = values
  return {
    plan: {
      ...rest,
      price_amount: Number(values.price_amount || 0),
      currency: 'USD',
      duration_value: Number(values.duration_value || 0),
      custom_seconds: Number(values.custom_seconds || 0),
      max_cumulative_seconds: Math.round(Number(values.max_cumulative_days || 0)) * 86400,
      exclusive_group: values.exclusive_group?.trim() || '',
      // 空选择序列化为空串（而非 "[]"），保持「空 = 全部组允许」的后端语义。
      allowed_groups:
        values.allowed_groups && values.allowed_groups.length > 0
          ? JSON.stringify(values.allowed_groups)
          : '',
      priority: Number(values.priority || 0),
      sort_order: Number(values.sort_order || 0),
      max_purchase_per_user: Number(values.max_purchase_per_user || 0),
      upgrade_group: values.upgrade_group || '',
      downgrade_group: values.downgrade_group || '',
      // 动态窗口：limit 走美元→额度换算。空列表由 doSubmit 拦截，不会走到这里。
      // 显式只取 unit/value/limit，剥掉表单内稳定 id（不落库）。
      reset_windows: JSON.stringify(
        (resetWindows || []).map(({ unit, value, limit }) => ({
          unit,
          value,
          limit: parseQuotaFromDollars(Number(limit || 0)),
        }))
      ),
    },
  }
}

// 表单里的动态窗口行（limit 为美元显示单位，落库时换算回额度）。id 是表单内稳定行
// key：创建时生成、编辑期间不变，作为 React 行 key 避免"每次按键重挂载导致输入框失焦"。
export interface ResetWindowFormRow {
  id: string
  unit: 'hour' | 'day' | 'week' | 'month'
  value: number
  limit: number
}

// 解析后端 wire 格式的 reset_windows（JSON 数组文本）；为每行补一个表单内稳定 id。
export function parseResetWindowsRaw(raw: string): ResetWindowFormRow[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as ResetWindowFormRow[]
    return Array.isArray(parsed)
      ? parsed.map((w) => ({ ...w, id: w.id || nanoid() }))
      : []
  } catch {
    return []
  }
}

// resetWindowsRawEqual 语义比较两份 reset_windows 原始文本是否表示相同窗口列表
// （unit/value/limit 逐项，limit 为额度整数）。配合后端 ResetWindowsEqual，避免因
// 重新序列化的键序/浮点往返差异，把"只改标题"误判成窗口变化而弹「改动即重置」确认。
export function resetWindowsRawEqual(a: string, b: string): boolean {
  if (!a && !b) return true
  try {
    const pa = a ? JSON.parse(a) : []
    const pb = b ? JSON.parse(b) : []
    if (!Array.isArray(pa) || !Array.isArray(pb)) return a === b
    if (pa.length !== pb.length) return false
    return pa.every(
      (wa: ResetWindowFormRow, i: number) =>
        wa.unit === pb[i].unit &&
        Number(wa.value) === Number(pb[i].value) &&
        Number(wa.limit) === Number(pb[i].limit)
    )
  } catch {
    return a === b
  }
}

// 窗口行时长 → 秒（前端估算，月按 30 天，与 planDurationSeconds 一致）。
export function windowRowDurationSeconds(row: { unit?: string; value?: number }): number {
  const v = Number(row?.value || 0)
  switch (row?.unit) {
    case 'month':
      return v * 30 * 86400
    case 'week':
      return v * 7 * 86400
    case 'day':
      return v * 86400
    case 'hour':
      return v * 3600
    default:
      return 0
  }
}

// 套餐有效期 → 秒（前端估算，用于"窗口 ≥ 有效期 = 封顶上限"软提示）。
export function planValiditySeconds(values: {
  duration_unit?: string
  duration_value?: number
  custom_seconds?: number
}): number {
  const v = Number(values.duration_value || 0)
  switch (values.duration_unit) {
    case 'year':
      return v * 365 * 86400
    case 'month':
      return v * 30 * 86400
    case 'day':
      return v * 86400
    case 'hour':
      return v * 3600
    case 'custom':
      return Number(values.custom_seconds || 0)
    default:
      return v * 30 * 86400
  }
}
