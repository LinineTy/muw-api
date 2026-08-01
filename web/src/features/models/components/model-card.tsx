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

import type { Model } from '../types'

/**
 * 模型卡片视图。复用 models-columns.tsx 中各列的 cell 渲染器（flexRender），
 * 保证表格与卡片的信息、交互一致：模型名/图标、状态、匹配规则、供应商、
 * 官方同步、标签、端点和行内操作。
 */
function ModelCardComponent({
  row,
  isSelected,
}: {
  row: Row<Model>
  isSelected: boolean
}) {
  const { t } = useTranslation()
  const cells = row.getAllCells()

  const renderCell = (id: string) => {
    const cell = cells.find((c) => c.column.id === id)
    if (!cell || !cell.column.columnDef.cell) {
      return null
    }
    return flexRender(cell.column.columnDef.cell, cell.getContext())
  }

  const nameCell = renderCell('model_name')
  const statusCell = renderCell('status')
  const ruleCell = renderCell('name_rule')
  const vendorCell = renderCell('vendor_id')
  const syncCell = renderCell('sync_official')
  const tagsCell = renderCell('tags')
  const endpointsCell = renderCell('endpoints')
  const actionsCell = renderCell('actions')

  const labelClass = 'text-muted-foreground text-[11px] font-medium select-none'

  return (
    <div
      data-state={isSelected ? 'selected' : undefined}
      className='flex flex-col gap-3'
    >
      {/* 头部：模型名/图标 + 状态，右侧行内操作 */}
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0 flex-1 overflow-hidden'>{nameCell}</div>
        <div className='flex shrink-0 items-center gap-1.5'>
          {statusCell}
          {actionsCell}
        </div>
      </div>

      {/* 元信息：供应商 / 匹配规则 / 官方同步 / 端点 */}
      <div className='grid grid-cols-2 gap-x-4 gap-y-2'>
        <div className='min-w-0'>
          <div className={labelClass}>{t('Vendor')}</div>
          <div className='text-muted-foreground min-w-0 overflow-hidden text-sm'>
            {vendorCell ?? '-'}
          </div>
        </div>
        <div className='min-w-0'>
          <div className={labelClass}>{t('Match Type')}</div>
          <div className='min-w-0 overflow-hidden'>{ruleCell}</div>
        </div>
        <div className='min-w-0'>
          <div className={labelClass}>{t('Official Sync')}</div>
          <div className='min-w-0 overflow-hidden'>{syncCell}</div>
        </div>
        <div className='min-w-0'>
          <div className={labelClass}>{t('Endpoints')}</div>
          <div className='min-w-0 overflow-hidden'>{endpointsCell}</div>
        </div>
      </div>

      {tagsCell && (
        <div className='min-w-0'>
          <div className={labelClass}>{t('Tags')}</div>
          <div className='min-w-0 overflow-hidden'>{tagsCell}</div>
        </div>
      )}
    </div>
  )
}

/**
 * memo 化，仅当该卡片自身的 react-table row 引用变化时重渲染，
 * 避免父级表格状态（过滤、翻页、视图切换等）更新时所有卡片一起重渲染。
 */
export const ModelCard = memo(ModelCardComponent)
