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

import { GroupBadge } from '@/components/group-badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
 *
 * Collapse interaction mirrors subscriptions' GroupCollapsibleSection:
 * height-transitioned Collapsible + lightweight hover-only group header.
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
    <div className='space-y-3'>
      {sections.map((section, index) => {
        // Before the first manual toggle, collapse everything except the first group.
        const isCollapsed = collapsed
          ? collapsed.has(section.group)
          : index > 0
        return (
          <Collapsible
            key={section.group}
            open={!isCollapsed}
            onOpenChange={() => toggleGroup(section.group)}
          >
            <CollapsibleTrigger
              render={
                <button
                  type='button'
                  data-press-scale='false'
                  aria-label={section.group}
                  className='hover:bg-muted/40 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors'
                />
              }
            >
              <ChevronDown
                className={cn(
                  'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
                  isCollapsed && '-rotate-90'
                )}
              />
              <GroupBadge group={section.group} ratio={section.ratio} />
              <span className='text-muted-foreground shrink-0 text-xs'>
                {t('{{count}} models', { count: section.models.length })}
              </span>
              {section.desc && (
                <span className='text-muted-foreground/75 hidden min-w-0 truncate text-xs sm:inline'>
                  · {section.desc}
                </span>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className='h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-starting-style:h-0 data-ending-style:h-0'>
              <div className='grid grid-cols-1 gap-3 pt-3 pb-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'>
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
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}
