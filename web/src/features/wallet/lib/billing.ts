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
import type { StatusBadgeProps } from '@/components/status-badge'
import { formatTimestampToDate } from '@/lib/format'

import type { PaymentMethod, TopupStatus } from '../types'

// ============================================================================
// Billing Utility Functions
// ============================================================================

interface StatusConfig {
  variant: StatusBadgeProps['variant']
  label: string
}

/**
 * Status badge configuration
 */
export const STATUS_CONFIG: Record<TopupStatus, StatusConfig> = {
  success: {
    variant: 'success',
    label: 'Success',
  },
  pending: {
    variant: 'warning',
    label: 'Pending',
  },
  expired: {
    variant: 'danger',
    label: 'Expired',
  },
}

/**
 * Get status badge configuration
 */
export function getStatusConfig(status: TopupStatus): StatusConfig {
  return STATUS_CONFIG[status] || STATUS_CONFIG.pending
}

/**
 * Payment method display names
 */
export const PAYMENT_METHOD_NAMES: Record<string, string> = {
  alipay: 'Alipay',
  wxpay: 'WeChat Pay',
  balance: 'Balance',
}

/**
 * Get payment method display name.
 * 优先用管理员配置的 PayMethods 名称（type → name），未命中再回退内置映射表，
 * 最后回退原始 type。让订单列里自定义渠道（如 epay 配的 "linuxdo credit"）显示配置名，
 * 而不是裸 type。
 */
export function getPaymentMethodName(
  method: string,
  t?: (key: string) => string,
  payMethods?: PaymentMethod[]
): string {
  if (payMethods) {
    const configured = payMethods.find((pm) => pm.type === method)
    if (configured?.name) return configured.name
  }
  const name = PAYMENT_METHOD_NAMES[method] || method
  return t ? t(name) : name
}

/**
 * Format timestamp to readable date string
 */
export function formatTimestamp(timestamp: number): string {
  return formatTimestampToDate(timestamp)
}
