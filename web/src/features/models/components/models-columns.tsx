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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { BadgeListCell, TruncatedCell } from '@/components/data-table'
import { ProviderBadge } from '@/components/provider-badge'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import {
  useCanEditModelPricing,
  type ModelPricingConfig,
} from '@/features/model-pricing/api'
import { modelPricingDisplay } from '@/features/model-pricing/pricing'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'
import { formatTimestampToDate } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'

import { getModelStatusConfig, getNameRuleConfig } from '../constants'
import { parseModelTags, formatEndpointsDisplay } from '../lib'
import { getModelChannelState } from '../lib/model-utils'
import type { Model, Vendor } from '../types'
import { DataTableRowActions } from './data-table-row-actions'
import { DescriptionCell } from './description-cell'
import { ModelSquareStatus } from './model-square-status'
import { useModels } from './models-provider'

/**
 * 匹配类型配置里的 color（green/blue/orange/purple/error…）→ StatusBadge variant。
 * fork 老口径就是按语义给匹配类型上色，上游 rework 只保留了 label。
 */
function nameRuleVariant(color: string): StatusVariant {
  if (color === 'error') return 'danger'
  if (color in { green: 1, blue: 1, orange: 1, purple: 1 }) {
    return color as StatusVariant
  }
  return 'neutral'
}

export function useModelsColumns(
  vendors: Vendor[] = [],
  pricing?: ModelPricingConfig,
  pricingState?: 'loading' | 'error'
): ColumnDef<Model>[] {
  const { t } = useTranslation()
  const canPrice = useCanEditModelPricing()
  const { setCurrentRow, setOpen } = useModels()
  const vendorMap = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.id, vendor])),
    [vendors]
  )
  const priceMap = useMemo(
    () =>
      new Map(pricing?.entries.map((entry) => [entry.model_name, entry]) ?? []),
    [pricing]
  )
  const rules = getNameRuleConfig(t)
  const MODEL_STATUS_CONFIG = getModelStatusConfig(t)
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(value) =>
            table.toggleAllPageRowsSelected(Boolean(value))
          }
          aria-label={t('Select all')}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
          aria-label={t('Select {{name}}', { name: row.original.model_name })}
        />
      ),
      size: 40,
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'model_name',
      header: t('Model'),
      size: 310,
      minSize: 250,
      enableHiding: false,
      meta: { mobileTitle: true },
      cell: ({ row }) => {
        const model = row.original
        const vendor = vendorMap.get(model.vendor_id ?? 0)
        const iconKey = model.icon || vendor?.icon || model.model_name[0]
        return (
          <div className='flex max-w-[320px] min-w-0 items-start gap-2.5 py-1'>
            <span className='mt-1 flex size-6 shrink-0 items-center justify-center'>
              {getLobeIcon(iconKey, 24)}
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex min-w-0 items-center gap-1'>
                <Button
                  variant='link'
                  className='text-foreground h-auto min-w-0 shrink justify-start p-0 font-mono text-sm'
                  title={model.model_name}
                  onClick={() => {
                    setCurrentRow(model)
                    setOpen('update-model')
                  }}
                >
                  <span className='truncate'>{model.model_name}</span>
                </Button>
                <CopyButton
                  value={model.model_name}
                  className='size-6 shrink-0'
                />
              </div>
              <div className='text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-xs'>
                {model.id > 0 && vendor ? (
                  <ProviderBadge
                    iconKey={vendor.icon}
                    iconSize={12}
                    label={vendor.name}
                    className='min-w-0'
                  />
                ) : (
                  <span className='truncate'>
                    {model.id > 0 ? t('No vendor') : t('Missing metadata')}
                  </span>
                )}
                {model.name_rule !== 0 && (
                  <span className='shrink-0'>
                    {rules[model.name_rule as 0 | 1 | 2 | 3]?.label} ·{' '}
                    {model.matched_count ?? 0}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      },
    },
    {
      id: 'pricing',
      header: t('Pricing'),
      meta: { label: t('Pricing') },
      size: 225,
      enableSorting: false,
      cell: ({ row }) => {
        if (!canPrice) {
          return (
            <span className='text-muted-foreground text-xs'>
              {t('Super admin')}
            </span>
          )
        }
        if (row.original.name_rule !== 0) {
          return (
            <span className='text-muted-foreground text-xs'>
              {t('Per matched model')}
            </span>
          )
        }
        if (pricingState) {
          return (
            <span className='text-muted-foreground text-xs'>
              {pricingState === 'error'
                ? t('Failed to load model pricing')
                : t('Loading...')}
            </span>
          )
        }
        const entry = priceMap.get(row.original.model_name)
        return (
          <Button
            variant='ghost'
            className='h-auto w-full max-w-full min-w-0 justify-start px-0 py-1 text-left font-normal hover:bg-transparent'
            aria-label={t('View pricing for {{model}}', {
              model: row.original.model_name,
            })}
            onClick={() => {
              setCurrentRow(row.original)
              setOpen('price-model')
            }}
          >
            <ModelPriceCell
              model={modelPricingDisplay(
                entry ?? { model_name: row.original.model_name, effective: {} }
              )}
              options={{ tokenUnit: 'M' }}
              showExpression={false}
            />
          </Button>
        )
      },
    },
    {
      accessorKey: 'square_state',
      header: t('Model square visibility'),
      size: 115,
      enableSorting: false,
      meta: { mobileBadge: true },
      cell: ({ row }) => <ModelSquareStatus model={row.original} />,
    },
    {
      id: 'connections',
      header: t('Channels and groups'),
      size: 180,
      enableSorting: false,
      cell: ({ row }) => {
        const state = getModelChannelState(row.original)
        return (
          <div className='min-w-0 text-sm'>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={0}
                    title={t(state.description)}
                    aria-description={t(state.description)}
                    className='block whitespace-normal sm:truncate'
                  />
                }
              >
                {t('Channels {{channels}} · Groups {{groups}}', {
                  channels: row.original.bound_channels?.length ?? 0,
                  groups: row.original.enable_groups?.length ?? 0,
                })}
              </TooltipTrigger>
              <TooltipContent role='tooltip'>
                {t(state.description)}
              </TooltipContent>
            </Tooltip>
          </div>
        )
      },
    },
    // MERGE-DECISION: 列集以 fork 为准（含 Context Window），仅并入上游的定价列。
    // Context Window column
    {
      accessorKey: 'context_window',
      header: t('Context Window'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const cw = row.getValue('context_window') as number | null | undefined
        if (!cw) {
          return <span className='text-muted-foreground'>—</span>
        }
        return <span className='font-mono text-sm'>{cw.toLocaleString()}</span>
      },
      size: 100,
      enableSorting: false,
    },
    {
      accessorKey: 'tags',
      header: t('Tags'),
      size: 180,
      enableSorting: false,
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <BadgeListCell
          expandable
          max={1}
          items={parseModelTags(row.original.tags ?? '').map((tag) => (
            <StatusBadge key={tag} label={tag} autoColor={tag} size='sm' />
          ))}
        />
      ),
    },
    {
      accessorKey: 'sync_official',
      header: () => (
        <TruncatedCell className='max-w-[120px]'>
          {t('Sync policy')}
        </TruncatedCell>
      ),
      size: 145,
      enableSorting: false,
      meta: { mobileHidden: true, label: t('Sync policy') },
      cell: ({ row }) => {
        // fork 老口径：官方同步按语义着色（同步=success、保留本地=warning）；
        // 上游 rework 之后退化成纯灰文本，2026-09-13 maintainer指出「旧版如此花哨，新版好素」
        if (!row.original.id) {
          return <span className='text-muted-foreground text-sm'>—</span>
        }
        const synced = Boolean(row.original.sync_official)
        return (
          <StatusBadge
            variant={synced ? 'success' : 'warning'}
            size='sm'
            copyable={false}
            className='-ml-1.5 max-w-none shrink-0'
          >
            {synced ? t('Allow updates') : t('Keep local')}
          </StatusBadge>
        )
      },
    },
    // 状态列：文案与渲染换回 fork 口径（上游 rework 改成了「展示策略 / 允许 / 隐藏」纯文本，
    // 与工具栏那张「状态（显示/未显示）」筛选对不上，且"允许"说不清允许什么 —— 2026-09-12 maintainer定）
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const status = row.getValue('status') as number
        const config =
          MODEL_STATUS_CONFIG[status as 0 | 1] || MODEL_STATUS_CONFIG[0]
        return (
          <StatusBadge
            variant={config.variant}
            size='sm'
            copyable={false}
            className='-ml-1.5 max-w-none shrink-0'
          >
            {config.label}
          </StatusBadge>
        )
      },
      filterFn: (row, id, value) => {
        if (!value || value.length === 0 || value.includes('all')) return true
        const status = row.getValue(id) as number
        if (value.includes('enabled')) return status === 1
        if (value.includes('disabled')) return status !== 1
        return false
      },
      size: 110,
      minSize: 110,
      enableSorting: false,
    },
    {
      accessorKey: 'id',
      header: t('ID'),
      cell: ({ row }) => row.original.id || '—',
      size: 65,
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'vendor_id',
      header: t('Vendor'),
      size: 150,
      enableSorting: false,
      cell: ({ row }) => {
        const vendor = vendorMap.get(row.original.vendor_id ?? 0)
        if (!vendor) {
          return <span className='text-muted-foreground text-xs'>—</span>
        }
        return (
          <BadgeListCell
            items={[<ProviderBadge iconKey={vendor.icon} label={vendor.name} />]}
          />
        )
      },
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'name_rule',
      header: t('Match Type'),
      size: 100,
      enableSorting: false,
      cell: ({ row }) => {
        const config = rules[row.original.name_rule as 0 | 1 | 2 | 3]
        if (!config) return null
        return (
          <StatusBadge
            variant={nameRuleVariant(config.color)}
            size='sm'
            copyable={false}
            className='-ml-1.5 max-w-none shrink-0'
          >
            {config.label}
          </StatusBadge>
        )
      },
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'description',
      header: t('Description'),
      size: 180,
      enableSorting: false,
      cell: ({ row }) => (
        <DescriptionCell
          modelName={row.original.model_name}
          description={row.original.description ?? ''}
        />
      ),
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'endpoints',
      header: t('Custom endpoints'),
      size: 180,
      enableSorting: false,
      cell: ({ row }) => (
        <BadgeListCell
          expandable
          expandLabel={t('Supported endpoints')}
          items={formatEndpointsDisplay(row.original.endpoints ?? '').map(
            (endpoint) => (
              <StatusBadge key={endpoint} label={endpoint} autoColor={endpoint} />
            )
          )}
        />
      ),
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'created_time',
      header: t('Created'),
      size: 160,
      cell: ({ row }) =>
        row.original.id
          ? formatTimestampToDate(row.original.created_time)
          : '—',
      meta: { mobileHidden: true },
    },
    {
      accessorKey: 'updated_time',
      header: t('Updated'),
      size: 160,
      cell: ({ row }) =>
        row.original.id
          ? formatTimestampToDate(row.original.updated_time)
          : '—',
      meta: { mobileHidden: true },
    },
    // 操作列放最后并右侧固定（与渠道/账户等表格一致；上游把 actions 排在中间）
    {
      id: 'actions',
      header: t('Actions'),
      enableSorting: false,
      enableHiding: false,
      size: canPrice ? 170 : 105,
      cell: ({ row }) => <DataTableRowActions row={row} />,
      meta: { pinned: 'right' as const },
    },
  ]
}
