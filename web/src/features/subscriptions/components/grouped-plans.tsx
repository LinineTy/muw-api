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
import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Row } from '@tanstack/react-table'

import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

import type { PlanRecord } from '../types'
import { GroupCollapsibleSection } from './group-collapsible-section'
import { PlanCard } from './plan-card'

// 与未分组时表格卡片视图保持一致的网格（与渠道/模型卡片同密度）。
const CARD_GRID_CLASS = 'sm:gap-4 lg:grid-cols-3'
// DataTableCardGrid 给每张 renderCard 包的外框，分组视图复用保持一致。
const CARD_FRAME_CLASS =
  'rounded-lg border bg-(--data-table-card-bg,var(--table-row)) px-3 py-2.5'

// 管理端「分组显示」开启后的视图：互斥组按组名分组，组名一行可折叠，组内复用
// 未分组时同款的 PlanCard（原样卡片），组与组之间用分割线隔开；无互斥组的套餐
// 在「单独的订阅」下单独列出。
export function GroupedPlansList({ rows }: { rows: Row<PlanRecord>[] }) {
  const { t } = useTranslation()

  const { groups, standalone } = useMemo(() => {
    const groupMap = new Map<string, Row<PlanRecord>[]>()
    const standalone: Row<PlanRecord>[] = []
    for (const row of rows) {
      const group = row.original.plan?.exclusive_group
      if (!group) {
        standalone.push(row)
      } else {
        const list = groupMap.get(group)
        if (list) {
          list.push(row)
        } else {
          groupMap.set(group, [row])
        }
      }
    }
    return { groups: [...groupMap.entries()], standalone }
  }, [rows])

  if (rows.length === 0) return null

  return (
    <div className='flex-1 space-y-2 overflow-y-auto'>
      {groups.map(([group, groupRows], index) => (
        <Fragment key={group}>
          {index > 0 && <Separator />}
          <GroupCollapsibleSection
            group={group}
            count={groupRows.length}
            contentClassName={CARD_GRID_CLASS}
          >
            {groupRows.map((row) => (
              <div key={row.id} className={CARD_FRAME_CLASS}>
                <PlanCard row={row} isSelected={false} />
              </div>
            ))}
          </GroupCollapsibleSection>
        </Fragment>
      ))}
      {standalone.length > 0 && (
        <>
          <Separator />
          <div>
            <div className='text-muted-foreground px-2 py-1.5 text-sm font-medium'>
              {t('Standalone plans')}
            </div>
            <div className={cn('mt-3 grid grid-cols-1 gap-3', CARD_GRID_CLASS)}>
              {standalone.map((row) => (
                <div key={row.id} className={CARD_FRAME_CLASS}>
                  <PlanCard row={row} isSelected={false} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
