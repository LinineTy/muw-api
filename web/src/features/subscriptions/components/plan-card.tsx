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
import { flexRender, type Row } from '@tanstack/react-table'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'

import type { PlanRecord } from '../types'

/**
 * 订阅套餐卡片，用于表格的卡片视图。复用 subscriptions-columns.tsx 中每一列的
 * cell 渲染器（flexRender），保证表格与卡片的信息、交互完全一致：标题/副标题、
 * 价格、状态、支付渠道、配额、升级分组以及行内操作菜单。
 */
function PlanCardComponent({
  row,
  isSelected,
}: {
  row: Row<PlanRecord>
  isSelected: boolean
}) {
  const { t } = useTranslation()
  const plan = row.original.plan
  const cells = row.getAllCells()

  const renderCell = (id: string) => {
    const cell = cells.find((c) => c.column.id === id)
    if (!cell || !cell.column.columnDef.cell) {
      return null
    }
    return flexRender(cell.column.columnDef.cell, cell.getContext())
  }

  const idCell = renderCell('id')
  const titleCell = renderCell('title')
  const priceCell = renderCell('price')
  const durationCell = renderCell('duration')
  const resetCell = renderCell('reset')
  const quotaCell = renderCell('total_amount')
  const statusCell = renderCell('enabled')
  const paymentCell = renderCell('payment')
  const upgradeCell = renderCell('upgrade_group')
  const actionsCell = renderCell('actions')

  const labelClass = 'text-muted-foreground text-[11px] font-medium select-none'

  return (
    <div
      data-state={isSelected ? 'selected' : undefined}
      className='flex flex-col gap-3'
    >
      {/* 头部：ID + 标题/副标题 + 推荐徽标，右侧状态与操作 */}
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            {idCell}
            {plan.is_recommended && (
              <StatusBadge
                label={t('Recommended')}
                variant='warning'
                size='sm'
                copyable={false}
              />
            )}
          </div>
          <div className='min-w-0 overflow-hidden'>{titleCell}</div>
        </div>
        <div className='flex shrink-0 items-center gap-1.5'>
          {statusCell}
          {actionsCell}
        </div>
      </div>

      {/* 价格 + 有效期 */}
      <div className='flex items-baseline gap-2'>
        <span className='text-2xl font-bold text-emerald-600'>{priceCell}</span>
        <span className='text-muted-foreground text-sm'>{durationCell}</span>
      </div>

      {/* 元信息：配额 / 重置 / 支付渠道 / 升级分组 */}
      <div className='grid grid-cols-2 gap-x-4 gap-y-2'>
        <div className='min-w-0'>
          <div className={labelClass}>{t('Plan Quota')}</div>
          <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
            {quotaCell}
          </div>
        </div>
        <div className='min-w-0'>
          <div className={labelClass}>{t('Quota Reset')}</div>
          <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
            {resetCell}
          </div>
        </div>
        <div className='min-w-0'>
          <div className={labelClass}>{t('Payment Channel')}</div>
          <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
            {paymentCell}
          </div>
        </div>
        <div className='min-w-0'>
          <div className={labelClass}>{t('Upgrade Group')}</div>
          <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
            {upgradeCell}
          </div>
        </div>
      </div>

      {/* 底线：优先级（仅卡片视图展示） */}
      <div className='flex items-center gap-2 text-xs'>
        <span className={labelClass}>{t('Priority')}</span>
        <span className='text-muted-foreground'>{plan.sort_order}</span>
      </div>
    </div>
  )
}

/**
 * memo 化，仅当该卡片自身的 react-table row 引用变化时重渲染，
 * 避免父级表格状态（过滤、翻页、视图切换等）更新时所有卡片一起重渲染。
 */
export const PlanCard = memo(PlanCardComponent)
