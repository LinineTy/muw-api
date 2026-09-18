// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import {
  Activity,
  BarChart3,
  DollarSign,
  Loader2,
  ServerCog,
  UserPlus,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTheme } from '@/context/theme-provider'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { VCHART_OPTION } from '@/lib/vchart'

import {
  getOperationsDistributions,
  getOperationsOverview,
  getOperationsRankings,
  getOperationsTrends,
} from './api'
import {
  buildPieSpec,
  buildTrendLineSpec,
  fillTrendDays,
} from './lib'
import {
  SOURCE_LABEL_KEYS,
  type OperationsDistributions,
  type OperationsOverview,
  type OperationsRankings,
  type OperationsTrendRow,
} from './types'

const DAY_OPTIONS = [
  { value: 7, labelKey: '7 Days' },
  { value: 30, labelKey: '30 Days' },
  { value: 90, labelKey: '90 Days' },
]

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

export function OperationsStats() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [days, setDays] = useState(30)
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

  const overviewQuery = useQuery({
    queryKey: ['operations-stats-overview'],
    queryFn: async () => requireData<OperationsOverview>(await getOperationsOverview()),
    staleTime: 60_000,
  })
  const trendsQuery = useQuery({
    queryKey: ['operations-stats-trends', days],
    queryFn: async () => requireData<OperationsTrendRow[]>(await getOperationsTrends(days)),
    staleTime: 60_000,
  })
  const distributionsQuery = useQuery({
    queryKey: ['operations-stats-distributions'],
    queryFn: async () => requireData<OperationsDistributions>(await getOperationsDistributions()),
    staleTime: 300_000,
  })
  const rankingsQuery = useQuery({
    queryKey: ['operations-stats-rankings', days],
    queryFn: async () => requireData<OperationsRankings>(await getOperationsRankings(days)),
    staleTime: 60_000,
  })

  const tzOffsetSeconds = -new Date().getTimezoneOffset() * 60
  const trends = useMemo(() => {
    const rows = trendsQuery.data ?? []
    return fillTrendDays(rows, days, tzOffsetSeconds)
  }, [trendsQuery.data, days, tzOffsetSeconds])

  const overview = overviewQuery.data
  const distributions = distributionsQuery.data
  const rankings = rankingsQuery.data

  const cards = [
    {
      labelKey: 'Total Users',
      value: overview ? String(overview.total_users) : undefined,
      icon: Users,
      tone: 'info' as const,
    },
    {
      labelKey: 'New Users Today',
      value: overview ? String(overview.new_users_today) : undefined,
      icon: UserPlus,
      tone: 'success' as const,
    },
    {
      labelKey: 'Active Users Today',
      value: overview ? String(overview.active_today) : undefined,
      icon: Activity,
      tone: 'warning' as const,
    },
    {
      labelKey: 'Requests Today',
      value: overview ? overview.requests_today.toLocaleString() : undefined,
      icon: BarChart3,
      tone: 'info' as const,
    },
    {
      labelKey: 'Spend Today',
      value: overview
        ? formatQuotaWithCurrency(overview.quota_today)
        : undefined,
      icon: DollarSign,
      tone: 'success' as const,
    },
    {
      labelKey: 'Disabled Users',
      value: overview ? String(overview.disabled_users) : undefined,
      icon: Users,
      tone: 'destructive' as const,
    },
  ]

  const sourceSpec = useMemo(() => {
    const rows = distributions?.sources ?? []
    if (rows.length === 0) return null
    return buildPieSpec(
      rows.map((r) => ({
        name: SOURCE_LABEL_KEYS[r.key] ?? r.key,
        value: r.count,
      })),
      t('Registration Sources')
    )
  }, [distributions, t])

  const trendSpec = useMemo(() => {
    if (trends.dates.length === 0) return null
    return buildTrendLineSpec(
      trends.dates,
      [
        {
          name: t('New Users'),
          values: trends.series.map((r) => r.new_users),
          color: '#5470c6',
        },
        {
          name: t('Active Users'),
          values: trends.series.map((r) => r.active_users),
          color: '#91cc75',
        },
      ],
      t('User Growth & Activity')
    )
  }, [trends, t])

  const usageSpec = useMemo(() => {
    if (trends.dates.length === 0) return null
    return buildTrendLineSpec(
      trends.dates,
      [
        {
          name: t('Requests'),
          values: trends.series.map((r) => r.requests),
          color: '#fac858',
        },
        {
          name: t('Active Users'),
          values: trends.series.map((r) => r.active_users),
          color: '#91cc75',
        },
      ],
      t('Request Volume')
    )
  }, [trends, t])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <BarChart3 className='size-4' aria-hidden='true' />
          <span className='truncate'>{t('Operations Stats')}</span>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-wrap items-center gap-2 pb-3'>
          <Select value={days} onValueChange={(value) => setDays(Number(value))}>
            <SelectTrigger className='h-9 w-32'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {DAY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className='whitespace-nowrap'>{t(opt.labelKey)}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
          {cards.map((card) => (
            <div
              key={card.labelKey}
              className='rounded-lg border p-3 sm:p-4'
            >
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

        <div className='mt-4 grid gap-3 lg:grid-cols-2'>
          <ChartCard isLoading={!themeReady || trendsQuery.isLoading}>
            {trendSpec && (
              <VChart
                key={`trend-${resolvedTheme}`}
                spec={{
                  ...trendSpec,
                  theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                  background: 'transparent',
                }}
                option={VCHART_OPTION}
              />
            )}
          </ChartCard>
          <ChartCard isLoading={!themeReady || trendsQuery.isLoading}>
            {usageSpec && (
              <VChart
                key={`usage-${resolvedTheme}`}
                spec={{
                  ...usageSpec,
                  theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                  background: 'transparent',
                }}
                option={VCHART_OPTION}
              />
            )}
          </ChartCard>
        </div>

        <div className='mt-4 grid gap-3 lg:grid-cols-3'>
          <ChartCard isLoading={!themeReady || distributionsQuery.isLoading}>
            {sourceSpec && (
              <VChart
                key={`source-${resolvedTheme}`}
                spec={{
                  ...sourceSpec,
                  theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                  background: 'transparent',
                }}
                option={VCHART_OPTION}
              />
            )}
          </ChartCard>
          <DistributionCard
            title={t('Trust Levels')}
            isLoading={distributionsQuery.isLoading}
            rows={(distributions?.trust_levels ?? []).map((r) => ({
              key: `L${r.level}`,
              count: r.count,
            }))}
          />
          <DistributionCard
            title={t('User Groups')}
            isLoading={distributionsQuery.isLoading}
            rows={distributions?.groups ?? []}
          />
        </div>

        <div className='mt-4 grid gap-3 lg:grid-cols-2'>
          <RankingCard
            title={t('Model Usage Ranking')}
            icon={ServerCog}
            isLoading={rankingsQuery.isLoading}
            rows={(rankings?.models ?? []).map((r) => ({
              key: r.key,
              name: r.name,
              requests: r.requests,
              users: r.users,
            }))}
          />
          <RankingCard
            title={t('Channel Usage Ranking')}
            icon={ServerCog}
            isLoading={rankingsQuery.isLoading}
            rows={(rankings?.channels ?? []).map((r) => ({
              key: r.key,
              name: r.name || r.key,
              requests: r.requests,
              users: r.users,
            }))}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
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

function ChartCard(props: {
  isLoading: boolean
  children: React.ReactNode
}) {
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

function DistributionCard(props: {
  title: string
  isLoading: boolean
  rows: { key: string; count: number }[]
}) {
  const { t } = useTranslation()
  const total = props.rows.reduce((acc, r) => acc + r.count, 0)
  return (
    <div className='rounded-lg border p-3 sm:p-4'>
      <div className='text-sm font-semibold'>{props.title}</div>
      <div className='mt-3 grid gap-2'>
        {(() => {
          if (props.isLoading) {
            return <Skeleton className='h-20 w-full' />
          }
          if (props.rows.length === 0) {
            return (
              <div className='text-muted-foreground text-sm'>{t('No data')}</div>
            )
          }
          return props.rows
            .slice()
            .sort((a, b) => b.count - a.count)
            .map((r) => (
              <div key={r.key} className='flex items-center gap-2'>
                <div className='w-14 shrink-0 text-xs tabular-nums'>
                  {r.key}
                </div>
                <div className='bg-secondary h-2 flex-1 overflow-hidden rounded-full'>
                  <div
                    className='bg-primary h-full rounded-full'
                    style={{
                      width: `${total > 0 ? (r.count / total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className='w-12 shrink-0 text-right text-xs tabular-nums'>
                  {r.count}
                </div>
              </div>
            ))
        })()}
      </div>
    </div>
  )
}

function RankingCard(props: {
  title: string
  icon: typeof ServerCog
  isLoading: boolean
  rows: { key: string; name: string; requests: number; users: number }[]
}) {
  const { t } = useTranslation()

  let body: React.ReactNode
  if (props.isLoading) {
    body = <Skeleton className='h-32 w-full' />
  } else if (props.rows.length === 0) {
    body = <div className='text-muted-foreground text-sm'>{t('No data')}</div>
  } else {
    body = props.rows.map((r, i) => (
      <div
        key={r.key}
        className='flex items-center justify-between gap-2 py-1 text-sm'
      >
        <div className='flex min-w-0 items-center gap-2'>
          <span className='text-muted-foreground w-5 text-xs tabular-nums'>
            {i + 1}
          </span>
          <span className='truncate font-medium'>{r.name}</span>
        </div>
        <div className='text-muted-foreground shrink-0 text-xs tabular-nums'>
          {r.requests.toLocaleString()} · {r.users} users
        </div>
      </div>
    ))
  }

  return (
    <div className='rounded-lg border p-3 sm:p-4'>
      <div className='flex items-center gap-2'>
        <IconBadge tone='info' size='sm'>
          <props.icon />
        </IconBadge>
        <div className='text-sm font-semibold'>{props.title}</div>
      </div>
      <div className='mt-3 grid gap-1'>{body}</div>
    </div>
  )
}
