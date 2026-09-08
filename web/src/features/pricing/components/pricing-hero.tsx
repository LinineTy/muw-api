// @muw-owned
import { useTranslation } from 'react-i18next'

import { EXCLUDED_GROUPS } from '../constants'

export interface PricingHeroProps {
  modelCount: number
  vendorCount: number
  groups: Record<string, unknown>
}

/**
 * Compact rankings-style hero: left-aligned title + live stats subtitle.
 * No gradient banner, no centered marketing copy.
 */
export function PricingHero(props: PricingHeroProps) {
  const { t } = useTranslation()

  const groupCount = Object.keys(props.groups).filter(
    (g) => !EXCLUDED_GROUPS.includes(g)
  ).length

  return (
    <header className='space-y-1.5'>
      <h1 className='text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.15] font-bold tracking-tight'>
        {t('Model Square')}
      </h1>
      <p className='text-muted-foreground text-[13px]'>
        {t('{{models}} models · {{vendors}} vendors · {{groups}} groups', {
          models: props.modelCount,
          vendors: props.vendorCount,
          groups: groupCount,
        })}
      </p>
    </header>
  )
}
