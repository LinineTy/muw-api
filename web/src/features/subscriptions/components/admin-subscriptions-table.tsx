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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { getAdminAllSubscriptions } from '../api'
import { getSubscriptionStatusOptions } from '../constants'
import { useAdminSubscriptionsColumns } from './admin-subscriptions-columns'
import { useSubscriptions } from './subscriptions-provider'

const route = getRouteApi('/_authenticated/subscriptions/')

export function AdminSubscriptionsTable() {
  const { t } = useTranslation()
  const { refreshTrigger } = useSubscriptions()
  const columns = useAdminSubscriptionsColumns()

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
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      {
        columnId: 'status',
        searchKey: 'status',
        type: 'array',
        // Single-select: write `?status=active`, read it back as ['active'].
        // TanStack Router collapses a one-element array URL param to a bare
        // string, so the default array deserializer would drop it on reload.
        serialize: (value) => {
          if (Array.isArray(value) && value.length === 1) {
            return value[0]
          }
          return value
        },
        deserialize: (value) => {
          if (typeof value === 'string') {
            return [value]
          }
          if (Array.isArray(value)) {
            return value
          }
          return []
        },
      },
    ],
  })

  const status = (
    columnFilters.find((f) => f.id === 'status')?.value as string[] | undefined
  )?.[0]

  const { data, isLoading, isFetching } = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: [
      'admin-subscriptions',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      status,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await getAdminAllSubscriptions({
        p: pagination.pageIndex + 1,
        size: pagination.pageSize,
        status: status || undefined,
        user: globalFilter?.trim() || undefined,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to fetch subscription records'))
        return { items: [], total: 0 }
      }
      return { items: result.data?.items || [], total: result.data?.total || 0 }
    },
    placeholderData: (previousData) => previousData,
  })

  const items = data?.items || []

  const { table } = useDataTable({
    data: items,
    columns,
    columnFilters,
    globalFilter,
    globalFilterFn: () => true,
    manualFiltering: true,
    manualPagination: true,
    totalCount: data?.total || 0,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    ensurePageInRange,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No subscription records')}
      emptyDescription={t('No subscription records')}
      skeletonKeyPrefix='admin-subscriptions-skeleton'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Filter by username or email'),
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: getSubscriptionStatusOptions(t),
            singleSelect: true,
          },
        ],
      }}
    />
  )
}
