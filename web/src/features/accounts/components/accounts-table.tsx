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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import { getChannelTypeLabel } from '@/features/channels/lib'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { getAccounts } from '../api'
import { readQuotaAutoRefresh, writeQuotaAutoRefresh } from '../constants'
import { ACCOUNT_STATUS, type AccountListItem } from '../types'
import { AccountCard } from './account-card'
import { useAccountsColumns } from './accounts-columns'

const route = getRouteApi('/_authenticated/accounts/')
const ACCOUNTS_VIEW_MODE_STORAGE_KEY = 'accounts:view-mode'
const PAGE_SIZE = 20
const KEYWORD_DEBOUNCE_MS = 400

/** 取单选的列筛选值（工具栏筛选统一单选；未选 / "all" 表示不限）。 */
function pickFilter(
  columnFilters: { id: string; value: unknown }[],
  columnId: string
): string | undefined {
  const value = columnFilters.find((filter) => filter.id === columnId)
    ?.value as string[] | undefined
  const first = value?.[0]
  return first && first !== 'all' ? first : undefined
}

export function AccountsTable({
  onEdit,
  onDelete,
}: {
  onEdit: (id: number) => void
  onDelete: (item: AccountListItem) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // 余量自动刷新开关：默认开，与旧渠道余量页共用同一个 localStorage 键。
  const [autoRefreshQuota, setAutoRefreshQuota] = useState(readQuotaAutoRefresh)
  const handleAutoRefreshToggle = (checked: boolean) => {
    writeQuotaAutoRefresh(checked)
    setAutoRefreshQuota(checked)
  }
  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: PAGE_SIZE },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'array' },
      { columnId: 'type', searchKey: 'type', type: 'array' },
      { columnId: 'referenced', searchKey: 'referenced', type: 'array' },
      { columnId: 'monitoring', searchKey: 'monitoring', type: 'array' },
    ],
  })

  // 筛选值（URL 同步）→ 接口参数；'all' / 未选 = 不限。
  const statusValue = pickFilter(columnFilters, 'status')
  const typeValue = pickFilter(columnFilters, 'type')
  const referencedValue = pickFilter(columnFilters, 'referenced')
  const monitoringValue = pickFilter(columnFilters, 'monitoring')
  const statusParam = statusValue ? Number(statusValue) : undefined
  const typeParam = typeValue ? Number(typeValue) : undefined
  const referencedParam =
    referencedValue === undefined ? undefined : referencedValue === '1'
  const monitoringParam =
    monitoringValue === undefined ? undefined : monitoringValue === '1'

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'accounts',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      statusParam,
      typeParam,
      referencedParam,
      monitoringParam,
    ],
    queryFn: () =>
      getAccounts({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        keyword: globalFilter,
        type: typeParam,
        status: statusParam,
        referenced: referencedParam,
        monitoring: monitoringParam,
      }),
  })

  const items: AccountListItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const facets = data?.facets

  const columns = useAccountsColumns({
    onEdit,
    onDelete: (id) => {
      const target = items.find((item) => item.account.id === id)
      if (target) onDelete(target)
    },
    autoRefreshQuota,
  })

  const { table } = useDataTable({
    data: items,
    columns,
    totalCount: total,
    // 两个筛选专用列默认隐藏（只服务工具栏筛选）
    initialColumnVisibility: { referenced: false, monitoring: false },
    columnFilters,
    pagination,
    globalFilter,
    onColumnFiltersChange,
    onPaginationChange,
    onGlobalFilterChange,
    manualPagination: true,
    manualFiltering: true,
    ensurePageInRange,
  })

  // 筛选下拉：数量取后端 facets（全量口径，不受当前筛选影响），选项只列存在的类型。
  const statusFilterOptions = useMemo(() => {
    const counts = facets?.status ?? {}
    const options = [
      { label: t('Enabled'), value: String(ACCOUNT_STATUS.ENABLED) },
      { label: t('Manually Disabled'), value: String(ACCOUNT_STATUS.MANUALLY_DISABLED) },
      { label: t('Auto Disabled'), value: String(ACCOUNT_STATUS.AUTO_DISABLED) },
    ]
    return options
      .filter((option) => (counts[option.value] ?? 0) > 0)
      .map((option) => ({ ...option, count: counts[option.value] ?? 0 }))
  }, [facets, t])

  const typeFilterOptions = useMemo(() => {
    const counts = facets?.type ?? {}
    return Object.entries(counts)
      .map(([type, count]) => ({ type: Number(type), count }))
      .filter((item) => item.type > 0 && item.count > 0)
      .sort((a, b) =>
        t(getChannelTypeLabel(a.type)).localeCompare(
          t(getChannelTypeLabel(b.type))
        )
      )
      .map((item) => ({
        label: getChannelTypeLabel(item.type),
        value: String(item.type),
        count: item.count,
        iconNode: <ChannelTypeLogo type={item.type} size={16} />,
      }))
  }, [facets, t])

  const referencedCount = facets?.referenced ?? 0
  const monitoringCount = facets?.monitoring ?? 0

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No accounts yet')}
      emptyDescription={t(
        'Accounts hold credentials shared by channels. Create one and bind it from a channel.'
      )}
      skeletonKeyPrefix='account-skeleton'
      enableCardView
      viewModeStorageKey={ACCOUNTS_VIEW_MODE_STORAGE_KEY}
      renderCard={(row, { isSelected }) => (
        <AccountCard row={row} isSelected={isSelected} />
      )}
      // 卡片瀑布流：卡片高度不一（开了监控的多一块余量），用 CSS 多列让后面的卡片
      // 上浮填洞。代价是阅读顺序变成「先竖后横」（第 N 张落在哪一列由列高决定）。
      cardGridClassName='columns-1 gap-3 sm:columns-2 sm:gap-4 lg:columns-3 [&>*]:mb-3 [&>*]:break-inside-avoid sm:[&>*]:mb-4'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Search accounts...'),
        searchDebounceMs: KEYWORD_DEBOUNCE_MS,
        // 余量自动刷新节奏由这里统一控制（单元格只管渲染与轮询）；没有开监控的账户
        // 就不显示这组控件，避免空占位。
        preActions:
          monitoringCount > 0 ? (
            <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
              <div className='flex items-center gap-1.5'>
                <Label
                  htmlFor='account-quota-auto-refresh'
                  className='text-muted-foreground cursor-pointer text-xs'
                >
                  {t('Auto refresh')}
                </Label>
                <Switch
                  id='account-quota-auto-refresh'
                  size='sm'
                  checked={autoRefreshQuota}
                  onCheckedChange={handleAutoRefreshToggle}
                />
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() =>
                  void queryClient.invalidateQueries({
                    queryKey: ['account-coding-plan-quota'],
                  })
                }
              >
                <RefreshCw
                  data-icon='inline-start'
                  className='size-3.5'
                  aria-hidden='true'
                />
                {t('Refresh All')}
              </Button>
            </div>
          ) : null,
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: statusFilterOptions,
            singleSelect: true,
          },
          {
            columnId: 'type',
            title: t('Type'),
            options: typeFilterOptions,
            singleSelect: true,
          },
          {
            columnId: 'referenced',
            title: t('Referenced by'),
            options: [
              {
                label: t('Referenced by channels'),
                value: '1',
                count: referencedCount,
              },
              {
                label: t('Not referenced'),
                value: '0',
                count: Math.max(total - referencedCount, 0),
              },
            ],
            singleSelect: true,
          },
          {
            columnId: 'monitoring',
            title: t('Quota monitoring'),
            options: [
              {
                label: t('Monitoring enabled'),
                value: '1',
                count: monitoringCount,
              },
              {
                label: t('Not monitored'),
                value: '0',
                count: Math.max(total - monitoringCount, 0),
              },
            ],
            singleSelect: true,
          },
        ],
      }}
    />
  )
}
