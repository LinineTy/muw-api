// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  getOAuthUsage,
  type OAuthUsageDaily,
  type OAuthUsageScope,
} from '../api'
import { OAUTH_QUERY_KEY } from '../constants'
import { useUsageColumns } from './usage-columns'

const DAY_OPTIONS = [7, 14, 30]

// 后端只返回"有调用"的那些天；趋势图要把空档补成 0，否则看不出哪天完全没人调。
function recentDays(count: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    out.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    )
  }
  return out
}

/**
 * 用量与统计：按应用聚合 + 按天趋势 + 失败原因 Top。
 * scope=self 是"我创建的应用被怎么用"（不含任何终端用户身份）；管理员可切全站。
 * 逐次调用的明细（含 IP / UA）在「调用明细」页签，仅管理员可见。
 */
export function UsagePanel({ scope }: { scope: OAuthUsageScope }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [days, setDays] = useState(14)
  const columns = useUsageColumns()

  const query = useQuery({
    queryKey: [...OAUTH_QUERY_KEY, 'usage-overview', scope, days],
    queryFn: () => getOAuthUsage({ scope, days }),
  })

  const { table } = useDataTable({
    data: query.data?.applications ?? [],
    columns,
    enableSorting: false,
    columnVisibilityStorageKey: false,
    columnSizingStorageKey: false,
  })

  const totals = query.data?.totals
  const failures = query.data?.failures ?? []
  const daily = useMemo<OAuthUsageDaily[]>(() => {
    const rows = query.data?.daily ?? []
    if (rows.length === 0) {
      return []
    }
    const byDay = new Map<string, OAuthUsageDaily>(
      rows.map((row) => [row.day, row])
    )
    return recentDays(query.data?.days ?? days).map(
      (day): OAuthUsageDaily => byDay.get(day) ?? { day, calls: 0, failed: 0 }
    )
  }, [query.data, days])
  const maxCalls = daily.reduce((max, row) => Math.max(max, row.calls), 0)

  let trendContent = (
    <p className='text-muted-foreground text-sm'>{t('No calls yet')}</p>
  )
  if (query.isLoading) {
    trendContent = <Skeleton className='h-24 w-full' />
  } else if (maxCalls > 0) {
    trendContent = (
      <ul className='flex flex-col gap-1.5'>
        {daily.map((row) => (
          <li key={row.day} className='flex items-center gap-2'>
            <span className='text-muted-foreground w-14 shrink-0 text-xs tabular-nums'>
              {row.day.slice(5)}
            </span>
            <span
              className='bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full'
              title={t('{{calls}} calls · {{failed}} failed', {
                calls: row.calls,
                failed: row.failed,
              })}
            >
              <span
                className='bg-primary flex h-full rounded-full'
                style={{ width: `${(row.calls / maxCalls) * 100}%` }}
              >
                {row.failed > 0 ? (
                  <span
                    className='bg-destructive h-full rounded-full'
                    style={{ width: `${(row.failed / row.calls) * 100}%` }}
                  />
                ) : null}
              </span>
            </span>
            <span className='w-10 shrink-0 text-right text-xs tabular-nums'>
              {formatNumber(row.calls, locale)}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  let failureContent = (
    <p className='text-muted-foreground text-sm'>
      {t('No failed calls in this period')}
    </p>
  )
  if (query.isLoading) {
    failureContent = <Skeleton className='h-24 w-full' />
  } else if (failures.length > 0) {
    failureContent = (
      <ul className='flex flex-col gap-2'>
        {failures.map((row) => (
          <li
            key={row.error_code}
            className='flex items-center justify-between gap-3 text-sm'
          >
            <span className='truncate font-mono text-xs'>{row.error_code}</span>
            <span className='text-muted-foreground tabular-nums'>
              {formatNumber(row.count, locale)}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <Tabs
          value={String(days)}
          onValueChange={(value) => setDays(Number(value))}
        >
          <TabsList>
            {DAY_OPTIONS.map((option) => (
              <TabsTrigger key={option} value={String(option)}>
                {t('{{count}} days', { count: option })}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {totals ? (
          <p className='text-muted-foreground text-xs'>
            {t('{{calls}} calls · {{failed}} failed · {{users}} users', {
              calls: formatNumber(totals.calls, locale),
              failed: formatNumber(totals.failed_calls, locale),
              users: formatNumber(totals.active_users, locale),
            })}
          </p>
        ) : null}
      </div>

      <div className='grid gap-3 xl:grid-cols-2'>
        <Card>
          <CardContent className='py-4'>
            <p className='mb-3 text-sm font-medium'>{t('Calls per day')}</p>
            {trendContent}
          </CardContent>
        </Card>

        <Card>
          <CardContent className='py-4'>
            <p className='mb-3 text-sm font-medium'>{t('Failure reasons')}</p>
            {failureContent}
          </CardContent>
        </Card>
      </div>

      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No calls yet')}
        emptyDescription={t(
          'Usage appears here once an application starts signing users in.'
        )}
        skeletonKeyPrefix='oauth-usage-skeleton'
        className='min-h-0 flex-1'
      />
    </div>
  )
}
