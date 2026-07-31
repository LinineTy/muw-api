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
import { Crown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { dotColorMap, textColorMap } from '@/components/status-badge'
import { getSelfSubscriptionFull } from '@/features/subscriptions/api'
import { formatTimestamp } from '@/features/subscriptions/lib'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

function isActive(sub: UserSubscriptionRecord): boolean {
  const subscription = sub?.subscription
  return (
    subscription?.status === 'active' &&
    (subscription?.end_time || 0) >= Date.now() / 1000
  )
}

export function SubscriptionSummaryCard() {
  const { t } = useTranslation()
  const [activeSubscriptions, setActiveSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const fetch = async () => {
      try {
        const res = await getSelfSubscriptionFull()
        if (!cancelled && res.success && res.data) {
          const active = (res.data.subscriptions || []).filter(isActive)
          setActiveSubscriptions(active)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetch()
    return () => {
      cancelled = true
    }
  }, [])

  const hasActive = activeSubscriptions.length > 0
  const nextExpiry = hasActive
    ? Math.min(
        ...activeSubscriptions.map(
          (sub) => sub.subscription?.end_time || Number.MAX_SAFE_INTEGER
        )
      )
    : 0

  // Primary (soonest-expiring) active subscription for the quota summary.
  const primary = hasActive
    ? activeSubscriptions.find(
        (sub) => sub.subscription?.end_time === nextExpiry
      )
    : undefined
  const totalAmount = Number(primary?.subscription?.amount_total || 0)
  const usedAmount = Number(primary?.subscription?.amount_used || 0)
  const usagePercent =
    totalAmount > 0 ? Math.min(100, Math.round((usedAmount / totalAmount) * 100)) : 0

  return (
    <TitledCard
      title={t('My Subscriptions')}
      description={t('Subscribe to a plan for model access')}
      icon={<Crown className='h-4 w-4' />}
      iconTone='warning'
      disableHoverEffect
      contentClassName='space-y-3'
      action={
        <Button variant='outline' size='sm' render={<Link to='/my-subscriptions' />}>
          {t('Manage')}
        </Button>
      }
    >
      {loading ? (
        <>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-4 w-48' />
          <Skeleton className='h-1.5 w-full' />
        </>
      ) : (
        <>
          <div className='flex items-center gap-1.5 text-sm'>
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                hasActive ? dotColorMap.success : dotColorMap.neutral
              )}
              aria-hidden='true'
            />
            {hasActive ? (
              <span className={cn('font-medium', textColorMap.success)}>
                {activeSubscriptions.length} {t('active')}
              </span>
            ) : (
              <span className='text-muted-foreground font-medium'>
                {t('No Active')}
              </span>
            )}
          </div>

          {hasActive ? (
            <>
              <div className='text-muted-foreground text-sm'>
                {t('Next expiry')}:{' '}
                <span className='font-medium tabular-nums'>
                  {nextExpiry ? formatTimestamp(nextExpiry) : '-'}
                </span>
              </div>
              {totalAmount > 0 && (
                <div className='space-y-1'>
                  <div className='text-muted-foreground flex justify-between text-xs'>
                    <span>{t('Total Quota')}</span>
                    <span className='font-medium tabular-nums'>
                      {formatQuota(usedAmount)}/{formatQuota(totalAmount)}
                    </span>
                  </div>
                  <Progress value={usagePercent} className='h-1.5' />
                </div>
              )}
            </>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('Subscribe to a plan for model access')}
            </p>
          )}
        </>
      )}
    </TitledCard>
  )
}
