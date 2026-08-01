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
import { Clock, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestamp } from '@/features/subscriptions/lib'
import { formatQuota } from '@/lib/format'

import type { UserSubscriptionRecord } from '@/features/subscriptions/types'
import {
  classifySubscriptionStatus,
  getRemainingDays,
  getUsagePercent,
} from '../lib/helpers'

function SubscriptionItem({
  sub,
  planTitle,
}: {
  sub: UserSubscriptionRecord
  planTitle: string
}) {
  const { t } = useTranslation()
  const subscription = sub.subscription
  const totalAmount = Number(subscription?.amount_total || 0)
  const usedAmount = Number(subscription?.amount_used || 0)
  const remainAmount =
    totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
  const remainDays = getRemainingDays(sub)
  const usagePercent = getUsagePercent(sub)
  const nextResetTime = subscription?.next_reset_time ?? 0
  const { isActive, isCancelled } = classifySubscriptionStatus(sub)

  let statusBadge = (
    <StatusBadge
      label={t('Expired')}
      variant='neutral'
      copyable={false}
    />
  )
  if (isActive) {
    statusBadge = (
      <StatusBadge label={t('Active')} variant='success' copyable={false} />
    )
  } else if (isCancelled) {
    statusBadge = (
      <StatusBadge label={t('Cancelled')} variant='neutral' copyable={false} />
    )
  }

  let endTimeLabel = t('Expired at')
  if (isActive) {
    endTimeLabel = t('Until')
  } else if (isCancelled) {
    endTimeLabel = t('Cancelled at')
  }

  return (
    <div className='bg-card overflow-hidden rounded-2xl border shadow-xs'>
      {/* 顶栏：计划名 + 状态 + 剩余天数 */}
      <div className='flex items-center justify-between gap-2 border-b px-4 py-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-semibold'>
            {planTitle
              ? `${planTitle} · ${t('Subscription')} #${subscription?.id}`
              : `${t('Subscription')} #${subscription?.id}`}
          </span>
          {statusBadge}
        </div>
        {isActive && (
          <span className='text-muted-foreground shrink-0 text-xs'>
            {t('{{count}} days remaining', {
              count: remainDays,
            })}
          </span>
        )}
      </div>

      {/* 额度主体 */}
      <div className='px-4 py-3'>
        {totalAmount > 0 ? (
          <>
            <div className='flex items-end justify-between gap-2'>
              <div className='min-w-0'>
                <div className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
                  {t('Total Quota')}
                </div>
                <div className='text-foreground mt-0.5 truncate font-mono text-xl font-bold tracking-tight tabular-nums sm:text-2xl'>
                  <Tooltip>
                    <TooltipTrigger render={<span className='cursor-help' />}>
                      {formatQuota(usedAmount)}
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('Raw Quota')}: {usedAmount}
                    </TooltipContent>
                  </Tooltip>
                  <span className='text-muted-foreground text-sm font-normal'>
                    {' '}
                    / {formatQuota(totalAmount)}
                  </span>
                </div>
              </div>
              <span className='text-muted-foreground shrink-0 text-xs'>
                {t('Used')} {usagePercent}%
              </span>
            </div>
            {isActive ? (
              <Progress value={usagePercent} className='mt-2 h-1.5' />
            ) : (
              <div className='bg-muted/50 mt-2 h-1.5 overflow-hidden rounded-full'>
                <div
                  className='bg-muted h-full rounded-full'
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            )}
            <div className='text-muted-foreground mt-1 text-xs'>
              {t('Remaining')} {formatQuota(remainAmount)}
            </div>
          </>
        ) : (
          <div className='flex items-center gap-2'>
            <span className='font-mono text-xl font-bold tracking-tight sm:text-2xl'>
              ∞
            </span>
            <span className='text-muted-foreground text-xs'>
              {t('Unlimited')}
            </span>
          </div>
        )}
      </div>

      {/* 时间信息条 */}
      <div className='bg-muted/40 text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs'>
        <span className='flex items-center gap-1.5'>
          <Clock className='size-3.5 shrink-0' aria-hidden='true' />
          {endTimeLabel} {formatTimestamp(subscription?.end_time ?? 0)}
        </span>
        {isActive && nextResetTime > 0 && (
          <span className='flex items-center gap-1.5'>
            <RefreshCw className='size-3.5 shrink-0' aria-hidden='true' />
            {t('Reset')} {formatTimestamp(nextResetTime)}
          </span>
        )}
      </div>
    </div>
  )
}

export function SubscriptionList({
  subscriptions,
  planTitleMap,
}: {
  subscriptions: UserSubscriptionRecord[]
  planTitleMap: Map<number, string>
}) {
  const { t } = useTranslation()

  if (subscriptions.length === 0) {
    return (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        {t('No subscriptions yet')}
      </p>
    )
  }

  return (
    <div className='grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3'>
      {subscriptions.map((sub) => {
        const subscription = sub.subscription
        const planTitle = planTitleMap.get(subscription?.plan_id) || ''
        return (
          <SubscriptionItem
            key={subscription?.id}
            sub={sub}
            planTitle={planTitle}
          />
        )
      })}
    </div>
  )
}
