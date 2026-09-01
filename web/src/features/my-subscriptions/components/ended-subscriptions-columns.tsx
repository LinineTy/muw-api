// @muw-owned
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import type {
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import {
  buildLimitRows,
  formatTimestamp,
} from '@/features/subscriptions/lib'
import { formatQuota } from '@/lib/format'

import { classifySubscriptionStatus } from '../lib/helpers'

/**
 * 已结束（过期 + 取消）订阅表格列：订阅 / 状态（可筛选）/ 结束时间 / 已用。
 */
export function useEndedSubscriptionsColumns(
  planMap: Map<number, SubscriptionPlan>
): ColumnDef<UserSubscriptionRecord>[] {
  const { t } = useTranslation()
  return useMemo(
    (): ColumnDef<UserSubscriptionRecord>[] => [
      {
        accessorFn: (row) => row.subscription.id,
        id: 'id',
        header: t('ID'),
        meta: { mobileHidden: true },
        cell: ({ row }) => <TableId value={row.original.subscription.id} />,
        size: 60,
      },
      {
        accessorFn: (row) => {
          const plan = planMap.get(row.subscription.plan_id)
          return plan?.title || ''
        },
        id: 'plan',
        header: t('Plan'),
        meta: { mobileTitle: true },
        cell: ({ row }) => {
          const subscription = row.original.subscription
          const plan = planMap.get(subscription.plan_id)
          return (
            <div className='max-w-full min-w-0'>
              <span className='truncate font-medium'>
                {plan?.title || `${t('Subscription')} #${subscription.id}`}
              </span>
            </div>
          )
        },
        size: 160,
      },
      {
        id: 'status',
        accessorFn: (row) => {
          const { isCancelled } = classifySubscriptionStatus(row)
          return isCancelled ? 'cancelled' : 'expired'
        },
        // faceted 筛选把选中的状态写成数组，这里匹配"列值 ∈ 选中数组"。
        filterFn: (row, columnId, filterValue) =>
          (filterValue as string[]).includes(row.getValue<string>(columnId)),
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => {
          const { isCancelled } = classifySubscriptionStatus(row.original)
          return (
            <StatusBadge
              label={isCancelled ? t('Cancelled') : t('Expired')}
              variant='neutral'
              copyable={false}
            />
          )
        },
        size: 90,
      },
      {
        id: 'end_time',
        accessorFn: (row) => row.subscription.end_time,
        header: t('End Time'),
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
          const subscription = row.original.subscription
          const plan = planMap.get(subscription.plan_id)
          // 滚动窗口模型：逐窗口渲染 used/total；全部窗口额度 0 = 无限。
          const rows = buildLimitRows({ subscription, plan }, t)
          if (rows.length === 0) {
            return (
              <span className='text-muted-foreground'>{t('Unlimited')}</span>
            )
          }
          return (
            <div className='space-y-0.5'>
              {rows.map((r) => (
                <div key={r.rowKey} className='text-xs text-muted-foreground'>
                  {r.label}: {formatQuota(r.used)}/{formatQuota(r.total)}
                </div>
              ))}
            </div>
          )
        },
        size: 150,
      },
    ],
    [t, planMap]
  )
}
