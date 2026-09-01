// @muw-owned
import { useQuery } from '@tanstack/react-query'
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'

import { getAdminAllSubscriptions } from '../api'
import {
  SUBSCRIPTION_SORTABLE_COLUMNS,
  type SubscriptionSortBy,
} from '../constants'
import { useAdminSubscriptionsColumns } from './admin-subscriptions-columns'
import { useSubscriptions } from './subscriptions-provider'

// 历史订阅：只读展示已删除 / 已取消 / 已过期的订阅记录（软删除的记录保留在这里）。
export function AdminHistorySubscriptionsTable() {
  const { t } = useTranslation()
  const { refreshTrigger } = useSubscriptions()
  const columns = useAdminSubscriptionsColumns({ actions: 'purge' })

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [sorting, setSorting] = useState<SortingState>([])

  const sortParams = useMemo(() => {
    const activeSort = sorting[0]
    if (
      !activeSort ||
      !SUBSCRIPTION_SORTABLE_COLUMNS.has(activeSort.id as SubscriptionSortBy)
    ) {
      return {}
    }

    return {
      sort_by: activeSort.id as SubscriptionSortBy,
      sort_order: activeSort.desc ? 'desc' : 'asc',
    } as const
  }, [sorting])

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater)
    if (pagination.pageIndex > 0) {
      setPagination({ ...pagination, pageIndex: 0 })
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: [
      'admin-subscription-history',
      pagination.pageIndex + 1,
      pagination.pageSize,
      sortParams,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await getAdminAllSubscriptions({
        p: pagination.pageIndex + 1,
        size: pagination.pageSize,
        status: 'deleted,cancelled,expired',
        ...sortParams,
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
    sorting,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    totalCount: data?.total || 0,
    pagination,
    onPaginationChange: setPagination,
    onSortingChange: handleSortingChange,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      emptyTitle={t('No history subscriptions')}
      emptyDescription={t('No history subscriptions')}
      skeletonKeyPrefix='admin-subscription-history-skeleton'
      applyHeaderSize
    />
  )
}
