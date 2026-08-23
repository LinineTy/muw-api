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

import {
  formatWindowPeriod,
  isCapWindow,
  parsePlanResetWindows,
  parseWindowStates,
  windowRowDurationSeconds,
} from '@/features/subscriptions/lib'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'

// 由套餐 + 订阅解析出限额行数据（动态窗口按时长升序；legacy 周期/周/月仅 >0 渲染）。
// 与 my-subscriptions 的 LimitMiniCard 同源逻辑，供钱包订阅面板使用。
export function buildLimitRows(
  record: UserSubscriptionRecord,
  t: TFunction
): {
  rowKey: string
  label: string
  used: number
  total: number
  resetAt?: number
  noReset?: boolean
  isCap?: boolean
}[] {
  const sub = record.subscription
  const plan = record.plan
  if (!plan) return []
  const resetWindows = parsePlanResetWindows(plan.reset_windows)
  if (resetWindows.length > 0) {
    const states = parseWindowStates(sub.window_state)
    return resetWindows
      .map((w, i) => ({ w, state: states[i] }))
      .sort(
        (a, b) =>
          windowRowDurationSeconds(a.w) - windowRowDurationSeconds(b.w)
      )
      .map(({ w, state }) => {
        // 封顶判定优先用后端实际窗口状态（next_reset_at==0 && cycle_start_at>0 = 订阅内
        // 不再刷新，limit 即本订阅总上限）；状态缺失（新购/数据异常）才回退到套餐时长估算。
        const backendCapped =
          !!state && state.next_reset_at === 0 && state.cycle_start_at > 0
        const isCap = backendCapped || (state ? false : isCapWindow(w, plan))
        return {
          // 窗口定义唯一键：多个封顶窗口 label 都是 "Total cap"，行 key 不能只用 label。
          rowKey: `${w.unit}-${w.value}`,
          label: isCap ? t('Total cap') : formatWindowPeriod(w, t),
          used: state?.cycle_used || 0,
          total: w.limit || 0,
          resetAt: state?.next_reset_at || 0,
          noReset: backendCapped,
          isCap,
        }
      })
  }
  const rows: {
    rowKey: string
    label: string
    used: number
    total: number
  }[] = []
  const cycleLimit = Number(plan.reset_amount_limit || 0)
  const weekLimit = Number(plan.weekly_amount_limit || 0)
  const monthLimit = Number(plan.monthly_amount_limit || 0)
  if (cycleLimit > 0) {
    rows.push({
      rowKey: 'cycle',
      label: t('This cycle'),
      used: Number(sub.cycle_used || 0),
      total: cycleLimit,
    })
  }
  if (weekLimit > 0) {
    rows.push({
      rowKey: 'week',
      label: t('This week'),
      used: Number(sub.week_used || 0),
      total: weekLimit,
    })
  }
  if (monthLimit > 0) {
    rows.push({
      rowKey: 'month',
      label: t('This month'),
      used: Number(sub.month_used || 0),
      total: monthLimit,
    })
  }
  return rows
}
