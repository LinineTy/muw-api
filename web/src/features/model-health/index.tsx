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
    // 汇总统计跟随当前查询范围(天数/仅不健康),直接由 rows 聚合。
    const channelCount = new Set(rows.map((row) => row.channel_id)).size
    const totalTests = rows.reduce((sum, row) => sum + row.test_count, 0)
    const totalSuccess = rows.reduce((sum, row) => sum + row.success_count, 0)
    // 汇总成功率与技术口径对齐(client 错误不进分母、审核拦截计成功),
    // 与卡片 badge、非管理员视图一致。
    const totalClientErrors = rows.reduce(
      (sum, row) => sum + (row.client_error_count ?? 0),
      0
    )
    const totalModeration = rows.reduce(
      (sum, row) => sum + (row.moderation_count ?? 0),
      0
    )
    const denom = totalTests - totalClientErrors
    const successRate =
      denom > 0 ? ((totalSuccess + totalModeration) / denom) * 100 : 100
    const weightedLatency = rows.reduce(
      (sum, row) => sum + row.avg_response_time * row.test_count,
      0
    )
    const avgResponseTime = totalTests > 0 ? weightedLatency / totalTests : 0
    // "异常模型" = 该模型任一 (channel, model) 行成功率低于 100%。
    const unhealthyModelCount = [...groups.values()].filter((rows) =>
      rows.some((row) => row.success_rate < 100)
    ).length
    const trafficModelCount = [...groups.values()].filter((rows) =>
      rows.some((row) => (row.user_traffic_count ?? 0) > 0)
    ).length

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
            <SelectTrigger className='h-9 w-28'>
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
