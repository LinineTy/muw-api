// @muw-owned
import type { ColumnDef } from '@tanstack/react-table'
import { Eye, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'

import type { OAuthApplication } from '../api'
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_VARIANTS,
} from '../constants'

export function useMyApplicationsColumns(options: {
  onDetails: (application: OAuthApplication) => void
  onDelete: (application: OAuthApplication) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { onDetails, onDelete } = options

  return useMemo<ColumnDef<OAuthApplication, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('Application name'),
        meta: { label: t('Application name'), mobileTitle: true },
        cell: ({ row }) => (
          <span className='font-medium'>{row.original.name}</span>
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
            className='-ml-1.5'
          />
        ),
      },
      {
        accessorKey: 'client_id',
        header: t('Client ID'),
        meta: { label: t('Client ID') },
        cell: ({ row }) => (
          <span className='font-mono text-xs'>{row.original.client_id}</span>
        ),
      },
      {
        accessorKey: 'last_used_at',
        header: t('Last Used'),
        meta: { label: t('Last Used') },
        cell: ({ row }) =>
          row.original.last_used_at > 0 ? (
            <TimestampCell
              timestamp={row.original.last_used_at}
              locale={locale}
              justNowLabel={t('Just now')}
            />
          ) : (
            <span className='text-muted-foreground text-xs'>
              {t('Never used')}
            </span>
          ),
      },
      {
        id: 'actions',
        header: () => null,
        enableHiding: false,
        meta: { label: t('Actions'), pinned: 'right' as const },
        cell: ({ row }) => (
          <div className='-ml-1.5 flex items-center gap-1'>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Details')}
                    onClick={() => onDetails(row.original)}
                  />
                }
              >
                <Eye />
              </TooltipTrigger>
              <TooltipContent>{t('Details')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Delete')}
                    className='text-destructive hover:text-destructive'
                    onClick={() => onDelete(row.original)}
                  />
                }
              >
                <Trash2 />
              </TooltipTrigger>
              <TooltipContent>{t('Delete')}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [t, locale, onDetails, onDelete]
  )
}
