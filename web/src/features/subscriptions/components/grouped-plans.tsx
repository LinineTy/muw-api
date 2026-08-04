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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { formatDuration, formatResetPeriod } from '../lib'
import type { PlanRecord } from '../types'
import { DataTableRowActions } from './data-table-row-actions'

function AdminGroupPlanCard({ plan }: { plan: PlanRecord }) {
  const { t } = useTranslation()
  const p = plan.plan
  const totalAmount = Number(p.total_amount || 0)
  return (
    <div className='bg-card flex flex-col gap-2 rounded-xl border p-3'>
      <div className='flex items-center justify-between gap-2'>
        <span className='min-w-0 truncate text-sm font-medium'>
          {p.title}
        </span>
        <span className='flex shrink-0 items-center gap-1'>
          {p.enabled ? (
            <StatusBadge
              label={t('Enable')}
              variant='success'
              copyable={false}
              className='shrink-0'
            />
          ) : (
            <StatusBadge
              label={t('Disable')}
              variant='neutral'
              copyable={false}
              className='shrink-0'
            />
          )}
        </span>
      </div>
      <div className='flex items-baseline gap-1.5'>
        <span className='text-primary text-lg font-bold'>
          ${Number(p.price_amount || 0).toFixed(2)}
        </span>
        <span className='text-muted-foreground text-xs'>
          {formatDuration(p, t)}
        </span>
      </div>
      <div className='text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1 text-xs'>
        <span>
          {t('Plan Quota')}:{' '}
          {totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')}
        </span>
        <span>
          {t('Quota Reset')}: {formatResetPeriod(p, t)}
        </span>
        <span>
          {t('Plan Tier')}: {p.priority ?? 0}
        </span>
        <span>
          {t('Sort Order')}: {p.sort_order}
        </span>
      </div>
      <div className='flex justify-end'>
        <DataTableRowActions plan={plan} />
      </div>
    </div>
  )
}

function AdminGroupCard({
  group,
  plans,
}: {
  group: string
  plans: PlanRecord[]
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  return (
    <div className='rounded-xl border bg-card'>
      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        className='flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left'
      >
        <span className='flex min-w-0 items-center gap-2'>
          <GroupBadge group={group} />
          <span className='text-muted-foreground shrink-0 text-xs'>
            {t('{{count}} plans', { count: plans.length })}
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
        <div className='grid grid-cols-1 gap-2 border-t p-3 sm:grid-cols-2'>
          {plans.map((p) => (
            <AdminGroupPlanCard key={p.plan.id} plan={p} />
          ))}
        </div>
      )}
    </div>
  )
}

// 管理端「分组显示」开启后的视图：互斥组各占一个独立容器卡片（一格一组、可折叠，
// 折叠后只剩组名一条），无互斥组的套餐单独列出。每个套餐带管理操作按钮。
export function GroupedPlansList({ plans }: { plans: PlanRecord[] }) {
  const { t } = useTranslation()

  const { groups, standalone } = useMemo(() => {
    const groupMap = new Map<string, PlanRecord[]>()
    const standalone: PlanRecord[] = []
    for (const p of plans) {
      const group = p?.plan?.exclusive_group
      if (!group) {
        standalone.push(p)
      } else {
        const list = groupMap.get(group)
        if (list) {
          list.push(p)
        } else {
          groupMap.set(group, [p])
        }
      }
    }
    return { groups: [...groupMap.entries()], standalone }
  }, [plans])

  if (plans.length === 0) return null

  return (
    <div className='flex-1 space-y-3 overflow-y-auto'>
      {groups.map(([group, groupPlans]) => (
        <AdminGroupCard key={group} group={group} plans={groupPlans} />
      ))}
      {standalone.length > 0 && (
        <div className='rounded-xl border bg-card'>
          <div className='text-muted-foreground px-3 py-2.5 text-sm font-medium'>
            {t('Standalone plans')}
          </div>
          <div className='grid grid-cols-1 gap-2 border-t p-3 sm:grid-cols-2'>
            {standalone.map((p) => (
              <AdminGroupPlanCard key={p.plan.id} plan={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
