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
import { requireServerSuccess } from '@/lib/server-error-message'

import { adminListGroupPinProducts, getAdminPlans } from '../api'
import { planRecordFromGroupPinProduct } from '../lib'
import { GroupedPlansList } from './grouped-plans'
import { PlanCard } from './plan-card'
import { useSubscriptionsColumns } from './subscriptions-columns'
import { useSubscriptions } from './subscriptions-provider'

const SUBSCRIPTIONS_VIEW_MODE_STORAGE_KEY = 'subscriptions:view-mode'

export function SubscriptionsTable() {
  const { t } = useTranslation()
  const columns = useSubscriptionsColumns()
  const { refreshTrigger, grouped } = useSubscriptions()

  // 订阅套餐与固定分组商品同表：商品来自独立表（group_pin_products），这里合并成
  // 一套行模型，共用列定义、卡片视图、搜索与行操作。两个查询独立，商品接口失败
  // 不影响套餐照常展示。
  const { data: planRows, isLoading: plansLoading } = useQuery({
    queryKey: ['admin-subscription-plans', refreshTrigger],
    queryFn: async () => {
      const result = requireServerSuccess(await getAdminPlans())
      return result.data || []
    },
    placeholderData: (prev) => prev,
  })

  const { data: pinProductRows, isLoading: productsLoading } = useQuery({
    queryKey: ['admin-group-pin-products', refreshTrigger],
    queryFn: async () => (await adminListGroupPinProducts()).data || [],
    placeholderData: (prev) => prev,
  })

  const plans = useMemo(
    () => [
      ...(planRows || []).map((row) => ({ ...row, kind: 'plan' as const })),
      ...(pinProductRows || []).map(planRecordFromGroupPinProduct),
    ],
    [planRows, pinProductRows]
  )

  const { table } = useDataTable({
    data: plans,
    columns,
    // 开启客户端搜索（globalFilter），否则工具栏的搜索框是空摆设
    withFacetedRowModel: false,
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      {grouped ? (
        <GroupedPlansList rows={table.getCoreRowModel().rows} />
      ) : (
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={plansLoading || productsLoading}
          emptyTitle={t('No subscription plans yet')}
          emptyDescription={t(
            'Use "Create" to add a subscription plan or a fixed group product'
          )}
          skeletonKeyPrefix='subscriptions-skeleton'
          enableCardView
          viewModeStorageKey={SUBSCRIPTIONS_VIEW_MODE_STORAGE_KEY}
          renderCard={(row, { isSelected }) => (
            <PlanCard row={row} isSelected={isSelected} />
          )}
          cardGridClassName='grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3'
          toolbarProps={{
            searchPlaceholder: t('Filter plans...'),
          }}
          applyHeaderSize
          className='min-h-0 flex-1'
        />
      )}
    </div>
  )
}
