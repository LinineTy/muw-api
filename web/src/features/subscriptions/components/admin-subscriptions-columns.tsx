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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Progress } from '@/components/ui/progress'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { formatTimestamp } from '../lib'
import type { AdminUserSubscriptionSummary } from '../types'

function getSubscriptionStatusBadge(
  subscription: { status: string; end_time: number },
  t: (key: string) => string
) {
  const isExpired =
    subscription.status !== 'cancelled' &&
    (subscription.status === 'expired' || subscription.end_time <= Date.now() / 1000)
  const isActive = subscription.status === 'active' && !isExpired
  const isCancelled = subscription.status === 'cancelled'

  if (isActive) {
    return (
      <StatusBadge label={t('Active')} variant='success' copyable={false} />
    )
  }
  if (isCancelled) {
    return (
      <StatusBadge label={t('Cancelled')} variant='neutral' copyable={false} />
    )
  }
  return (
    <StatusBadge label={t('Expired')} variant='neutral' copyable={false} />
  )
}

function getUsageProgressColor(percentage: number): string {
  if (percentage >= 90) {
    return '[&_[data-slot=progress-indicator]]:bg-rose-500'
  }
  if (percentage >= 70) {
    return '[&_[data-slot=progress-indicator]]:bg-amber-500'
  }
  return '[&_[data-slot=progress-indicator]]:bg-emerald-500'
}

export function useAdminSubscriptionsColumns(): ColumnDef<AdminUserSubscriptionSummary>[] {
  const { t } = useTranslation()

  return useMemo(
    (): ColumnDef<AdminUserSubscriptionSummary>[] => [
      {
        accessorFn: (row) => row.subscription.id,
        id: 'id',
        header: t('ID'),
        meta: { mobileHidden: true },
        cell: ({ row }) => <TableId value={row.original.subscription.id} />,
        size: 60,
      },
      {
        accessorFn: (row) => row.subscription.user_id,
        id: 'user',
        header: t('User'),
        meta: { mobileTitle: true },
        cell: ({ row }) => {
          const { username, email } = row.original
          return (
            <div className='max-w-full min-w-0'>
              <div className='truncate font-medium'>{username}</div>
              {email && (
                <div className='text-muted-foreground truncate text-xs'>
                  {email}
                </div>
              )}
            </div>
          )
        },
        size: 180,
      },
      {
        accessorFn: (row) => row.plan_title || row.subscription.plan_id,
        id: 'plan',
        header: t('Plan'),
        cell: ({ row }) => {
          const { plan_title, subscription } = row.original
          return (
            <div className='max-w-full min-w-0'>
              <span className='truncate font-medium'>
                {plan_title || `${t('Subscription')} #${subscription.id}`}
              </span>
            </div>
          )
        },
        size: 160,
      },
      {
        accessorFn: (row) => row.subscription.status,
        id: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) =>
          getSubscriptionStatusBadge(row.original.subscription, t),
        size: 90,
      },
      {
        accessorFn: (row) => row.subscription.start_time,
        id: 'start_time',
        header: t('Start'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {formatTimestamp(row.original.subscription.start_time)}
          </span>
        ),
        size: 150,
      },
      {
        accessorFn: (row) => row.subscription.end_time,
        id: 'end_time',
        header: t('End'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {formatTimestamp(row.original.subscription.end_time)}
          </span>
        ),
        size: 150,
      },
      {
        id: 'usage',
        header: t('Usage'),
        meta: { mobileHidden: true },
        cell: ({ row }) => {
          const { amount_total: total, amount_used: used } =
            row.original.subscription
          const totalNum = Number(total || 0)
          if (totalNum <= 0) {
            return (
              <span className='text-muted-foreground'>{t('Unlimited')}</span>
            )
          }
          const usedNum = Number(used || 0)
          const remainNum = Math.max(0, totalNum - usedNum)
          const percentage = Math.min(100, (usedNum / totalNum) * 100)
          const progressColor = getUsageProgressColor(percentage)
          return (
            <Tooltip>
              <TooltipTrigger render={<div className='w-[130px] space-y-1' />}>
                <div className='flex justify-between text-xs'>
                  <span className='font-medium tabular-nums'>
                    {formatQuota(usedNum)}
                  </span>
                  <span className='text-muted-foreground tabular-nums'>
                    {formatQuota(totalNum)}
                  </span>
                </div>
                <Progress value={percentage} className={cn('h-1.5', progressColor)} />
              </TooltipTrigger>
              <TooltipContent>
                <div className='space-y-1 text-xs'>
                  <div>
                    {t('Used:')} {formatQuota(usedNum)}
                  </div>
                  <div>
                    {t('Remaining:')} {formatQuota(remainNum)} (
                    {percentage.toFixed(1)}%)
                  </div>
                  <div>
                    {t('Total:')} {formatQuota(totalNum)}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          )
        },
        size: 160,
      },
    ],
    [t]
  )
}
