// @muw-owned
import type { ColumnDef } from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'

import type { OAuthConsent } from '../api'
import { scopeTextList } from '../scopes'

export function useAuthorizationsColumns(options: {
  onToggleSilent: (consent: OAuthConsent, silent: boolean) => void
  onRevoke: (consent: OAuthConsent) => void
  silentPending: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { onToggleSilent, onRevoke, silentPending } = options

  return useMemo<ColumnDef<OAuthConsent, unknown>[]>(
    () => [
      {
        accessorKey: 'client_name',
        header: t('Application name'),
        meta: { label: t('Application name'), mobileTitle: true },
        cell: ({ row }) => (
          <span className='font-medium'>{row.original.client_name}</span>
        ),
      },
      {
        accessorKey: 'scopes',
        header: t('Requested scopes'),
        meta: { label: t('Requested scopes') },
        cell: ({ row }) => (
          <span className='text-muted-foreground text-xs'>
            {scopeTextList(row.original.scopes, t).join(' · ')}
          </span>
        ),
      },
      {
        accessorKey: 'silent',
        header: t('Do not ask me again'),
        meta: { label: t('Do not ask me again'), mobileBadge: true },
        cell: ({ row }) => (
          <Switch
            checked={row.original.silent}
            disabled={silentPending}
            aria-label={t('Do not ask me again')}
            onCheckedChange={(checked) => onToggleSilent(row.original, checked)}
          />
        ),
      },
      {
        accessorKey: 'updated_at',
        header: t('Last Used'),
        meta: { label: t('Last Used') },
        cell: ({ row }) => (
          <TimestampCell
            timestamp={row.original.updated_at}
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Revoke')}
                    className='text-destructive hover:text-destructive'
                    onClick={() => onRevoke(row.original)}
                  />
                }
              >
                <Trash2 />
              </TooltipTrigger>
              <TooltipContent>{t('Revoke')}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [t, locale, onToggleSilent, onRevoke, silentPending]
  )
}
