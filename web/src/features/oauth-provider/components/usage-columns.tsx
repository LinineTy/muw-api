// @muw-owned
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { OAuthUsageApplication } from '../api'
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_VARIANTS,
} from '../constants'

/** 按应用聚合的用量列：应用 / 调用 / 失败 / 使用人数 / 最近调用。 */
export function useUsageColumns() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return useMemo<ColumnDef<OAuthUsageApplication, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('Application'),
        meta: { label: t('Application'), mobileTitle: true },
        cell: ({ row }) => (
          <div className='flex flex-col gap-0.5'>
            <span className='truncate font-medium'>{row.original.name}</span>
            <span
              className='text-muted-foreground truncate font-mono text-xs'
              title={row.original.client_id}
            >
              {row.original.client_id}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        meta: { label: t('Status'), mobileBadge: true },
        cell: ({ row }) => (
          <StatusBadge
            label={t(
              APPLICATION_STATUS_LABELS[row.original.status] ??
                row.original.status
            )}
            variant={
              APPLICATION_STATUS_VARIANTS[row.original.status] ?? 'neutral'
            }
            copyable={false}
          />
        ),
      },
      {
        accessorKey: 'calls',
        header: t('Calls'),
        meta: { label: t('Calls') },
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatNumber(row.original.calls, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'failed_calls',
        header: t('Failed calls'),
        meta: { label: t('Failed calls') },
        cell: ({ row }) => (
          <span
            className={
              row.original.failed_calls > 0
                ? 'text-destructive tabular-nums'
                : 'tabular-nums'
            }
          >
            {formatNumber(row.original.failed_calls, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'active_users',
        header: t('Active users'),
        meta: { label: t('Active users') },
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatNumber(row.original.active_users, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'last_call_at',
        header: t('Last used'),
        meta: { label: t('Last used') },
        cell: ({ row }) =>
          row.original.last_call_at > 0 ? (
            <TimestampCell
              timestamp={row.original.last_call_at}
              locale={locale}
              justNowLabel={t('Just now')}
            />
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
    ],
    [t, locale]
  )
}
