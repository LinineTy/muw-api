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
import type { PaymentMethod } from '@/features/wallet/types'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'

export function getEpayMethods(payMethods: PaymentMethod[] = []): PaymentMethod[] {
  return payMethods.filter((m) => m?.type)
}

export function getBillingPreferenceLabel(
  preference: string,
  t: (key: string) => string
): string {
  switch (preference) {
    case 'subscription_first':
      return t('Subscription First')
    case 'wallet_first':
      return t('Wallet First')
    case 'subscription_only':
      return t('Subscription Only')
    case 'wallet_only':
      return t('Wallet Only')
    default:
      return preference
  }
}

export function getRemainingDays(sub: UserSubscriptionRecord): number {
  const endTime = sub?.subscription?.end_time || 0
  if (!endTime) return 0
  const now = Date.now() / 1000
  return Math.max(0, Math.ceil((endTime - now) / 86400))
}

export function getUsagePercent(sub: UserSubscriptionRecord): number {
  const total = Number(sub?.subscription?.amount_total || 0)
  const used = Number(sub?.subscription?.amount_used || 0)
  if (total <= 0) return 0
  return Math.round((used / total) * 100)
}

// Client-side status classification, mirroring the previous wallet card logic.
export function classifySubscriptionStatus(sub: UserSubscriptionRecord): {
  isActive: boolean
  isExpired: boolean
  isCancelled: boolean
} {
  const subscription = sub?.subscription
  const now = Date.now() / 1000
  const isExpired =
    (subscription?.end_time || 0) < now &&
    subscription?.status !== 'cancelled'
  const isCancelled = subscription?.status === 'cancelled'
  const isActive =
    subscription?.status === 'active' && (subscription?.end_time || 0) >= now
  return { isActive, isExpired, isCancelled }
}
