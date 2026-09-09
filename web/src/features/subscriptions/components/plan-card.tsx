// @muw-owned
import { flexRender, type Row } from '@tanstack/react-table'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'

import type { PlanRecord } from '../types'

/**
 * 订阅套餐 / 固定分组商品卡片，用于表格的卡片视图。复用 subscriptions-columns.tsx
 * 中每一列的 cell 渲染器（flexRender），保证表格与卡片的信息、交互完全一致：
 * 标题/副标题、价格、状态、支付渠道、配额、升级分组以及行内操作菜单。
 * 固定分组商品没有时长/额度/互斥组，这些字段按 kind 隐藏。
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
  const isGroupPin = row.original.kind === 'group_pin'
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
  const statusCell = renderCell('enabled')
  const paymentCell = renderCell('payment')
  const upgradeCell = renderCell('upgrade_group')
  const exclusiveCell = renderCell('exclusive_group')
  const limitsCell = renderCell('limits')
  const maxDurationCell = renderCell('max_duration')
  const allowedGroupsCell = renderCell('allowed_groups')
  const actionsCell = renderCell('actions')

  const labelClass = 'text-muted-foreground text-[11px] font-medium select-none'

  return (
    <div
      data-state={isSelected ? 'selected' : undefined}
      className='flex flex-col gap-3'
    >
      {/* 头部：ID + 类型/推荐徽标 + 标题/副标题，右侧状态与操作 */}
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            {idCell}
            {isGroupPin && (
              <StatusBadge
                label={t('Fixed Groups')}
                variant='info'
                size='sm'
                copyable={false}
              />
            )}
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

      {/* 价格 + 有效期（固定分组无时长，只显示价格） */}
      <div className='flex items-baseline gap-2'>
        <span className='text-2xl font-bold text-emerald-600'>{priceCell}</span>
        {!isGroupPin && (
          <span className='text-muted-foreground text-sm'>{durationCell}</span>
        )}
      </div>

      {/* 元信息：支付渠道 / 目标分组 / 白名单；套餐额外展示重置与额度 */}
      <div className='grid grid-cols-2 gap-x-4 gap-y-2'>
        {!isGroupPin && (
          <div className='min-w-0'>
            <div className={labelClass}>{t('Quota Reset')}</div>
            <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
              {resetCell}
            </div>
          </div>
        )}
        <div className='min-w-0'>
          <div className={labelClass}>{t('Payment Channel')}</div>
          <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
            {paymentCell}
          </div>
        </div>
        <div className='min-w-0'>
          <div className={labelClass}>
            {isGroupPin ? t('Pinned Group') : t('Upgrade Group')}
          </div>
          <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
            {upgradeCell}
          </div>
        </div>
        {!isGroupPin && (
          <div className='min-w-0'>
            <div className={labelClass}>{t('Exclusive Group')}</div>
            <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
              {exclusiveCell}
            </div>
          </div>
        )}
        {!isGroupPin && (
          <div className='min-w-0'>
            <div className={labelClass}>{t('Quota Limits')}</div>
            <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
              {limitsCell}
            </div>
          </div>
        )}
        {!isGroupPin && (
          <div className='min-w-0'>
            <div className={labelClass}>{t('Max Duration')}</div>
            <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
              {maxDurationCell}
            </div>
          </div>
        )}
        <div className='min-w-0'>
          <div className={labelClass}>{t('Allowed Groups')}</div>
          <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
            {allowedGroupsCell}
          </div>
        </div>
      </div>

      {/* 底线：套餐档位（固定分组商品无档位概念） */}
      {!isGroupPin && (
        <div className='flex items-center gap-2 text-xs'>
          <span className={labelClass}>{t('Plan Tier')}</span>
          <span className='text-muted-foreground'>{plan.priority ?? 0}</span>
        </div>
      )}
    </div>
  )
}

/**
 * memo 化，仅当该卡片自身的 react-table row 引用变化时重渲染，
 * 避免父级表格状态（过滤、翻页、视图切换等）更新时所有卡片一起重渲染。
 */
export const PlanCard = memo(PlanCardComponent)
