// @muw-owned
// Thin re-exports so the feature stays self-contained while reusing the
// subscription + wallet API implementations (no duplicated network calls).
export {
  getPublicPlans,
  getSelfSubscriptionFull,
  updateBillingPreference,
  cancelSubscription,
  renewSubscriptionBalance,
  setSubscriptionAutoRenew,
  setSubscriptionPriority,
  getExpiringSubscriptions,
  paySubscriptionEpay,
  paySubscriptionBalance,
} from '@/features/subscriptions/api'
export type { ExpiringSubscription } from '@/features/subscriptions/api'
export { getSelf } from '@/lib/api'
