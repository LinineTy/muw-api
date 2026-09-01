// @muw-owned
import type { StatusVariant } from '@/components/status-badge'

// 成功率分档色:与模型健康页 SuccessRateBadge 同档。
// ≥99 绿 / ≥90 蓝 / ≥70 黄 / 其余红。
export type SuccessRateTier = Extract<
  StatusVariant,
  'success' | 'info' | 'warning' | 'danger'
>

export function successRateVariant(rate: number): SuccessRateTier {
  if (rate >= 99) return 'success'
  if (rate >= 90) return 'info'
  if (rate >= 70) return 'warning'
  return 'danger'
}
