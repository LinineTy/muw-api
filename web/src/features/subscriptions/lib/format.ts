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

import dayjs from '@/lib/dayjs'

import type { RenewTermsSnapshot, ResetWindow, SubscriptionPlan, WindowState } from '../types'

export function formatDuration(
  plan: Partial<SubscriptionPlan>,
  t: TFunction
): string {
  const unit = plan?.duration_unit || 'month'
  const value = plan?.duration_value || 1
  const unitLabels: Record<string, string> = {
    year: t('years'),
    month: t('months'),
    day: t('days'),
    hour: t('hours'),
    custom: t('Custom (seconds)'),
  }
  if (unit === 'custom') {
    const seconds = plan?.custom_seconds || 0
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${t('days')}`
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${t('hours')}`
    return `${seconds} ${t('seconds')}`
  }
  return `${value} ${unitLabels[unit] || unit}`
}

export function formatTimestamp(ts: number): string {
  if (!ts) return '-'
  return dayjs(ts * 1000).format('YYYY-MM-DD HH:mm:ss')
}

// 紧凑时间（窗口重置时间等小尺寸展示用）：如 "08-24 18:00"。
export function formatCompactTimestamp(ts: number): string {
  if (!ts) return '-'
  return dayjs(ts * 1000).format('MM-DD HH:mm')
}

// 续费条款快照解析：快照存在且周期时长有效时返回，否则返回 null（存量订阅回退当前套餐）。
export function parseRenewTerms(raw?: string): RenewTermsSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as RenewTermsSnapshot
    if (
      typeof parsed.duration_seconds === 'number' &&
      parsed.duration_seconds > 0
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

// 秒数 → 人类可读时长（快照周期时长展示用）。
export function formatDurationSeconds(seconds: number, t: TFunction): string {
  if (seconds >= 86400) {
    const days = seconds / 86400
    return Number.isInteger(days)
      ? `${days} ${t('days')}`
      : `${days.toFixed(1)} ${t('days')}`
  }
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} ${t('hours')}`
  if (seconds >= 60) return `${Math.round(seconds / 60)} ${t('minutes')}`
  return `${seconds} ${t('seconds')}`
}

// 套餐单周期时长（秒），用于无快照时升降配估值的回退。月按 30 天近似。
export function planDurationSeconds(
  plan?: Partial<SubscriptionPlan> | null
): number {
  const unit = plan?.duration_unit || 'month'
  const value = Number(plan?.duration_value || 0)
  switch (unit) {
    case 'year':
      return value * 365 * 86400
    case 'month':
      return value * 30 * 86400
    case 'day':
      return value * 86400
    case 'hour':
      return value * 3600
    case 'custom':
      return Number(plan?.custom_seconds || 0)
    default:
      return value * 30 * 86400
  }
}

// 解析套餐的动态窗口定义（wire JSON 文本 → 数组）；空/损坏返回 []。
export function parsePlanResetWindows(raw?: string): ResetWindow[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as ResetWindow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 解析订阅的动态窗口消费状态（wire JSON 文本 → 数组）；空/损坏返回 []。
export function parseWindowStates(raw?: string): WindowState[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as WindowState[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 窗口时长 → 人类可读（如 "5 hours" / "30 days" / "1 month"）。value===1 用单数词形。
export function formatWindowDuration(
  w: { unit?: string; value?: number },
  t: TFunction
): string {
  const v = Number(w?.value || 0)
  switch (w?.unit) {
    case 'month':
      return `${v} ${t(v === 1 ? 'month' : 'months')}`
    case 'week':
      return `${v} ${t(v === 1 ? 'week' : 'weeks')}`
    case 'day':
      return `${v} ${t(v === 1 ? 'day' : 'days')}`
    case 'hour':
      return `${v} ${t(v === 1 ? 'hour' : 'hours')}`
    default:
      return ''
  }
}

// 窗口周期的裸标签（不带"每"前缀），value===1 省略数字：如 "个月" / "天" / "周" / "2 小时"。
// 供 "每{{period}}" 与目录/弹窗摘要共用，保证 value===1 不再显示 "1 个月"。
export function formatWindowPeriodLabel(
  w: { unit?: string; value?: number },
  t: TFunction
): string {
  const full = formatWindowDuration(w, t)
  if (!full) return ''
  return Number(w?.value || 0) === 1 ? full.replace(/^1 /, '') : full
}

// 窗口周期的紧凑标签（订阅卡进度条用）："每周" / "每5 小时" / "每个月"。value=1 省略数字。
export function formatWindowPeriod(
  w: { unit?: string; value?: number },
  t: TFunction
): string {
  const period = formatWindowPeriodLabel(w, t)
  if (!period) return ''
  return t('every {{period}}', { period })
}

// 动态窗口是否作为本订阅封顶上限（时长 > 套餐有效期）。
// 与后端 calcWindowNextReset 语义对齐：后端在 next_reset 超出 EndTime（严格大于）
// 时返回 0 = 封顶；边界相等（如 1 天窗口 + 1 天套餐）不封顶。时长估算：月按 30 天
// 近似（无订阅锚点，无法用日历 AddDate），仅影响边界月份的展示标签。
export function isCapWindow(
  w: ResetWindow,
  plan?: Partial<SubscriptionPlan> | null
): boolean {
  const validity = planDurationSeconds(plan)
  if (validity <= 0) return false
  let duration = 0
  const v = Number(w?.value || 0)
  switch (w?.unit) {
    case 'month':
      duration = v * 30 * 86400
      break
    case 'week':
      duration = v * 7 * 86400
      break
    case 'day':
      duration = v * 86400
      break
    case 'hour':
      duration = v * 3600
      break
    default:
      return false
  }
  return duration > validity
}
