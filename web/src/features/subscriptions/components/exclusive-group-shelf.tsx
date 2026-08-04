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
import { ChevronDown, Layers } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { cn } from '@/lib/utils'

import type { PlanRecord } from '../types'

function ShelfCell({ group, plans }: { group: string; plans: PlanRecord[] }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  return (
    <div className='bg-card flex flex-col overflow-hidden rounded-xl border'>
      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        className='flex w-full items-center justify-between gap-2 px-3 py-2 text-left'
      >
        <span className='flex min-w-0 items-center gap-2'>
          <GroupBadge group={group} />
          <span className='text-muted-foreground shrink-0 text-xs'>
            {plans.length}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 transition-transform',
            !expanded && '-rotate-90'
          )}
        />
      </button>
      {expanded && (
        <div className='space-y-1 border-t px-3 py-2'>
          {plans.map((p) => (
            <div
              key={p.plan.id}
              className='flex items-center justify-between gap-2 text-xs'
            >
              <span className='truncate text-sm'>{p.plan.title}</span>
              <span className='text-muted-foreground shrink-0'>
                ${Number(p.plan.price_amount || 0).toFixed(2)} ·{' '}
                {t('Plan Tier')} {p.plan.priority ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 管理端套餐列表顶部的互斥组书架：一格一组，组内套餐一目了然。只读展示，
// 无互斥组时不渲染。每个格子独立展开/折叠。
export function ExclusiveGroupShelf({ plans }: { plans: PlanRecord[] }) {
  const { t } = useTranslation()

  const groups = useMemo(() => {
    const map = new Map<string, PlanRecord[]>()
    for (const p of plans) {
      const group = p?.plan?.exclusive_group
      if (!group) continue
      const list = map.get(group)
      if (list) {
        list.push(p)
      } else {
        map.set(group, [p])
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [plans])

  if (groups.length === 0) return null

  return (
    <div className='space-y-2'>
      <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
        <Layers className='size-3.5' />
        {t('Mutual-exclusion groups')}
      </div>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {groups.map(([group, groupPlans]) => (
          <ShelfCell key={group} group={group} plans={groupPlans} />
        ))}
      </div>
    </div>
  )
}
