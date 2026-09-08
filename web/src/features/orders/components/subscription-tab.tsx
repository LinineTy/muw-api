// @muw-owned
import { CalendarClock, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { EndedSubscriptionsTable } from '@/features/my-subscriptions/components/ended-subscriptions-table'
import {
  MySubscriptionsProvider,
  useMySubscriptions,
} from '@/features/my-subscriptions/components/my-subscriptions-provider'
import { PlanCatalogSection } from '@/features/my-subscriptions/components/plan-catalog-section'
import { classifySubscriptionStatus } from '@/features/my-subscriptions/lib/helpers'
import {
  getExpiringSubscriptions,
  type ExpiringSubscription,
} from '@/features/subscriptions/api'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'

function splitByStatus(subscriptions: UserSubscriptionRecord[]) {
  const active: UserSubscriptionRecord[] = []
  const ended: UserSubscriptionRecord[] = []
  for (const sub of subscriptions) {
    const { isActive } = classifySubscriptionStatus(sub)
    if (isActive) {
      active.push(sub)
    } else {
      ended.push(sub)
    }
  }
  return { active, ended }
}

function ExpiringBanner() {
  const { t } = useTranslation()
  const [expiring, setExpiring] = useState<ExpiringSubscription[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getExpiringSubscriptions(7)
      .then((res) => {
        if (!cancelled && res.success) setExpiring(res.data || [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (dismissed || expiring.length === 0) return null

  return (
    <div className='relative flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 pr-8 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300'>
      <CalendarClock className='size-4 shrink-0' aria-hidden='true' />
      <span>
        {t('{{count}} subscription(s) expire within 7 days', {
          count: expiring.length,
        })}
        :{' '}
        {expiring
          .map((e) => `${e.plan_title || `#${e.subscription.id}`}`)
          .join(', ')}
      </span>
      <button
        type='button'
        onClick={() => setDismissed(true)}
        className='absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 hover:bg-black/5'
        aria-label={t('Close')}
      >
        <X className='size-3.5' />
      </button>
    </div>
  )
}

function SubscriptionTabContent({ grouped }: { grouped: boolean }) {
  const { t } = useTranslation()
  const { selfData, planMap, loading } = useMySubscriptions()

  const allSubscriptions = useMemo(
    () => selfData?.all_subscriptions ?? [],
    [selfData]
  )
  const ended = useMemo(
    () => splitByStatus(allSubscriptions).ended,
    [allSubscriptions]
  )

  if (loading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-9 w-full' />
        <Skeleton className='h-40 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-5'>
      {/* 到期提醒 */}
      <ExpiringBanner />

      {/* 套餐目录（购买）：余额支付/在线支付，支持升级/降级 */}
      <section className='flex flex-col gap-3'>
        <h2 className='text-sm font-semibold tracking-tight'>
          {t('Plans')}
        </h2>
        <PlanCatalogSection grouped={grouped} />
      </section>

      {/* 历史订阅：已过期/已取消的订阅 */}
      <section className='flex flex-col gap-3'>
        <h2 className='text-sm font-semibold tracking-tight'>
          {t('Historical Subscriptions')}
        </h2>
        <EndedSubscriptionsTable subscriptions={ended} planMap={planMap} />
      </section>
    </div>
  )
}

export function SubscriptionTab({ grouped }: { grouped: boolean }) {
  return (
    <MySubscriptionsProvider>
      <SubscriptionTabContent grouped={grouped} />
    </MySubscriptionsProvider>
  )
}
