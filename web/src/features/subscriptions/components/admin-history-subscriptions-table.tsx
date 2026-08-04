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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'

import { getAdminAllSubscriptions } from '../api'
import { useAdminSubscriptionsColumns } from './admin-subscriptions-columns'
import { useSubscriptions } from './subscriptions-provider'

// 历史订阅：只读展示已删除 / 已取消 / 已过期的订阅记录（软删除的记录保留在这里）。
export function AdminHistorySubscriptionsTable() {
  const { t } = useTranslation()
  const { refreshTrigger } = useSubscriptions()
  const columns = useAdminSubscriptionsColumns({ actions: 'purge' })

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const { data, isLoading } = useQuery({
    queryKey: [
      'admin-subscription-history',
      pagination.pageIndex + 1,
      pagination.pageSize,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await getAdminAllSubscriptions({
        p: pagination.pageIndex + 1,
        size: pagination.pageSize,
        status: 'deleted,cancelled,expired',
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
    manualFiltering: true,
    manualPagination: true,
    totalCount: data?.total || 0,
    pagination,
    onPaginationChange: setPagination,
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
