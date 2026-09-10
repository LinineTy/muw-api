// @muw-owned
import { flexRender, type Row } from '@tanstack/react-table'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { AccountListItem } from '../types'

/**
 * 账户卡片：表格视图的列 cell 全部复用（flexRender），信息与交互保持一致——
 * 类型、名称（含「自动生成」标记）、脱敏密钥、状态、余额、被哪些渠道引用、
 * 编码套餐余量、行操作。
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

  return (
    <div
      data-state={isSelected ? 'selected' : undefined}
      className='flex flex-col gap-3'
    >
      {/* 第一行：类型（厂商） + 状态 + 行操作 */}
      <div className='flex items-center justify-between gap-2'>
        <div className='min-w-0 flex-1 overflow-hidden'>{typeCell}</div>
        <div className='flex shrink-0 items-center gap-1.5'>
          {statusCell}
          {actionsCell}
        </div>
      </div>

      {/* 主体：左侧账户名/密钥，右侧余额 */}
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-1 flex-col gap-2 overflow-hidden'>
          <div className='min-w-0 text-sm'>
            <div className={labelClass}>#{account.id}</div>
            {nameCell}
          </div>
          <div className='min-w-0'>
            <div className={cn('mb-1', labelClass)}>{t('Key')}</div>
            <div className='min-w-0 overflow-hidden text-sm'>{keyCell}</div>
          </div>
        </div>
        <div className='flex shrink-0 flex-col items-end gap-1'>
          <span className={labelClass}>{t('Balance')}</span>
          <span className='text-sm'>{balanceCell}</span>
        </div>
      </div>

      {/* 被哪些渠道引用 */}
      <div className='min-w-0'>
        <div className={cn('mb-1', labelClass)}>{t('Referenced by')}</div>
        <div className='min-w-0 overflow-hidden text-sm'>{channelsCell}</div>
      </div>

      {/* 编码套餐余量：只在开了监控的账户上占位，其余账户卡片少一块 */}
      {monitored && (
        <div className='min-w-0'>
          <div className={cn('mb-1', labelClass)}>
            {t('Coding plan quota')}
          </div>
          <div className='min-w-0 overflow-hidden text-sm'>
            {codingPlanCell}
          </div>
        </div>
      )}
    </div>
  )
}

/** 与渠道卡片同样 memo：只有自身行数据变化时才重渲染。 */
export const AccountCard = memo(AccountCardComponent)
