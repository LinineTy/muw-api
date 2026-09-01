// @muw-owned
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import type {
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

import { useEndedSubscriptionsColumns } from './ended-subscriptions-columns'

/**
 * 已结束（过期 + 取消）订阅：统一走全局数据表格，带搜索与状态筛选。
 * 数据在客户端（my-subscriptions provider），不涉及服务端分页。
 * 搜索/筛选状态由 useDataTable 内部管理（globalFilter/columnFilters 已
 * 支持未受控兜底），组件无需自行持有。
 */
export function EndedSubscriptionsTable({
  subscriptions,
  planMap,
}: {
  subscriptions: UserSubscriptionRecord[]
  planMap: Map<number, SubscriptionPlan>
}) {
  const { t } = useTranslation()
  const columns = useEndedSubscriptionsColumns(planMap)
  const { table } = useDataTable({
    data: subscriptions,
    columns,
    // 历史订阅默认每页 5 条（默认 20 条太长）。
    initialPagination: { pageIndex: 0, pageSize: 5 },
    // 搜索只按套餐名(ID 列)与订阅 ID 匹配，不搜时间/用量/状态列。
    globalFilterFn: (row, columnId, filterValue) => {
      if (columnId !== 'plan' && columnId !== 'id') {
        return false
      }
      return String(row.getValue(columnId))
        .toLowerCase()
        .includes(String(filterValue).toLowerCase())
    },
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      emptyTitle={t('No subscriptions yet')}
      toolbarProps={{
        searchPlaceholder: t('Filter by plan name or subscription ID'),
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            singleSelect: true,
            options: [
              { label: t('Expired'), value: 'expired' },
              { label: t('Cancelled'), value: 'cancelled' },
            ],
          },
        ],
      }}
      skeletonKeyPrefix='ended-subscriptions-skeleton'
      applyHeaderSize
      fixedHeight={false}
      // 分页内联渲染在表格正下方，不注入页面底部 footer 栏。
      paginationInFooter={false}
      className='min-h-0'
    />
  )
}
