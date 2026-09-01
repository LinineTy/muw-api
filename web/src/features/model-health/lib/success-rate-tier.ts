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
