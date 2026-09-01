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
import { ChevronDown } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { EXCLUDED_GROUPS } from '../constants'
import type { PricingModel } from '../types'
import { ModelCard } from './model-card'

export interface GroupTreeProps {
  models: PricingModel[]
  autoGroups: string[]
  groupRatio: Record<string, number>
  usableGroup: Record<string, { desc: string; ratio: number }>
  onModelClick: (modelName: string) => void
  tokenUnit?: 'M' | 'K'
  showRechargePrice?: boolean
  priceRate?: number
  usdExchangeRate?: number
}

/**
 * Grouped pricing tree: models are listed under every group they belong to
 * (full-duplication mode) so each group shows its real effective prices.
 * Groups are ordered by the auto-group chain first, then any remaining groups.
 */
export function GroupTree(props: GroupTreeProps) {
  const { t } = useTranslation()
  // null = not yet interacted: only the first group is expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null)

  const sections = useMemo(() => {
    const chainOrder = props.autoGroups.filter(
      (g) => !EXCLUDED_GROUPS.includes(g)
    )
    const rest = new Set<string>()
    for (const model of props.models) {
      for (const g of model.enable_groups || []) {
        if (
          !EXCLUDED_GROUPS.includes(g) &&
          !chainOrder.includes(g) &&
          props.groupRatio[g] !== undefined
        ) {
          rest.add(g)
        }
      }
    }
    const allGroups = [...chainOrder, ...Array.from(rest).sort()]

    return allGroups
      .map((group) => ({
        group,
        ratio: props.groupRatio[group] ?? 1,
        desc: props.usableGroup[group]?.desc,
        models: props.models.filter((m) =>
          (m.enable_groups || []).includes(group)
        ),
      }))
      .filter((section) => section.models.length > 0)
  }, [props.models, props.autoGroups, props.groupRatio, props.usableGroup])

  const toggleGroup = useCallback((group: string) => {
    setCollapsed((prev) => {
      const base = prev ?? new Set<string>()
      const next = new Set(base)
      if (next.has(group)) {
        next.delete(group)
      } else {
        next.add(group)
      }
      return next
    })
  }, [])

  if (sections.length === 0) {
    return (
      <div className='text-muted-foreground/60 py-16 text-center text-sm'>
        {t('No matching models in any group')}
      </div>
    )
  }

  return (
    <div className='space-y-5'>
      {sections.map((section, index) => {
        // Before the first manual toggle, collapse everything except the first group.
        const isCollapsed = collapsed
          ? collapsed.has(section.group)
          : index > 0
        return (
          <section
            key={section.group}
            aria-label={section.group}
            className='border-border/60 border-b pb-5 last:border-b-0'
          >
            <Button
              variant='ghost'
              size='sm'
              onClick={() => toggleGroup(section.group)}
              aria-expanded={!isCollapsed}
              className='text-foreground hover:bg-muted/40 mb-2.5 h-auto w-full justify-start gap-2 px-0 py-1'
            >
              <ChevronDown
                className={cn(
                  'text-muted-foreground/70 size-3.5 shrink-0 transition-transform',
                  isCollapsed && '-rotate-90'
                )}
              />
              <span className='font-mono text-sm font-semibold'>
                {section.group}
              </span>
              <span className='text-primary/80 font-mono text-[11px] font-medium'>
                ×{section.ratio}
              </span>
              <span className='text-muted-foreground/90 text-xs font-normal'>
                {t('{{count}} models', { count: section.models.length })}
              </span>
              {section.desc && (
                <span className='text-muted-foreground/75 hidden text-xs font-normal sm:inline'>
                  · {section.desc}
                </span>
              )}
            </Button>

            {!isCollapsed && (
              <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3'>
                {section.models.map((model) => (
                  <ModelCard
                    key={`${section.group}-${model.model_name}`}
                    model={model}
                    group={section.group}
                    onClick={() => props.onModelClick(model.model_name)}
                    tokenUnit={props.tokenUnit}
                    showRechargePrice={props.showRechargePrice}
                    priceRate={props.priceRate}
                    usdExchangeRate={props.usdExchangeRate}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
