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
import { CalendarClock, Layers, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileToggleMenu, ToggleMenuItem, TogglePill } from '@/components/ui/responsive-toggle'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

import { useMySubscriptions } from './my-subscriptions-provider'
import { SubscriptionList } from './subscription-list'
import { PlanCatalogSection } from './plan-catalog-section'
import { classifySubscriptionStatus } from '../lib/helpers'
import { getExpiringSubscriptions, type ExpiringSubscription } from '../api'

function splitByStatus(subscriptions: UserSubscriptionRecord[]) {
  const active: UserSubscriptionRecord[] = []
  const expired: UserSubscriptionRecord[] = []
  const cancelled: UserSubscriptionRecord[] = []
  for (const sub of subscriptions) {
    const { isActive, isExpired, isCancelled } = classifySubscriptionStatus(sub)
    if (isActive) {
      active.push(sub)
    } else if (isCancelled) {
      cancelled.push(sub)
    } else if (isExpired) {
      expired.push(sub)
    }
  }
  return { active, expired, cancelled }
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

export function MySubscriptionsTabs() {
  const { t } = useTranslation()
  const { selfData, plans, loading } = useMySubscriptions()
  const [tab, setTab] = useState<'active' | 'expired' | 'cancelled' | 'plans'>(
    'active'
  )
  // 套餐目录的「分组显示」开关：默认开（按互斥组聚合成块，无互斥组的套餐单独列出）。
  const [grouped, setGrouped] = useState(true)

  const allSubscriptions = useMemo(
    () => selfData?.all_subscriptions ?? [],
    [selfData]
  )
  const { active, expired, cancelled } = useMemo(() => {
    const split = splitByStatus(allSubscriptions)
    // Active subscriptions honor the user-set consumption priority: when a
    // preference has been chosen (priorities differ), sort the preferred first.
    const ps = split.active.map((s) => Number(s.subscription?.priority || 0))
    const maxP = Math.max(...ps)
    const minP = Math.min(...ps)
    if (ps.length > 1 && maxP > minP) {
      split.active.sort(
        (a, b) =>
          Number(a.subscription?.priority || 0) -
          Number(b.subscription?.priority || 0)
      )
    }
    return split
  }, [allSubscriptions])

  const planMap = useMemo(() => {
    const map = new Map<number, SubscriptionPlan>()
    for (const p of plans) {
      if (p?.plan?.id) {
        map.set(p.plan.id, p.plan)
      }
    }
    return map
  }, [plans])

  if (loading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-10 w-72' />
        <Skeleton className='h-40 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <ExpiringBanner />
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className='flex min-h-0 flex-1 flex-col'
      >
        <div className='flex items-center justify-between gap-2'>
          <TabsList className='w-fit'>
            <TabsTrigger value='active'>
              {t('Active')} ({active.length})
            </TabsTrigger>
            <TabsTrigger value='expired'>
              {t('Expired')} ({expired.length})
            </TabsTrigger>
            <TabsTrigger value='cancelled'>
              {t('Cancelled')} ({cancelled.length})
            </TabsTrigger>
            <TabsTrigger value='plans'>
              {t('Subscription Plans')}
            </TabsTrigger>
          </TabsList>
          {tab === 'plans' && (
            <>
              <TogglePill
                id='catalog-grouped'
                label={t('Group display')}
                icon={<Layers className='text-muted-foreground h-4 w-4' />}
                checked={grouped}
                onCheckedChange={setGrouped}
              />
              <MobileToggleMenu>
                <ToggleMenuItem
                  label={t('Group display')}
                  icon={<Layers className='size-4' />}
                  checked={grouped}
                  onCheckedChange={setGrouped}
                />
              </MobileToggleMenu>
            </>
          )}
        </div>
        <TabsContent value='active' className='min-h-0 overflow-y-auto px-2 pt-3 pb-3'>
          <SubscriptionList subscriptions={active} planMap={planMap} />
        </TabsContent>
        <TabsContent value='expired' className='min-h-0 overflow-y-auto px-2 pt-3 pb-3'>
          <SubscriptionList subscriptions={expired} planMap={planMap} />
        </TabsContent>
        <TabsContent value='cancelled' className='min-h-0 overflow-y-auto px-2 pt-3 pb-3'>
          <SubscriptionList subscriptions={cancelled} planMap={planMap} />
        </TabsContent>
        <TabsContent value='plans' className='min-h-0 overflow-y-auto px-2 pt-3 pb-3'>
          <PlanCatalogSection grouped={grouped} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
