// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import {
  Activity,
  BarChart3,
  Eye,
  Globe,
  Loader2,
  Radar,
  Share2,
  ShieldAlert,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { CopyButton } from '@/components/copy-button'
import {
  DataTableColumnHeader,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getRouteApi } from '@tanstack/react-router'
import { useTheme } from '@/context/theme-provider'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { VCHART_OPTION } from '@/lib/vchart'

import {
  getIpOverlap,
  getIpOverview,
  getIpRank,
  getIpTrend,
  getIpUserDetail,
  getIpUserRank,
  getUserIpDetail,
} from './api'
import type {
  IpAnalysisOverview,
  IpAnalysisTrendRow,
  IpOverlapRow,
  IpRankRow,
  IpUserDetailRow,
  IpUserRankRow,
  UserIpDetailRow,
} from './types'
import {
  buildBarSpec,
  buildTrendLineSpec,
  dayIdxToDate,
  formatTime,
} from './lib'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

const route = getRouteApi('/_authenticated/ip-analysis/')


export function IpAnalysis() {
  const { t } = useTranslation()
  const [days, setDays] = useState(30)
  const [ipVersion, setIpVersion] = useState('all')
  // IPv6 归并到 /64：隐私扩展下一个用户会轮换出几十个地址，
  // 归并后"IP 数"才接近真实来源数（默认关，保持与历史数据可比）。
  const [mergeV6, setMergeV6] = useState(false)
  const DAY_OPTIONS = [
    { value: 7, label: t('7 Days') },
    { value: 30, label: t('30 Days') },
    { value: 90, label: t('90 Days') },
  ]
  const IP_VERSION_OPTIONS = [
    { value: 'all', label: t('All IPs') },
    { value: 'v4', label: t('IPv4 only') },
    { value: 'v6', label: t('IPv6 only') },
  ]

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <Radar className='size-4' aria-hidden='true' />
          <span className='truncate'>{t('IP Analysis')}</span>
          <Badge variant='outline' className='shrink-0'>
            Root
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <label className='text-muted-foreground flex cursor-pointer items-center gap-2 text-sm whitespace-nowrap'>
          <Switch
            checked={mergeV6}
            onCheckedChange={setMergeV6}
            size='sm'
          />
          {t('Merge IPv6 by /64')}
        </label>
        <Select items={DAY_OPTIONS} value={days} onValueChange={(value) => setDays(Number(value))}>
          <SelectTrigger className='h-9'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {DAY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className='whitespace-nowrap'>{opt.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={IP_VERSION_OPTIONS}
          value={ipVersion}
          onValueChange={(value) => setIpVersion(String(value))}
        >
          <SelectTrigger className='h-9'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {IP_VERSION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className='whitespace-nowrap'>{opt.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>

        <IpOverviewSection
          days={days}
          ipVersion={ipVersion}
          mergeV6={mergeV6}
        />

        <Tabs defaultValue='users' className='mt-4'>
          <TabsList>
            <TabsTrigger value='users'>{t('By User')}</TabsTrigger>
            <TabsTrigger value='ips'>{t('By IP')}</TabsTrigger>
            <TabsTrigger value='overlap'>{t('Time Overlap')}</TabsTrigger>
          </TabsList>
          <TabsContent value='users'>
            <UserIpTable days={days} ipVersion={ipVersion} mergeV6={mergeV6} />
          </TabsContent>
          <TabsContent value='ips'>
            <IpUserTable days={days} ipVersion={ipVersion} mergeV6={mergeV6} />
          </TabsContent>
          <TabsContent value='overlap'>
            <OverlapTable days={days} />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function UserIpTable(props: {
  days: number
  ipVersion: string
  mergeV6: boolean
}) {
  const { t } = useTranslation()
  const [detailUserId, setDetailUserId] = useState<number | null>(null)

  const {
    globalFilter,
    onGlobalFilterChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'min_ips' },
    columnFilters: [],
  })
  const minIps = Number(globalFilter?.trim()) || 1

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'ip-analysis-users',
      props.days,
      props.ipVersion,
      props.mergeV6,
      minIps,
      pagination.pageIndex,
    ],
    queryFn: () =>
      getIpUserRank({
        days: props.days,
        min_ips: minIps,
        ip_version: props.ipVersion,
        merge_v6: props.mergeV6 ? 1 : 0,
        page: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo(
    () => [
      {
        accessorKey: 'username',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('User')} />
        ),
        // 「查看」（列显隐）弹层取的是 meta.label —— header 是函数时它读不到，
        // 会退化成列 id（username / ip_count …，界面上就是 Ip_count 那种）；这里与表头同一份译文。
        meta: { label: t('User') },
        cell: ({ row }: { row: { original: IpUserRankRow } }) => (
          <span className='font-medium'>
            {row.original.username}
            {row.original.display_name
              ? ` (${row.original.display_name})`
              : ''}
          </span>
        ),
      },
      {
        accessorKey: 'ip_count',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('IP Count')} />
        ),
        meta: { label: t('IP Count') },
        cell: ({ row }: { row: { original: IpUserRankRow } }) => (
          <Badge
            variant={row.original.ip_count >= 10 ? 'destructive' : 'secondary'}
          >
            {row.original.ip_count}
          </Badge>
        ),
      },
      {
        accessorKey: 'request_count',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('Requests')} />
        ),
        meta: { label: t('Requests') },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        meta: { label: t('Status') },
        cell: ({ row }: { row: { original: IpUserRankRow } }) =>
          row.original.status === 1 ? t('Enabled') : t('Disabled'),
      },
      {
        accessorKey: 'last_seen',
        header: t('Last Seen'),
        meta: { label: t('Last Seen') },
        cell: ({ row }: { row: { original: IpUserRankRow } }) =>
          formatTime(row.original.last_seen),
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }: { row: { original: IpUserRankRow } }) => (
          <div className='-ml-1.5 flex items-center gap-1'>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => setDetailUserId(row.original.user_id)}
                    aria-label={t('View IPs')}
                  />
                }
              >
                <Eye />
              </TooltipTrigger>
              <TooltipContent>{t('View IPs')}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [t]
  )

  const table = useDataTable({
    data: data?.data?.items ?? [],
    columns: columns as never,
    totalCount: data?.data?.total ?? 0,
    globalFilter,
    pagination,
    globalFilterFn: () => true,
    onGlobalFilterChange,
    onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    ensurePageInRange,
  })

  return (
    <>
      <DataTablePage
        table={table.table}
        columns={columns as never}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No data')}
        toolbarProps={{
          searchPlaceholder: t('Min IPs'),
          searchDebounceMs: 500,
        }}
      />
      <UserIpDetailDialog
        userId={detailUserId}
        days={props.days}
        ipVersion={props.ipVersion}
        mergeV6={props.mergeV6}
        onClose={() => setDetailUserId(null)}
      />
    </>
  )
}

function IpUserTable(props: {
  days: number
  ipVersion: string
  mergeV6: boolean
}) {
  const { t } = useTranslation()
  const [detailIp, setDetailIp] = useState<{
    ip: string
    location?: string
  } | null>(null)

  const {
    globalFilter,
    onGlobalFilterChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'min_users' },
    columnFilters: [],
  })
  const minUsers = Number(globalFilter?.trim()) || 1

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'ip-analysis-ips',
      props.days,
      props.ipVersion,
      props.mergeV6,
      minUsers,
      pagination.pageIndex,
    ],
    queryFn: () =>
      getIpRank({
        days: props.days,
        min_users: minUsers,
        ip_version: props.ipVersion,
        merge_v6: props.mergeV6 ? 1 : 0,
        page: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: (previousData) => previousData,
  })

  const columns = useMemo(
    () => [
      {
        accessorKey: 'ip',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('IP')} />
        ),
        meta: { label: t('IP') },
        cell: ({ row }: { row: { original: IpRankRow } }) => (
          <span className='font-mono text-sm'>{row.original.ip}</span>
        ),
      },
      {
        accessorKey: 'location',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('IP Location')} />
        ),
        meta: { label: t('IP Location') },
        cell: ({ row }: { row: { original: IpRankRow } }) => (
          <span className='text-muted-foreground text-xs'>
            {row.original.location || '-'}
          </span>
        ),
      },
      {
        accessorKey: 'user_count',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('Linked Users')} />
        ),
        meta: { label: t('Linked Users') },
        cell: ({ row }: { row: { original: IpRankRow } }) => (
          <Badge
            variant={
              row.original.user_count >= 5 ? 'destructive' : 'secondary'
            }
          >
            {row.original.user_count}
          </Badge>
        ),
      },
      {
        accessorKey: 'request_count',
        header: ({ column }: { column: never }) => (
          <DataTableColumnHeader column={column} title={t('Requests')} />
        ),
        meta: { label: t('Requests') },
      },
      {
        accessorKey: 'last_seen',
        header: t('Last Seen'),
        meta: { label: t('Last Seen') },
        cell: ({ row }: { row: { original: IpRankRow } }) =>
          formatTime(row.original.last_seen),
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }: { row: { original: IpRankRow } }) => (
          <div className='-ml-1.5 flex items-center gap-1'>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() =>
                      setDetailIp({
                        ip: row.original.ip,
                        location: row.original.location,
                      })
                    }
                    aria-label={t('Linked Users')}
                  />
                }
              >
                <Eye />
              </TooltipTrigger>
              <TooltipContent>{t('Linked Users')}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [t]
  )

  const table = useDataTable({
    data: data?.data?.items ?? [],
    columns: columns as never,
    totalCount: data?.data?.total ?? 0,
    globalFilter,
    pagination,
    globalFilterFn: () => true,
    onGlobalFilterChange,
    onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    ensurePageInRange,
  })

  return (
    <>
      <DataTablePage
        table={table.table}
        columns={columns as never}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No data')}
        toolbarProps={{
          searchPlaceholder: t('Min Users'),
          searchDebounceMs: 500,
        }}
      />
      <IpAccountDetailDialog
        ip={detailIp?.ip ?? null}
        location={detailIp?.location}
        days={props.days}
        mergeV6={props.mergeV6}
        onClose={() => setDetailIp(null)}
      />
    </>
  )
}

function UserIpDetailDialog(props: {
  userId: number | null
  days: number
  ipVersion: string
  mergeV6: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const open = props.userId !== null

  const { data, isLoading } = useQuery({
    queryKey: [
      'ip-analysis-user-detail',
      props.userId,
      props.days,
      props.ipVersion,
      props.mergeV6,
    ],
    queryFn: () =>
      getUserIpDetail({
        user_id: props.userId as number,
        days: props.days,
        ip_version: props.ipVersion,
        merge_v6: props.mergeV6 ? 1 : 0,
      }),
    enabled: open,
  })

  const rows: UserIpDetailRow[] = data?.data ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => !next && props.onClose()}>
      {/*
        宽度必须用 sm: 变体覆盖：DialogContent 基础样式里带了 `sm:max-w-sm`（384px），
        它是媒体查询规则、在 CSS 顺序上压过裸的 `max-w-xl`——之前写 `max-w-xl`
        实际不生效，弹窗一直只有 384px，长 IPv6 行撑到 452px → 列表出现横向滚动，
        滚动后每行开头被推出视口（2026-09-20截图里"IP 少了前 10 个字符"）。
      */}
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {t('User IPs')} · UID {props.userId}
          </DialogTitle>
        </DialogHeader>
        {/* overflow-x-hidden：即便有超宽内容也禁止横向滚动（滚动会让整行开头不可见） */}
        <div className='max-h-[50vh] overflow-x-hidden overflow-y-auto'>
          {(() => {
            if (isLoading) {
              return (
                <div className='text-muted-foreground py-6 text-center text-sm'>
                  {t('Loading...')}
                </div>
              )
            }
            if (rows.length === 0) {
              return (
                <div className='text-muted-foreground py-6 text-center text-sm'>
                  {t('No data')}
                </div>
              )
            }
            return (
              <div className='grid gap-1'>
                {rows.map((r) => (
                  <div
                    key={r.ip}
                    className='flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm'
                  >
                    {/* min-w-0 + 换行：IPv6 可以折行显示，不再把行撑宽 */}
                    <span className='flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono break-all'>
                      {r.ip}
                      {r.location ? (
                        <span className='text-muted-foreground text-xs'>
                          {r.location}
                        </span>
                      ) : null}
                    </span>
                    <div className='flex shrink-0 items-center gap-1'>
                      <span className='text-muted-foreground text-xs tabular-nums'>
                        {r.request_count} · {formatTime(r.last_seen)}
                      </span>
                      <CopyButton
                        value={r.ip}
                        size='icon-sm'
                        tooltip={t('Copy to clipboard')}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function requireData<T>(res: {
  success: boolean
  message?: string
  data?: T
}): T {
  if (!res.success || res.data === undefined) {
    throw new Error(res.message ?? 'request failed')
  }
  return res.data
}

/** 图表卡片容器（与运营统计页同款高度与留白）。 */
function ChartCard(props: { isLoading: boolean; children: React.ReactNode }) {
  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='h-[300px] p-1.5 sm:h-80 sm:p-2'>
        {(() => {
          if (props.isLoading) {
            return (
              <div className='flex h-full items-center justify-center'>
                <Loader2 className='text-muted-foreground size-5 animate-spin' />
              </div>
            )
          }
          return props.children
        })()}
      </div>
    </div>
  )
}

/** 风控看板概览：指标卡片 + 用户 IP 数分布 + 每日独立 IP 趋势。 */
function IpOverviewSection(props: {
  days: number
  ipVersion: string
  mergeV6: boolean
}) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const themeManagerRef = useRef<
    (typeof import('@visactor/vchart'))['ThemeManager'] | null
  >(null)
  const [themeReady, setThemeReady] = useState(false)

  useEffect(() => {
    const updateTheme = async () => {
      setThemeReady(false)
      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }
      const ThemeManager = await themeManagerPromise
      themeManagerRef.current = ThemeManager
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }
    void updateTheme()
  }, [resolvedTheme])

  const tzOffsetSeconds = -new Date().getTimezoneOffset() * 60

  const overviewQuery = useQuery({
    queryKey: ['ip-analysis-overview', props.days, props.ipVersion, props.mergeV6],
    queryFn: async () =>
      requireData<IpAnalysisOverview>(
        await getIpOverview({
          days: props.days,
          ip_version: props.ipVersion,
          merge_v6: props.mergeV6 ? 1 : 0,
        })
      ),
    staleTime: 60_000,
  })
  const trendQuery = useQuery({
    queryKey: ['ip-analysis-trend', props.days, props.ipVersion, props.mergeV6],
    queryFn: async () =>
      requireData<IpAnalysisTrendRow[]>(
        await getIpTrend({
          days: props.days,
          ip_version: props.ipVersion,
          tz_offset: tzOffsetSeconds,
          merge_v6: props.mergeV6 ? 1 : 0,
        })
      ),
    staleTime: 60_000,
  })

  const overview = overviewQuery.data

  const cards = [
    {
      labelKey: 'Distinct IPs',
      value: overview ? overview.total_ips.toLocaleString() : undefined,
      icon: Globe,
      tone: 'info' as const,
    },
    {
      labelKey: 'Active Users',
      value: overview ? String(overview.total_users) : undefined,
      icon: Activity,
      tone: 'success' as const,
    },
    {
      labelKey: 'Avg IPs per User',
      value: overview ? overview.avg_ips_per_user.toFixed(1) : undefined,
      icon: BarChart3,
      tone: 'info' as const,
    },
    {
      labelKey: 'Shared IPs',
      value: overview ? overview.shared_ips.toLocaleString() : undefined,
      icon: Share2,
      tone: 'warning' as const,
    },
    {
      labelKey: 'High-risk Users',
      value: overview ? String(overview.risky_users) : undefined,
      icon: ShieldAlert,
      tone: 'destructive' as const,
    },
    {
      labelKey: 'IPv6 Share',
      value: overview ? `${overview.v6_percent}%` : undefined,
      icon: Radar,
      tone: 'info' as const,
    },
  ]

  const distSpec = useMemo(() => {
    const rows = overview?.distribution ?? []
    if (rows.length === 0) return null
    return buildBarSpec(
      rows.map((r) => r.bucket),
      rows.map((r) => r.users),
      t('Users by IP Count'),
      t('Users')
    )
  }, [overview, t])

  const trendSpec = useMemo(() => {
    const rows = trendQuery.data ?? []
    if (rows.length === 0) return null
    return buildTrendLineSpec(
      rows.map((r) => dayIdxToDate(r.day_idx, tzOffsetSeconds)),
      rows.map((r) => r.ips),
      t('Distinct IPs Trend')
    )
  }, [trendQuery.data, t, tzOffsetSeconds])

  return (
    <div className='grid gap-3'>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
        {cards.map((card) => (
          <div key={card.labelKey} className='rounded-lg border p-3 sm:p-4'>
            <div className='flex items-center gap-2'>
              <IconBadge tone={card.tone} size='sm'>
                <card.icon />
              </IconBadge>
              <div className='text-muted-foreground text-xs'>
                {t(card.labelKey)}
              </div>
            </div>
            <div className='mt-2 text-xl font-semibold tabular-nums'>
              {card.value ?? <Skeleton className='h-6 w-16' />}
            </div>
          </div>
        ))}
      </div>
      <div className='grid gap-3 lg:grid-cols-2'>
        <ChartCard isLoading={!themeReady || overviewQuery.isLoading}>
          {distSpec && (
            <VChart
              key={`ip-dist-${resolvedTheme}`}
              spec={{
                ...distSpec,
                theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                background: 'transparent',
              }}
              option={VCHART_OPTION}
            />
          )}
        </ChartCard>
        <ChartCard isLoading={!themeReady || trendQuery.isLoading}>
          {trendSpec && (
            <VChart
              key={`ip-trend-${resolvedTheme}`}
              spec={{
                ...trendSpec,
                theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                background: 'transparent',
              }}
              option={VCHART_OPTION}
            />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

/** 单 IP 关联账号明细弹窗（小号集群排查的最后一跳）。 */
function IpAccountDetailDialog(props: {
  ip: string | null
  location?: string
  days: number
  mergeV6: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const open = props.ip !== null

  const { data, isLoading } = useQuery({
    queryKey: ['ip-analysis-ip-detail', props.ip, props.days, props.mergeV6],
    queryFn: () =>
      getIpUserDetail({
        ip: props.ip as string,
        days: props.days,
        merge_v6: props.mergeV6 ? 1 : 0,
      }),
    enabled: open,
  })

  const rows: IpUserDetailRow[] = data?.data ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {t('Linked Users')}
            {' · '}
            <span className='font-mono text-sm break-all'>{props.ip}</span>
            {props.location ? (
              <span className='text-muted-foreground ml-1 text-xs font-normal'>
                {props.location}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        <div className='max-h-[50vh] overflow-x-hidden overflow-y-auto'>
          {(() => {
            if (isLoading) {
              return (
                <div className='text-muted-foreground py-6 text-center text-sm'>
                  {t('Loading...')}
                </div>
              )
            }
            if (rows.length === 0) {
              return (
                <div className='text-muted-foreground py-6 text-center text-sm'>
                  {t('No data')}
                </div>
              )
            }
            return (
              <div className='grid gap-1'>
                {rows.map((r) => (
                  <div
                    key={r.user_id}
                    className='flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm'
                  >
                    <span className='font-medium'>
                      {r.username}
                      {r.display_name ? ` (${r.display_name})` : ''}
                    </span>
                    <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                      {r.request_count} · {formatTime(r.last_seen)}
                    </span>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 时段重合检测：列出"同时活跃度显著超出随机期望"的账号对。
 *
 * 判据是 实测重合分钟 ÷ 随机期望，不看 IP —— 代理轮换与 CDN 会让 IP 维度失真，
 * 而两个独立用户在同一分钟同时发起请求属于低概率事件，时间维度不受影响。
 */
function OverlapTable(props: { days: number }) {
  const { t } = useTranslation()
  const [minActive, setMinActive] = useState(100)
  const [minOverlap, setMinOverlap] = useState(30)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['ip-analysis-overlap', props.days, minActive, minOverlap],
    queryFn: async () =>
      requireData<IpOverlapRow[]>(
        await getIpOverlap({
          days: props.days,
          min_active_minutes: minActive,
          min_overlap: minOverlap,
          limit: 50,
        })
      ),
    staleTime: 120_000,
  })

  const rows = useMemo(() => data ?? [], [data])

  const columns = useMemo(
    () => [
      {
        accessorKey: 'user_id_a',
        header: t('Account A'),
        meta: { label: t('Account A') },
        cell: ({ row }: { row: { original: IpOverlapRow } }) => (
          <span className='text-sm'>
            {row.original.username_a}
            <span className='text-muted-foreground ml-1 text-xs'>
              #{row.original.user_id_a}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'active_a',
        header: t('Active Minutes A'),
        meta: { label: t('Active Minutes A') },
        cell: ({ row }: { row: { original: IpOverlapRow } }) =>
          row.original.active_a.toLocaleString(),
      },
      {
        accessorKey: 'user_id_b',
        header: t('Account B'),
        meta: { label: t('Account B') },
        cell: ({ row }: { row: { original: IpOverlapRow } }) => (
          <span className='text-sm'>
            {row.original.username_b}
            <span className='text-muted-foreground ml-1 text-xs'>
              #{row.original.user_id_b}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'active_b',
        header: t('Active Minutes B'),
        meta: { label: t('Active Minutes B') },
        cell: ({ row }: { row: { original: IpOverlapRow } }) =>
          row.original.active_b.toLocaleString(),
      },
      {
        accessorKey: 'overlap',
        header: t('Overlap Minutes'),
        meta: { label: t('Overlap Minutes') },
        cell: ({ row }: { row: { original: IpOverlapRow } }) =>
          row.original.overlap.toLocaleString(),
      },
      {
        accessorKey: 'expected',
        header: t('Expected'),
        meta: { label: t('Expected') },
        cell: ({ row }: { row: { original: IpOverlapRow } }) =>
          row.original.expected.toFixed(1),
      },
      {
        accessorKey: 'ratio',
        header: t('Sync Ratio'),
        meta: { label: t('Sync Ratio') },
        cell: ({ row }: { row: { original: IpOverlapRow } }) => (
          <Badge
            variant={row.original.ratio >= 3 ? 'destructive' : 'secondary'}
          >
            {row.original.ratio.toFixed(1)}×
          </Badge>
        ),
      },
    ],
    [t]
  )

  const pagination = useMemo(() => ({ pageIndex: 0, pageSize: 50 }), [])
  const table = useDataTable({
    data: rows,
    columns: columns as never,
    totalCount: rows.length,
    pagination,
    globalFilterFn: () => true,
  })

  const minActiveOptions = [
    { value: 30, label: '30' },
    { value: 100, label: '100' },
    { value: 300, label: '300' },
    { value: 600, label: '600' },
  ]
  const minOverlapOptions = [
    { value: 10, label: '10' },
    { value: 30, label: '30' },
    { value: 60, label: '60' },
    { value: 120, label: '120' },
  ]

  return (
    <div className='grid gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground text-sm'>
          {t('Min Active Minutes')}
        </span>
        <Select
          items={minActiveOptions}
          value={minActive}
          onValueChange={(v) => setMinActive(Number(v))}
        >
          <SelectTrigger className='h-9'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {minActiveOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className='whitespace-nowrap'>{opt.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className='text-muted-foreground ml-2 text-sm'>
          {t('Min Overlap Minutes')}
        </span>
        <Select
          items={minOverlapOptions}
          value={minOverlap}
          onValueChange={(v) => setMinOverlap(Number(v))}
        >
          <SelectTrigger className='h-9'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {minOverlapOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className='whitespace-nowrap'>{opt.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className='text-muted-foreground text-xs'>
          {t(
            'Ratio = actual overlapping minutes ÷ expected (activeA × activeB ÷ window)'
          )}
        </span>
      </div>
      <DataTablePage
        table={table.table}
        columns={columns as never}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No data')}
        paginationInFooter={false}
      />
    </div>
  )
}
