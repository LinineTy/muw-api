// @muw-owned
import type { TFunction } from 'i18next'

import type { SubscriptionPlan, UserSubscription } from '../types'
import {
  formatWindowPeriod,
  formatWindowPeriodLabel,
  isCapWindow,
  parsePlanResetWindows,
  parseWindowStates,
} from './format'
import { windowRowDurationSeconds } from './plan-form'

// 单个动态窗口的展示行（wallet 卡 / admin 用量列 / 弹窗共用）。
export interface WindowUsageRow {
  // 窗口定义唯一键：多个封顶窗口 label 都是 "Total cap"，行 key 不能只用 label。
  rowKey: string
  label: string
  // 紧凑周期标签（无"每"前缀，如 "5 hours"），表格胶囊等小尺寸展示用；封顶窗口无独立周期。
  period?: string
  used: number
  total: number
  resetAt?: number
  noReset?: boolean
  isCap?: boolean
}

// 由订阅 + 套餐解析出逐窗口限额行数据（动态窗口按时长升序；全部窗口额度 0 = 无限额度，
// 返回空行由调用方渲染 Unlimited）。展示消费方（wallet 卡 / admin 订阅表 / 弹窗）共用，
// 避免各处重复实现窗口解析与封顶判定。
export function buildLimitRows(
  record: { subscription: UserSubscription; plan?: SubscriptionPlan | null },
  t: TFunction
): WindowUsageRow[] {
  const sub = record.subscription
  const plan = record.plan
  if (!plan) return []
  const resetWindows = parsePlanResetWindows(plan.reset_windows)
  // 全部窗口额度为 0 = 无限额度：不渲染限额行，由调用方显示 Unlimited。
  if (
    resetWindows.length === 0 ||
    resetWindows.every((w) => Number(w.limit || 0) <= 0)
  ) {
    return []
  }
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
        rowKey: `${w.unit}-${w.value}`,
        label: isCap ? t('Total cap') : formatWindowPeriod(w, t),
        period: isCap ? undefined : formatWindowPeriodLabel(w, t),
        used: state?.cycle_used || 0,
        total: w.limit || 0,
        resetAt: state?.next_reset_at || 0,
        noReset: backendCapped,
        isCap,
      }
    })
}
