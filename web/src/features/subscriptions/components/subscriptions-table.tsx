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

import { DataTablePage, useDataTable } from '@/components/data-table'

import { getAdminPlans } from '../api'
import { PlanCard } from './plan-card'
import { useSubscriptionsColumns } from './subscriptions-columns'
import { useSubscriptions } from './subscriptions-provider'

const SUBSCRIPTIONS_VIEW_MODE_STORAGE_KEY = 'subscriptions:view-mode'

export function SubscriptionsTable() {
  const { t } = useTranslation()
  const columns = useSubscriptionsColumns()
  const { refreshTrigger } = useSubscriptions()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-subscription-plans', refreshTrigger],
    queryFn: async () => {
      const result = await getAdminPlans()
      return result.data || []
    },
    placeholderData: (prev) => prev,
  })

  const plans = useMemo(() => data || [], [data])

  const { table } = useDataTable({
    data: plans,
    columns,
    // 开启客户端搜索（globalFilter），否则工具栏的搜索框是空摆设
    withFacetedRowModel: false,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      emptyTitle={t('No subscription plans yet')}
      emptyDescription={t(
        'Click "Create Plan" to create your first subscription plan'
      )}
      skeletonKeyPrefix='subscriptions-skeleton'
      enableCardView
      viewModeStorageKey={SUBSCRIPTIONS_VIEW_MODE_STORAGE_KEY}
      renderCard={(row, { isSelected }) => (
        <PlanCard row={row} isSelected={isSelected} />
      )}
      cardGridClassName='grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2 2xl:grid-cols-3'
      toolbarProps={{
        searchPlaceholder: t('Filter plans...'),
      }}
      applyHeaderSize
    />
  )
}
