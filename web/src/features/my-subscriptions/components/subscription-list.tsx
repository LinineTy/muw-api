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
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
    <div className='bg-background rounded-md border p-3 text-xs'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate font-medium'>
            {planTitle
              ? `${planTitle} · ${t('Subscription')} #${subscription?.id}`
              : `${t('Subscription')} #${subscription?.id}`}
          </span>
          {statusBadge}
        </div>
        {isActive && (
          <span className='text-muted-foreground shrink-0'>
            {t('{{count}} days remaining', {
              count: remainDays,
            })}
          </span>
        )}
      </div>
      <div className='text-muted-foreground mt-1.5'>
        {endTimeLabel}{' '}
        {new Date((subscription?.end_time || 0) * 1000).toLocaleString()}
      </div>
      {isActive && nextResetTime > 0 && (
        <div className='text-muted-foreground mt-1'>
          {t('Next reset')}: {new Date(nextResetTime * 1000).toLocaleString()}
        </div>
      )}
      <div className='text-muted-foreground mt-1'>
        {t('Total Quota')}:{' '}
        {totalAmount > 0 ? (
          <Tooltip>
            <TooltipTrigger render={<span className='cursor-help' />}>
              {formatQuota(usedAmount)}/{formatQuota(totalAmount)} ·{' '}
              {t('Remaining')} {formatQuota(remainAmount)}
            </TooltipTrigger>
            <TooltipContent>
              {t('Raw Quota')}: {usedAmount}/{totalAmount} · {t('Remaining')}{' '}
              {remainAmount}
            </TooltipContent>
          </Tooltip>
        ) : (
          t('Unlimited')
        )}
        {totalAmount > 0 && (
          <span className='ml-2'>
            {t('Used')} {usagePercent}%
          </span>
        )}
      </div>
      {totalAmount > 0 && isActive && (
        <Progress value={usagePercent} className='mt-2 h-1.5' />
      )}
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
