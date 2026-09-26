// @muw-owned
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'

import type { OAuthAccessLog } from '../api'
import { ACCESS_LOG_ACTION_LABELS } from '../constants'

/** 调用明细的列：谁（应用/用户）、干了什么、从哪来（IP/UA）、成没成。 */
export function useAccessLogsColumns() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return useMemo<ColumnDef<OAuthAccessLog, unknown>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        meta: { label: t('Time'), mobileTitle: true },
        cell: ({ row }) => (
          <TimestampCell
            timestamp={row.original.created_at}
            locale={locale}
            justNowLabel={t('Just now')}
          />
        ),
      },
      {
        accessorKey: 'action',
        header: t('Action'),
        meta: { label: t('Action') },
        cell: ({ row }) => (
          <span className='font-medium'>
            {t(
              ACCESS_LOG_ACTION_LABELS[row.original.action] ??
                row.original.action
            )}
            {row.original.grant_type ? (
              <span className='text-muted-foreground font-normal'>
                {' · '}
                {row.original.grant_type}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'client_id',
        header: t('Application'),
        meta: { label: t('Application'), mobileBadge: true },
        cell: ({ row }) => (
          <div className='flex flex-col gap-0.5'>
            <span className='truncate text-xs'>
              {row.original.client_name || row.original.client_id || '—'}
            </span>
            <span
              className='text-muted-foreground truncate font-mono text-xs'
              title={row.original.client_id}
            >
              {row.original.client_id || '—'}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'user_id',
        header: t('User ID'),
        meta: { label: t('User ID') },
        cell: ({ row }) =>
          row.original.user_id > 0 ? (
            <span className='font-mono text-xs'>{row.original.user_id}</span>
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        accessorKey: 'ip',
        header: t('IP address'),
        meta: { label: t('IP address') },
        cell: ({ row }) => (
          <span className='font-mono text-xs'>{row.original.ip || '—'}</span>
        ),
      },
      {
        accessorKey: 'user_agent',
        header: t('User agent'),
        meta: { label: t('User agent') },
        cell: ({ row }) => (
          <span
            className='text-muted-foreground block max-w-[18rem] truncate text-xs'
            title={row.original.user_agent}
          >
            {row.original.user_agent || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'scopes',
        header: t('Scopes'),
        meta: { label: t('Scopes') },
        cell: ({ row }) => (
          <span
            className='text-muted-foreground block max-w-[16rem] truncate text-xs'
            title={row.original.scopes}
          >
            {row.original.scopes || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'success',
        header: t('Result'),
        meta: { label: t('Result') },
        cell: ({ row }) =>
          row.original.success ? (
            <StatusBadge
              label={t('Success')}
              variant='success'
              copyable={false}
            />
          ) : (
            <StatusBadge
              label={row.original.error_code || t('Failed')}
              variant='danger'
              copyable={false}
            />
          ),
      },
      {
        accessorKey: 'error_message',
        header: t('Reason'),
        meta: { label: t('Reason') },
        cell: ({ row }) => (
          <span
            className='text-muted-foreground block max-w-[18rem] truncate text-xs'
            title={row.original.error_message}
          >
            {row.original.error_message || '—'}
          </span>
        ),
      },
    ],
    [t, locale]
  )
}
