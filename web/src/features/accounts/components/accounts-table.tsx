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
import type { PaginationState } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'

import { getAccounts } from '../api'
import type { AccountListItem } from '../types'
import { useAccountsColumns } from './accounts-columns'

const PAGE_SIZE = 20
const KEYWORD_DEBOUNCE_MS = 400

export function AccountsTable({
  onEdit,
  onDelete,
}: {
  onEdit: (id: number) => void
  onDelete: (item: AccountListItem) => void
}) {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  // 搜索框由工具栏防抖后回写（searchDebounceMs），这里只保管已提交的值
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }))
  }, [keyword])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['accounts', pagination.pageIndex + 1, pagination.pageSize, keyword],
    queryFn: () =>
      getAccounts({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        keyword,
      }),
  })

  const items: AccountListItem[] = data?.items ?? []
  const total = data?.total ?? 0

  const columns = useAccountsColumns({
    onEdit,
    onDelete: (id) => {
      const target = items.find((item) => item.account.id === id)
      if (target) onDelete(target)
    },
  })

  const { table } = useDataTable({
    data: items,
    columns,
    totalCount: total,
    pagination,
    onPaginationChange: setPagination,
    globalFilter: keyword,
    onGlobalFilterChange: (updater) =>
      setKeyword((prev) =>
        typeof updater === 'function' ? String(updater(prev)) : String(updater ?? '')
      ),
    manualPagination: true,
    manualFiltering: true,
  })

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
      toolbarProps={{
        searchPlaceholder: t('Search accounts...'),
        searchDebounceMs: KEYWORD_DEBOUNCE_MS,
      }}
    />
  )
}
