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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'

import { useMySubscriptions } from './my-subscriptions-provider'
import { SubscriptionList } from './subscription-list'
import { PlanCatalogSection } from './plan-catalog-section'
import { classifySubscriptionStatus } from '../lib/helpers'

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

export function MySubscriptionsTabs() {
  const { t } = useTranslation()
  const { selfData, plans, loading } = useMySubscriptions()

  const allSubscriptions = useMemo(
    () => selfData?.all_subscriptions ?? [],
    [selfData]
  )
  const { active, expired, cancelled } = useMemo(
    () => splitByStatus(allSubscriptions),
    [allSubscriptions]
  )

  const planTitleMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of plans) {
      if (p?.plan?.id) {
        map.set(p.plan.id, p.plan.title || '')
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
    <Tabs defaultValue='active' className='flex min-h-0 flex-1 flex-col'>
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
        <TabsTrigger value='plans'>{t('Subscription Plans')}</TabsTrigger>
      </TabsList>
      <TabsContent value='active' className='pt-3'>
        <SubscriptionList subscriptions={active} planTitleMap={planTitleMap} />
      </TabsContent>
      <TabsContent value='expired' className='pt-3'>
        <SubscriptionList
          subscriptions={expired}
          planTitleMap={planTitleMap}
        />
      </TabsContent>
      <TabsContent value='cancelled' className='pt-3'>
        <SubscriptionList
          subscriptions={cancelled}
          planTitleMap={planTitleMap}
        />
      </TabsContent>
      <TabsContent value='plans' className='pt-3'>
        <PlanCatalogSection />
      </TabsContent>
    </Tabs>
  )
}
