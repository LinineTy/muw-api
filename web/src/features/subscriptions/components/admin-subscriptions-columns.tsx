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

import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { formatQuota } from '@/lib/format'

import { buildLimitRows, formatTimestamp } from '../lib'
import type { AdminUserSubscriptionSummary } from '../types'
import { SubscriptionAdminActions } from './subscription-admin-actions'
import { HistoryPurgeAction } from './subscription-history-purge-action'

function getSubscriptionStatusBadge(
  subscription: { status: string; end_time: number },
  t: (key: string) => string
) {
  if (subscription.status === 'deleted') {
    return (
      <StatusBadge label={t('Deleted')} variant='danger' copyable={false} />
    )
  }
  const isExpired =
    subscription.status !== 'cancelled' &&
    (subscription.status === 'expired' ||
      subscription.end_time <= Date.now() / 1000)
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
  return <StatusBadge label={t('Expired')} variant='neutral' copyable={false} />
}

export function useAdminSubscriptionsColumns(options?: {
  actions?: 'standard' | 'purge' | false
}): ColumnDef<AdminUserSubscriptionSummary>[] {
  const { t } = useTranslation()
  const actions = options?.actions ?? 'standard'

  return useMemo((): ColumnDef<AdminUserSubscriptionSummary>[] => {
    const columns: ColumnDef<AdminUserSubscriptionSummary>[] = [
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
        enableSorting: false,
        meta: { mobileHidden: true },
        cell: ({ row }) => {
          const { subscription, plan } = row.original
          // 滚动窗口模型：每窗口一个胶囊（横排换行）；全部窗口额度 0 = 无限。
          const limitRows = buildLimitRows({ subscription, plan }, t)
          if (limitRows.length === 0) {
            return (
              <span className='text-muted-foreground'>{t('Unlimited')}</span>
            )
          }
          return (
            <div className='flex max-w-[320px] flex-wrap gap-x-1.5 gap-y-1'>
              {limitRows.map((r) => {
                const pct = Math.min(
                  100,
                  Math.round((r.used / r.total) * 100)
                )
                // 用量级着色：>=90 红 / >=70 琥珀 / 其余中性，无进度条也一眼可见。
                let tone = 'border-border bg-muted/50 text-foreground'
                if (pct >= 90) {
                  tone =
                    'border-destructive/30 bg-destructive/10 text-destructive'
                } else if (pct >= 70) {
                  tone = 'border-warning/30 bg-warning/10 text-warning'
                }
                return (
                  <span
                    key={r.rowKey}
                    title={`${r.label}: ${formatQuota(r.used)} / ${formatQuota(r.total)}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none whitespace-nowrap ${tone}`}
                  >
                    <span className='font-medium'>
                      {r.period ?? r.label}
                    </span>
                    <span className='tabular-nums opacity-80'>
                      {formatQuota(r.used)}/{formatQuota(r.total)}
                    </span>
                  </span>
                )
              })}
            </div>
          )
        },
        size: 160,
      },
    ]
    if (actions !== false) {
      columns.push({
        id: 'actions',
        header: t('Actions'),
        enableSorting: false,
        meta: { mobileHidden: true },
        cell: ({ row }) =>
          actions === 'purge' ? (
            <HistoryPurgeAction summary={row.original} />
          ) : (
            <SubscriptionAdminActions summary={row.original} />
          ),
        size: 90,
      })
    }
    return columns
  }, [t, actions])
}
