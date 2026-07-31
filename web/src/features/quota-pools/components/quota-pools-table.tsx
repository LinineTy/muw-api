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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'

import { getQuotaPools } from '../api'
import { ERROR_MESSAGES } from '../constants'
import { useQuotaPoolsColumns } from './quota-pools-columns'
import { useQuotaPools } from './quota-pools-provider'

export function QuotaPoolsTable() {
  const { t } = useTranslation()
  const columns = useQuotaPoolsColumns()
  const { refreshTrigger } = useQuotaPools()

  const { data, isLoading } = useQuery({
    queryKey: ['quota-pools', refreshTrigger],
    queryFn: async () => {
      const result = await getQuotaPools()
      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.LOAD_FAILED))
        throw new Error(result.message)
      }
      return result.data || []
    },
    placeholderData: (prev) => prev,
  })

  const pools = useMemo(() => data || [], [data])

  const { table } = useDataTable({
    data: pools,
    columns,
    withFacetedRowModel: false,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      emptyTitle={t('No quota pools yet')}
      emptyDescription={t(
        'Click "Create Pool" to create your first quota pool'
      )}
      skeletonKeyPrefix='quota-pools-skeleton'
      toolbarProps={{
        searchPlaceholder: t('Filter pools...'),
      }}
      applyHeaderSize
    />
  )
}
