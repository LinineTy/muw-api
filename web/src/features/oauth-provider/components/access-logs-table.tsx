// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getOAuthAccessLogs } from '../api'
import { OAUTH_QUERY_KEY } from '../constants'
import { useAccessLogsColumns } from './access-logs-columns'

/**
 * OIDC 协议调用明细：谁在什么时候、从哪个 IP、用哪个应用调了什么、成没成。
 * 管理员可切全站视角，其余人只看自己申请的应用；服务端分页。
 */
export function AccessLogsTable() {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const isAdmin = role >= ROLE.ADMIN
  const [scope, setScope] = useState<'self' | 'all'>('self')
  const [result, setResult] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const columns = useAccessLogsColumns()

  const query = useQuery({
    queryKey: [
      ...OAUTH_QUERY_KEY,
      'access-logs',
      scope,
      result,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: () =>
      getOAuthAccessLogs({
        scope,
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
        {isAdmin ? (
          <Tabs
            value={scope}
            onValueChange={(value) => {
              setScope(value as 'self' | 'all')
              setPagination((previous) => ({ ...previous, pageIndex: 0 }))
            }}
          >
            <TabsList>
              <TabsTrigger value='self'>{t('Only Mine')}</TabsTrigger>
              <TabsTrigger value='all'>{t('All')}</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
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
