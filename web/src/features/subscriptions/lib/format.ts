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

import type { RenewTermsSnapshot, SubscriptionPlan } from '../types'

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

export function formatResetPeriod(
  plan: Partial<SubscriptionPlan>,
  t: TFunction
): string {
  const period = plan?.quota_reset_period || 'never'
  if (period === 'daily') return t('Daily')
  if (period === 'weekly') return t('Weekly')
  if (period === 'monthly') return t('Monthly')
  if (period === 'custom') {
    const seconds = Number(plan?.quota_reset_custom_seconds || 0)
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${t('days')}`
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${t('hours')}`
    if (seconds >= 60) return `${Math.floor(seconds / 60)} ${t('minutes')}`
    return `${seconds} ${t('seconds')}`
  }
  return t('No Reset')
}

export function formatTimestamp(ts: number): string {
  if (!ts) return '-'
  return dayjs(ts * 1000).format('YYYY-MM-DD HH:mm:ss')
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
