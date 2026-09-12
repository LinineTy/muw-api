// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { MobileToggleMenu, ToggleMenuItem, TogglePill } from '@/components/ui/responsive-toggle'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { getModelHealth } from './api'
import { HealthLegend } from './components/health-legend'
import { ModelHealthCard } from './components/model-health-card'
import { ModelHealthSummary } from './components/model-health-summary'
import { summarizeModelHealth } from './lib/summary'
import type { ModelHealthRow } from './types'

export function ModelHealth() {
  const { t } = useTranslation()
  // 天数选项走 i18n("24 Hours"/"7 Days"/"30 Days"),跟随用户语言显示。
  const DAY_OPTIONS = [
    { value: 1, label: t('24 Hours') },
    { value: 7, label: t('7 Days') },
    { value: 30, label: t('30 Days') },
  ]
  const [days, setDays] = useState(1)
  const [unhealthyOnly, setUnhealthyOnly] = useState(false)

  const healthQuery = useQuery({
    queryKey: ['model-health', days, unhealthyOnly],
    queryFn: () =>
      getModelHealth({
        days,
        unhealthy: unhealthyOnly || undefined,
      }),
    retry: false,
  })

  const rows = healthQuery.data?.data ?? []

  // Group rows by model, preserving first-seen order, then sort by name.
  const groups = new Map<string, ModelHealthRow[]>()
  for (const row of rows) {
    const list = groups.get(row.model_name)
    if (list) list.push(row)
    else groups.set(row.model_name, [row])
  }
  const modelNames = [...groups.keys()].sort((a, b) => a.localeCompare(b))

  let content: ReactNode
  if (healthQuery.isLoading) {
    content = (
      <div className='space-y-3'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
      </div>
    )
  } else if (modelNames.length === 0) {
    content = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('No health data yet')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'Enable scheduled channel tests or run a manual test to start collecting health data.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    // 汇总统计跟随当前查询范围(天数/仅不健康)：口径抽到 lib/summary.ts（唯一来源），
    // 桌面"健康度"小组件复用同一份，避免两处口径漂移。
    const stats = summarizeModelHealth(rows)
    const {
      channelCount,
      totalTests,
      successRate,
      avgResponseTime,
      unhealthyModelCount,
      trafficModelCount,
    } = stats

    content = (
      <div className='space-y-3'>
        <ModelHealthSummary
          modelCount={modelNames.length}
          channelCount={channelCount}
          totalTests={totalTests}
          successRate={successRate}
          avgResponseTime={avgResponseTime}
          unhealthyModelCount={unhealthyModelCount}
          trafficModelCount={trafficModelCount}
        />
        <HealthLegend />
        {modelNames.map((name) => (
          <ModelHealthCard
            key={name}
            modelName={name}
            rows={groups.get(name) ?? []}
          />
        ))}
      </div>
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('Model Health')}</span>
          <button
            type='button'
            onClick={() => healthQuery.refetch()}
            className='text-muted-foreground hover:text-foreground p-1'
            title={t('Refresh')}
            aria-label={t('Refresh')}
          >
            <RefreshCw className='size-4' />
          </button>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            value={days}
            onValueChange={(value) => setDays(Number(value))}
            items={DAY_OPTIONS}
          >
            <SelectTrigger className='h-9'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {DAY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className='whitespace-nowrap'>{option.label}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <TogglePill
            id='model-health-unhealthy-only'
            label={t('Only unhealthy')}
            icon={<AlertTriangle className='text-muted-foreground size-4' />}
            checked={unhealthyOnly}
            onCheckedChange={setUnhealthyOnly}
          />
          <MobileToggleMenu>
            <ToggleMenuItem
              label={t('Only unhealthy')}
              icon={<AlertTriangle className='size-4' />}
              checked={unhealthyOnly}
              onCheckedChange={setUnhealthyOnly}
            />
          </MobileToggleMenu>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='h-full overflow-y-auto px-2 py-2'>{content}</div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
