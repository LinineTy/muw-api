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
