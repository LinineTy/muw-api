// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { getOAuthAccessLogs } from '../api'
import {
  ACCESS_LOG_ACTIONS,
  ACCESS_LOG_ACTION_LABELS,
  OAUTH_QUERY_KEY,
} from '../constants'
import { useAccessLogsColumns } from './access-logs-columns'

const ALL_ACTIONS = 'all'

/**
 * OIDC 协议调用明细：谁在什么时候、从哪个 IP、用哪个应用调了什么、成没成。
 * 带终端用户的身份与来源 ⇒ 只给管理员（站内用户看用量走「用量」页签的聚合口径）。
 */
export function AccessLogsTable() {
  const { t } = useTranslation()
  const [action, setAction] = useState(ALL_ACTIONS)
  const actionOptions = useMemo(
    () => [
      { value: ALL_ACTIONS, label: t('All actions') },
      ...ACCESS_LOG_ACTIONS.map((value) => ({
        value,
        label: t(ACCESS_LOG_ACTION_LABELS[value] ?? value),
      })),
    ],
    [t]
  )
  const [result, setResult] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const columns = useAccessLogsColumns()

  const query = useQuery({
    queryKey: [
      ...OAUTH_QUERY_KEY,
      'access-logs',
      action,
      result,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: () =>
      getOAuthAccessLogs({
        action: action === ALL_ACTIONS ? undefined : action,
        success: result || undefined,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      }),
  })

  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    pagination,
    onPaginationChange: setPagination,
    manualFiltering: true,
    manualPagination: true,
    enableSorting: false,
    totalCount: query.data?.total ?? 0,
    ensurePageInRange: (pageCount) => {
      if (query.isSuccess && pagination.pageIndex >= Math.max(1, pageCount)) {
        setPagination((previous) => ({
          ...previous,
          pageIndex: Math.max(0, pageCount - 1),
        }))
      }
    },
    columnVisibilityStorageKey: false,
    columnSizingStorageKey: false,
  })

  const summary = query.data?.summary

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <Select
          items={actionOptions}
          value={action}
          onValueChange={(value) => {
            setAction(value ?? ALL_ACTIONS)
            setPagination((previous) => ({ ...previous, pageIndex: 0 }))
          }}
        >
          <SelectTrigger className='h-8 w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACTIONS}>{t('All actions')}</SelectItem>
            {ACCESS_LOG_ACTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(ACCESS_LOG_ACTION_LABELS[value] ?? value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tabs
          value={result}
          onValueChange={(value) => {
            setResult(value)
            setPagination((previous) => ({ ...previous, pageIndex: 0 }))
          }}
        >
          <TabsList>
            <TabsTrigger value=''>{t('All')}</TabsTrigger>
            <TabsTrigger value='true'>{t('Success')}</TabsTrigger>
            <TabsTrigger value='false'>{t('Failed')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {summary ? (
          <p className='text-muted-foreground text-xs'>
            {t('{{total}} calls · {{failed}} failed · {{clients}} apps', {
              total: summary.total_calls,
              failed: summary.failed_calls,
              clients: summary.active_clients,
            })}
          </p>
        ) : null}
      </div>

      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No calls yet')}
        emptyDescription={t(
          'Every authorization request, token exchange and user-info read shows up here.'
        )}
        skeletonKeyPrefix='oauth-access-logs-skeleton'
        className='min-h-0 flex-1'
      />
    </div>
  )
}
