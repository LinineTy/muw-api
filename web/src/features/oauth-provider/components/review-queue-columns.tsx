// @muw-owned
import type { ColumnDef } from '@tanstack/react-table'
import { Check, Power, PowerOff, Trash2, X } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { TruncatedCell } from '@/components/data-table'
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

export function useReviewQueueColumns(options: {
  busy: boolean
  onApprove: (application: OAuthApplication) => void
  onReject: (application: OAuthApplication) => void
  onToggleStatus: (application: OAuthApplication) => void
  onDelete: (application: OAuthApplication) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { busy, onApprove, onReject, onToggleStatus, onDelete } = options

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
        accessorKey: 'owner_username',
        header: t('Requested by'),
        meta: { label: t('Requested by') },
        cell: ({ row }) => (
          <span className='text-xs'>{row.original.owner_username || '-'}</span>
        ),
      },
      {
        accessorKey: 'redirect_uris',
        header: t('Redirect URIs'),
        meta: { label: t('Redirect URIs') },
        cell: ({ row }) => (
          <TruncatedCell
            cellClassName='max-w-64'
            tooltipContent={
              <span className='flex flex-col gap-1'>
                {row.original.redirect_uris.map((uri) => (
                  <span key={uri} className='font-mono text-xs'>
                    {uri}
                  </span>
                ))}
              </span>
            }
          >
            <span className='font-mono text-xs'>
              {row.original.redirect_uris.join(' ')}
            </span>
          </TruncatedCell>
        ),
      },
      {
        accessorKey: 'created_at',
        header: t('Created'),
        meta: { label: t('Created') },
        cell: ({ row }) => (
          <TimestampCell
            timestamp={row.original.created_at}
            locale={locale}
            justNowLabel={t('Just now')}
          />
        ),
      },
      {
        id: 'actions',
        header: () => null,
        enableHiding: false,
        meta: { label: t('Actions') },
        cell: ({ row }) => (
          <div className='-ml-1.5 flex items-center gap-1'>
            {row.original.status === 'pending' ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        disabled={busy}
                        aria-label={t('Approve as applied')}
                        className='text-success hover:text-success'
                        onClick={() => onApprove(row.original)}
                      />
                    }
                  >
                    <Check />
                  </TooltipTrigger>
                  <TooltipContent>{t('Approve as applied')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        disabled={busy}
                        aria-label={t('Reject')}
                        onClick={() => onReject(row.original)}
                      />
                    }
                  >
                    <X />
                  </TooltipTrigger>
                  <TooltipContent>{t('Reject')}</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      disabled={busy}
                      aria-label={
                        row.original.status === 'approved'
                          ? t('Disable')
                          : t('Enable')
                      }
                      onClick={() => onToggleStatus(row.original)}
                    />
                  }
                >
                  {row.original.status === 'approved' ? (
                    <PowerOff />
                  ) : (
                    <Power />
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {row.original.status === 'approved'
                    ? t('Disable')
                    : t('Enable')}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    disabled={busy}
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
    [t, locale, busy, onApprove, onReject, onToggleStatus, onDelete]
  )
}
