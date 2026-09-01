// @muw-owned
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
