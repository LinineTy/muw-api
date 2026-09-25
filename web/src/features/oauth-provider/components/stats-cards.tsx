// @muw-owned
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { OAuthStats } from '../api'

export function OAuthStatsCards(props: { stats: OAuthStats }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const items = [
    { label: 'Applications', value: props.stats.applications },
    { label: 'Authorizations', value: props.stats.authorizations },
    { label: 'Tokens issued', value: props.stats.token_issued },
    { label: 'Active users', value: props.stats.active_users },
  ]

  return (
    <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className='py-3'>
            <p className='text-muted-foreground text-xs'>{t(item.label)}</p>
            <p className='text-xl font-semibold tabular-nums'>
              {formatNumber(item.value, locale)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
