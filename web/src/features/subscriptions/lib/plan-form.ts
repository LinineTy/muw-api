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
    quota_reset_period: z.enum([
      'never',
      'daily',
      'weekly',
      'monthly',
      'custom',
    ]),
    quota_reset_custom_seconds: z.coerce.number().min(0).optional(),
    reset_amount_limit: z.coerce.number().min(0),
    weekly_amount_limit: z.coerce.number().min(0),
    monthly_amount_limit: z.coerce.number().min(0),
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
    total_amount: z.coerce.number().min(0),
    upgrade_group: z.string().optional(),
    downgrade_group: z.string().optional(),
    // 额度模型：legacy = 经典周期/周/月上限；windows = 动态重置窗口列表。
    quota_model: z.enum(['legacy', 'windows']),
    reset_windows: z
      .array(
        z.object({
          unit: z.enum(['hour', 'day', 'week', 'month']),
          value: z.coerce.number().min(1),
          limit: z.coerce.number().min(0),
        })
      )
      .superRefine((rows, ctx) => {
        // 全部窗口额度为 0 = 无上限，等价 legacy 无限额度——拒绝（提交时按 quota_model
        // 再拦空列表，这里只处理非空但全 0 的配置陷阱）。
        if (
          rows.length > 0 &&
          rows.every((r) => (Number(r.limit) || 0) <= 0)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t(
              'At least one window must have a quota greater than 0.'
            ),
          })
          return
        }
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
  quota_reset_period: 'never',
  quota_reset_custom_seconds: 0,
  reset_amount_limit: 0,
  weekly_amount_limit: 0,
  monthly_amount_limit: 0,
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
  total_amount: 0,
  upgrade_group: '',
  downgrade_group: '',
  quota_model: 'legacy',
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
    quota_reset_period: plan.quota_reset_period || 'never',
    quota_reset_custom_seconds: Number(plan.quota_reset_custom_seconds || 0),
    reset_amount_limit: quotaUnitsToDollars(Number(plan.reset_amount_limit || 0)),
    weekly_amount_limit: quotaUnitsToDollars(Number(plan.weekly_amount_limit || 0)),
    monthly_amount_limit: quotaUnitsToDollars(Number(plan.monthly_amount_limit || 0)),
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
    total_amount: quotaUnitsToDollars(Number(plan.total_amount || 0)),
    upgrade_group: plan.upgrade_group || '',
    downgrade_group: plan.downgrade_group || '',
    // 动态窗口：limit 走额度→美元换算（与其它上限字段一致）；非动态套餐显示经典模型。
    quota_model: plan.reset_windows ? 'windows' : 'legacy',
    reset_windows: plan.reset_windows
      ? parseResetWindowsRaw(plan.reset_windows).map((w) => ({
          ...w,
          limit: quotaUnitsToDollars(Number(w.limit || 0)),
        }))
      : [],
  }
}

export function formValuesToPlanPayload(values: PlanFormValues): PlanPayload {
  // quota_model / reset_windows 是表单专用字段，不直接进套餐载荷；按额度模型决定落库。
  const { quota_model: quotaModel, reset_windows: resetWindows, ...rest } = values
  const isWindows = quotaModel === 'windows'
  return {
    plan: {
      ...rest,
      price_amount: Number(values.price_amount || 0),
      currency: 'USD',
      duration_value: Number(values.duration_value || 0),
      custom_seconds: Number(values.custom_seconds || 0),
      quota_reset_period: isWindows
        ? 'never'
        : values.quota_reset_period || 'never',
      quota_reset_custom_seconds:
        isWindows || values.quota_reset_period !== 'custom'
          ? 0
          : Number(values.quota_reset_custom_seconds || 0),
      reset_amount_limit: isWindows
        ? 0
        : parseQuotaFromDollars(Number(values.reset_amount_limit || 0)),
      weekly_amount_limit: isWindows
        ? 0
        : parseQuotaFromDollars(Number(values.weekly_amount_limit || 0)),
      monthly_amount_limit: isWindows
        ? 0
        : parseQuotaFromDollars(Number(values.monthly_amount_limit || 0)),
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
      total_amount: isWindows
        ? 0
        : parseQuotaFromDollars(Number(values.total_amount || 0)),
      upgrade_group: values.upgrade_group || '',
      downgrade_group: values.downgrade_group || '',
      // 动态窗口：limit 走美元→额度换算；legacy 模型提交空串（后端走老路径）。
      reset_windows: isWindows
        ? JSON.stringify(
            (resetWindows || []).map((w) => ({
              ...w,
              limit: parseQuotaFromDollars(Number(w.limit || 0)),
            }))
          )
        : '',
    },
  }
}

// 表单里的动态窗口行（limit 为美元显示单位，落库时换算回额度）。
export interface ResetWindowFormRow {
  unit: 'hour' | 'day' | 'week' | 'month'
  value: number
  limit: number
}

// 解析后端 wire 格式的 reset_windows（JSON 数组文本）。
export function parseResetWindowsRaw(raw: string): ResetWindowFormRow[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as ResetWindowFormRow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// legacy 上限字段 → 窗口行（"切换到动态窗口模型"时预填，尽力而为，管理员可再调整）。
export function deriveWindowsFromLegacy(
  values: Pick<
    PlanFormValues,
    | 'quota_reset_period'
    | 'quota_reset_custom_seconds'
    | 'reset_amount_limit'
    | 'weekly_amount_limit'
    | 'monthly_amount_limit'
  >
): ResetWindowFormRow[] {
  const rows: ResetWindowFormRow[] = []
  // 合并同 (unit,value) 来源：legacy 的多个"同周期上限"（如 weekly_amount_limit 与
  // reset_amount_limit 同为每周）原本就是各自取最小 gate，合并成一个窗口时保持 min 语义，
  // 避免预填出两个同长窗口违反"严格递增"校验。
  const add = (unit: ResetWindowFormRow['unit'], value: number, limit: number) => {
    if (limit <= 0) return
    const v = Math.max(1, Math.round(value))
    const existing = rows.find((r) => r.unit === unit && r.value === v)
    if (existing) {
      existing.limit = Math.min(existing.limit, limit)
      return
    }
    rows.push({ unit, value: v, limit })
  }
  const weekLimit = Number(values.weekly_amount_limit || 0)
  const monthLimit = Number(values.monthly_amount_limit || 0)
  const cycleLimit = Number(values.reset_amount_limit || 0)
  add('week', 1, weekLimit)
  add('month', 1, monthLimit)
  if (cycleLimit > 0 && values.quota_reset_period !== 'never') {
    let unit: ResetWindowFormRow['unit'] = 'hour'
    let value = 1
    switch (values.quota_reset_period) {
      case 'daily':
        unit = 'day'
        value = 1
        break
      case 'weekly':
        unit = 'week'
        value = 1
        break
      case 'monthly':
        unit = 'month'
        value = 1
        break
      case 'custom': {
        const secs = Number(values.quota_reset_custom_seconds || 0)
        if (secs >= 86400) {
          unit = 'day'
          value = secs / 86400
        } else if (secs >= 3600) {
          unit = 'hour'
          value = secs / 3600
        }
        break
      }
      default:
        break
    }
    add(unit, value, cycleLimit)
  }
  // 预填结果按时长升序排好，天然满足"严格递增"校验，管理员无需手动调整顺序。
  return rows.sort(
    (a, b) => windowRowDurationSeconds(a) - windowRowDurationSeconds(b)
  )
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
