// @muw-owned
import { flexRender, type Row } from '@tanstack/react-table'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { AccountListItem } from '../types'

/**
 * 账户卡片：表格视图的列 cell 全部复用（flexRender），信息与交互保持一致。
 *
 * 2026-09-11 重排（此前卡片上半部分大片空白：名称/密钥/被引用渠道都挤在左侧，右侧全空）：
 * 名称行（名称 + 自动徽标 + 行操作）→ 属性行（类型 · 状态 · 余额 一行平铺）→
 * 密钥 / 被引用渠道左右两列 → 余量块整宽。
 */
function AccountCardComponent({
  row,
  isSelected,
}: {
  row: Row<AccountListItem>
  isSelected: boolean
}) {
  const { t } = useTranslation()
  const cells = row.getAllCells()
  const account = row.original.account

  const renderCell = (id: string) => {
    const cell = cells.find((item) => item.column.id === id)
    if (!cell || !cell.column.columnDef.cell) {
      return null
    }
    return flexRender(cell.column.columnDef.cell, cell.getContext())
  }

  const labelClass =
    'text-muted-foreground text-[11px] font-medium select-none'
  const typeCell = renderCell('type')
  const nameCell = renderCell('name')
  const keyCell = renderCell('key')
  const statusCell = renderCell('status')
  const balanceCell = renderCell('balance')
  const channelsCell = renderCell('channels')
  const codingPlanCell = renderCell('coding_plan')
  const actionsCell = renderCell('actions')
  const monitored = Boolean(account.coding_plan_provider)

  const dot = (
    <span className='text-muted-foreground/40' aria-hidden='true'>
      ·
    </span>
  )

  return (
    <div
      data-state={isSelected ? 'selected' : undefined}
      className='flex flex-col gap-2.5'
    >
      {/* 名称行：名称（含「自动」徽标）在左，行操作贴右上 */}
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className={cn('shrink-0', labelClass)}>#{account.id}</span>
          <div className='min-w-0 truncate text-sm'>{nameCell}</div>
        </div>
        <div className='flex shrink-0 items-center'>{actionsCell}</div>
      </div>

      {/* 属性行：类型 · 状态 · 余额 一行平铺，填掉原来右侧的空白 */}
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
        <span className='inline-flex items-center gap-1.5'>
          <span className={labelClass}>{t('Type')}</span>
          {typeCell}
        </span>
        {dot}
        {statusCell}
        {dot}
        <span className='inline-flex items-center gap-1.5'>
          <span className={labelClass}>{t('Balance')}</span>
          {balanceCell}
        </span>
      </div>

      {/* 密钥 / 被引用渠道：卡片宽，两列并排 */}
      <div className='grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2'>
        <div className='min-w-0'>
          <div className={cn('mb-1', labelClass)}>{t('Key')}</div>
          <div className='min-w-0 truncate text-sm'>{keyCell}</div>
        </div>
        <div className='min-w-0'>
          <div className={cn('mb-1', labelClass)}>{t('Referenced by')}</div>
          <div className='min-w-0 truncate text-sm'>{channelsCell}</div>
        </div>
      </div>

      {/* 编码套餐余量：只在开了监控的账户上出现，整宽，与上面内容用分隔线隔开 */}
      {monitored && (
        <div className='min-w-0 border-t pt-2'>
          <div className={cn('mb-1', labelClass)}>
            {t('Coding plan quota')}
          </div>
          <div className='min-w-0'>{codingPlanCell}</div>
        </div>
      )}
    </div>
  )
}

/** 与渠道卡片同样 memo：只有自身行数据变化时才重渲染。 */
export const AccountCard = memo(AccountCardComponent)
