// @muw-owned
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { OAuthStats } from '../api'

export function OAuthStatsCards(props: {
  stats: OAuthStats
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const items = [
    { label: 'Applications', value: props.stats.applications },
    { label: 'Authorizations', value: props.stats.authorizations },
    { label: 'Tokens issued', value: props.stats.token_issued },
    { label: 'Active users', value: props.stats.active_users },
    { label: 'Calls', value: props.stats.calls },
    {
      label: 'Failed calls',
      value: props.stats.failed_calls,
      danger: props.stats.failed_calls > 0,
    },
  ]

  return (
    <div
      className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', props.className)}
    >
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className='py-3'>
            <p className='text-muted-foreground text-xs'>{t(item.label)}</p>
            <p
              className={cn(
                'text-xl font-semibold tabular-nums',
                item.danger && 'text-destructive'
              )}
            >
              {formatNumber(item.value, locale)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
