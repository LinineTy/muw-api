// @muw-owned
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import { GroupBadge } from '@/components/group-badge'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatTimestamp } from '../lib'
import type { AdminGroupPin, AdminGroupPinProduct } from '../api'

/**
 * 固定分组商品表列（管理端）：与订阅套餐表同风格
 * （价格 emerald、状态 StatusBadge、操作列右对齐）。
 */
export function useGroupPinProductColumns(callbacks: {
  onEdit: (product: AdminGroupPinProduct) => void
  onDelete: (product: AdminGroupPinProduct) => void
}): ColumnDef<AdminGroupPinProduct>[] {
  const { t } = useTranslation()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencySymbol =
    currencyMeta.kind === 'tokens' ? '$' : currencyMeta.symbol

  return useMemo(
    (): ColumnDef<AdminGroupPinProduct>[] => [
      {
        accessorFn: (row) => row.title,
        id: 'title',
        header: t('Title'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='max-w-full min-w-0'>
            <span className='truncate font-medium'>
              {row.original.title}
            </span>
          </div>
        ),
        size: 180,
      },
      {
        accessorFn: (row) => row.group,
        id: 'group',
        header: t('Group'),
        cell: ({ row }) => <GroupBadge group={row.original.group} />,
        size: 120,
      },
      {
        accessorFn: (row) => row.price_amount,
        id: 'price',
        header: t('Price'),
        cell: ({ row }) => (
          <span className='font-semibold text-emerald-600'>
            {currencySymbol}
            {Number(row.original.price_amount || 0).toFixed(2)}
          </span>
        ),
        size: 100,
      },
      {
        accessorFn: (row) => (row.enabled ? 1 : 0),
        id: 'enabled',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) =>
          row.original.enabled ? (
            <StatusBadge
              label={t('Enable')}
              variant='success'
              copyable={false}
              className='-ml-1.5'
            />
          ) : (
            <StatusBadge
              label={t('Disable')}
              variant='neutral'
              copyable={false}
              className='-ml-1.5'
            />
          ),
        size: 90,
      },
      {
        id: 'actions',
        header: t('Actions'),
        enableSorting: false,
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <div className='flex justify-end gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => callbacks.onEdit(row.original)}
            >
              {t('Edit')}
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() => callbacks.onDelete(row.original)}
            >
              {t('Delete')}
            </Button>
          </div>
        ),
        size: 120,
      },
    ],
    [t, currencySymbol, callbacks]
  )
}

/**
 * 用户钉子表列（管理端）：ID/用户/分组/来源/状态/创建时间/操作，服务端分页。
 */
export function useGroupPinColumns(callbacks: {
  onRelease: (pin: AdminGroupPin) => void
}): ColumnDef<AdminGroupPin>[] {
  const { t } = useTranslation()

  return useMemo(
    (): ColumnDef<AdminGroupPin>[] => [
      {
        accessorFn: (row) => row.id,
        id: 'id',
        header: t('ID'),
        meta: { mobileHidden: true },
        cell: ({ row }) => <TableId value={row.original.id} />,
        size: 70,
      },
      {
        accessorFn: (row) => row.user_id,
        id: 'user_id',
        header: t('User ID'),
        meta: { mobileTitle: true },
        cell: ({ row }) => <TableId value={row.original.user_id} />,
        size: 100,
      },
      {
        accessorFn: (row) => row.group,
        id: 'group',
        header: t('Group'),
        cell: ({ row }) => <GroupBadge group={row.original.group} />,
        size: 120,
      },
      {
        accessorFn: (row) => row.source,
        id: 'source',
        header: t('Source'),
        meta: { mobileHidden: true },
        cell: ({ row }) => <TableId value={row.original.source} />,
        size: 110,
      },
      {
        accessorFn: (row) => row.status,
        id: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) =>
          row.original.status === 'active' ? (
            <StatusBadge
              label={t('Active')}
              variant='success'
              copyable={false}
              className='-ml-1.5'
            />
          ) : (
            <StatusBadge
              label={row.original.status}
              variant='neutral'
              copyable={false}
              className='-ml-1.5'
            />
          ),
        size: 90,
      },
      {
        accessorFn: (row) => row.created_at,
        id: 'created_at',
        header: t('Created At'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {formatTimestamp(row.original.created_at)}
          </span>
        ),
        size: 150,
      },
      {
        id: 'actions',
        header: t('Actions'),
        enableSorting: false,
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <div className='flex justify-end'>
            {row.original.status === 'active' && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => callbacks.onRelease(row.original)}
              >
                {t('Unpin')}
              </Button>
            )}
          </div>
        ),
        size: 90,
      },
    ],
    [t, callbacks]
  )
}

