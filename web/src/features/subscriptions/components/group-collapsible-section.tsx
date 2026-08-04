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
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

// 互斥组的扁平分组：组名一行可折叠（带箭头），不套容器卡片，组内套餐卡片原样铺开。
// 组与组之间的分割线由父级用 <Separator /> 处理。管理端分组视图与用户套餐目录共用。
export function GroupCollapsibleSection({
  group,
  count,
  children,
  contentClassName,
}: {
  group: string
  count: number
  children: ReactNode
  contentClassName?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <button
            type='button'
            data-press-scale='false'
            className='hover:bg-muted/40 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors'
          />
        }
      >
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
            !open && '-rotate-90'
          )}
        />
        <GroupBadge group={group} />
        <span className='text-muted-foreground shrink-0 text-xs'>
          {t('{{count}} plans', { count })}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className='h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-starting-style:h-0 data-ending-style:h-0'>
        <div className={cn('grid grid-cols-1 gap-3 pt-3 pb-3', contentClassName)}>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
