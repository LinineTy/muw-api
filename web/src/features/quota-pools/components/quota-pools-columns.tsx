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
import { type ColumnDef } from '@tanstack/react-table'
import { Pencil, Power, PowerOff, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BadgeCell } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import { formatQuota } from '@/lib/format'

import {
  QUOTA_POOL_BALANCE_MODE_OPTIONS,
  QUOTA_POOL_PERIOD_OPTIONS,
} from '../constants'
import type { QuotaPool } from '../types'
import { useQuotaPools } from './quota-pools-provider'

export function useQuotaPoolsColumns(): ColumnDef<QuotaPool>[] {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow } = useQuotaPools()

  return useMemo(
    (): ColumnDef<QuotaPool>[] => [
      {
        accessorFn: (row) => row.id,
        id: 'id',
        header: t('ID'),
        meta: { mobileHidden: true },
        cell: ({ row }) => <TableId value={row.original.id} />,
        size: 60,
      },
      {
        accessorFn: (row) => row.name,
        id: 'name',
        header: t('Name'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>{row.original.name}</div>
            {row.original.description && (
              <div className='text-muted-foreground truncate text-xs'>
                {row.original.description}
              </div>
            )}
          </div>
        ),
        size: 200,
      },
      {
        accessorFn: (row) => row.enabled,
        id: 'enabled',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) =>
          row.original.enabled ? (
            <StatusBadge
              label={t('Enable')}
              variant='success'
              copyable={false}
            />
          ) : (
            <StatusBadge
              label={t('Disable')}
              variant='neutral'
              copyable={false}
            />
          ),
        size: 80,
      },
      {
        accessorFn: (row) => row.period,
        id: 'period',
        header: t('Period'),
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {t(QUOTA_POOL_PERIOD_OPTIONS[row.original.period].labelKey)}
          </span>
        ),
        size: 90,
      },
      {
        id: 'amount',
        header: t('Amount'),
        cell: ({ row }) => {
          const pool = row.original
          if (pool.amount_type === 'random') {
            return (
              <span className='text-muted-foreground'>
                {formatQuota(pool.min_amount)} - {formatQuota(pool.max_amount)}
              </span>
            )
          }
          return <span className='font-medium'>{formatQuota(pool.amount)}</span>
        },
        size: 130,
      },
      {
        id: 'caps',
        header: t('Caps'),
        cell: ({ row }) => {
          const pool = row.original
          return (
            <div className='text-muted-foreground text-xs'>
              <div>
                {t('Pool')}: {pool.pool_period_cap > 0 ? formatQuota(pool.pool_period_cap) : '∞'}
              </div>
              <div>
                {t('User')}: {pool.user_period_cap > 0 ? formatQuota(pool.user_period_cap) : '∞'}
              </div>
              <div>
                {t('Times')}: {pool.user_period_count_limit > 0 ? pool.user_period_count_limit : '∞'}
              </div>
            </div>
          )
        },
        size: 140,
      },
      {
        id: 'balance',
        header: t('Balance Rule'),
        cell: ({ row }) => {
          const pool = row.original
          if (pool.balance_mode === 'off') {
            return <span className='text-muted-foreground'>{t('Disabled')}</span>
          }
          return (
            <BadgeCell>
              <StatusBadge
                label={`${t(QUOTA_POOL_BALANCE_MODE_OPTIONS[pool.balance_mode].labelKey)} · ${formatQuota(pool.balance_limit)}`}
                variant='neutral'
                copyable={false}
              />
            </BadgeCell>
          )
        },
        size: 150,
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => {
          const pool = row.original
          const toggleLabel = pool.enabled ? t('Disable') : t('Enable')
          return (
            <div className='flex items-center gap-1'>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('Edit')}
                onClick={() => {
                  setCurrentRow(pool)
                  setOpen('update')
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={toggleLabel}
                onClick={() => {
                  setCurrentRow(pool)
                  setOpen('update')
                }}
              >
                {pool.enabled ? <PowerOff /> : <Power />}
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('Delete')}
                className='text-destructive hover:text-destructive'
                onClick={() => {
                  setCurrentRow(pool)
                  setOpen('delete')
                }}
              >
                <Trash2 />
              </Button>
            </div>
          )
        },
        meta: { pinned: 'right' as const },
      },
    ],
    [t, setOpen, setCurrentRow]
  )
}
