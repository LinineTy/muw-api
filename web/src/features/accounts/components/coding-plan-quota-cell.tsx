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
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CODING_PLAN_PROVIDER_OPTIONS } from '@/features/channels/constants'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getAccountCodingPlanQuota } from '../api'
import { QUOTA_REFRESH_MS } from '../constants'
import type { Account, AccountCodingPlanTier } from '../types'

// 进度条固定宽度：表格列与卡片视图都用它，避免在 auto 布局的表格里被内容撑得忽宽忽窄。
const BAR_WIDTH_CLASS = 'w-16'

function providerLabel(provider: string | null | undefined): string {
  if (!provider) return ''
  return (
    CODING_PLAN_PROVIDER_OPTIONS.find((o) => o.value === provider)?.label ??
    provider
  )
}

/** 窗口短名：5h / Weekly，其余厂商窗口（monthly_limit 等）转成可读文本。 */
function tierLabel(name: string, t: (key: string) => string): string {
  if (name === 'five_hour') return t('5h')
  if (name === 'weekly_limit') return t('Weekly')
  return name
    .replaceAll('_', ' ')
    .replaceAll(/\b\w/g, (ch) => ch.toUpperCase())
}

/** 余量越低越红：≤10% 红、≤30% 琥珀，其余绿。 */
function remainingToneClass(remaining: number): string {
  if (remaining <= 10) return 'bg-destructive'
  if (remaining <= 30) return 'bg-warning'
  return 'bg-emerald-500'
}

function remainingTextClass(remaining: number): string {
  if (remaining <= 10) return 'text-destructive'
  if (remaining <= 30) return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

function formatResetsAt(resetsAt: string | null | undefined): string {
  if (!resetsAt) return '—'
  const ms = new Date(resetsAt).getTime()
  if (Number.isNaN(ms)) return resetsAt
  return new Date(ms).toLocaleString()
}

/**
 * 单条窗口的余量行：窗口短名 + 进度条（填的是**剩余**量）+ 剩余百分比。
 * 悬停给出「已用 x%」与重置时间——条与数字都是剩余口径，避免把 100-util 误读成已用。
 */
function QuotaTierBar({ tier }: { tier: AccountCodingPlanTier }) {
  const { t } = useTranslation()
  const used = Math.max(0, Math.min(100, tier.utilization))
  const remaining = 100 - used
  const detail = t('Used {{pct}}%', { pct: formatPercent(used) })
  const title = tier.resets_at
    ? `${detail} · ${t('Reset')} ${formatResetsAt(tier.resets_at)}`
    : detail

  return (
    <div className='flex items-center gap-1.5' title={title}>
      <span className='text-muted-foreground w-8 shrink-0 text-[11px]'>
        {tierLabel(tier.name, t)}
      </span>
      <div
        className={cn(
          'bg-muted h-1.5 shrink-0 overflow-hidden rounded-full',
          BAR_WIDTH_CLASS
        )}
      >
        <div
          className={cn('h-full rounded-full', remainingToneClass(remaining))}
          style={{ width: `${remaining}%` }}
        />
      </div>
      <span
        className={cn(
          'shrink-0 font-mono text-[11px] tabular-nums',
          remainingTextClass(remaining)
        )}
      >
        {formatPercent(remaining)}
      </span>
    </div>
  )
}

/**
 * 账户维度的编码套餐余量单元格。余量按账户查（多渠道共享同一账户只查一次、
 * 共享同一张卡）。
 *
 * 2026-09-11 起：账户开了监控（`coding_plan_provider`）就**进页面自动查询**并用进度条
 * 直显，不再需要点「查询」；统一由账户页工具栏的「自动刷新」开关控制轮询（默认 5 分钟
 * 一轮，关掉后只有手动刷新才更新）。只有当前页里开了监控的账户会发请求，量可控。
 */
export function CodingPlanQuotaCell({
  account,
  autoRefresh = true,
}: {
  account: Account
  autoRefresh?: boolean
}) {
  const { t } = useTranslation()
  const monitored = Boolean(account.coding_plan_provider)

  const { data, error, isError, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['account-coding-plan-quota', account.id],
    queryFn: () => getAccountCodingPlanQuota(account.id),
    enabled: monitored,
    staleTime: 60_000,
    refetchInterval: autoRefresh && monitored ? QUOTA_REFRESH_MS : false,
    refetchOnWindowFocus: autoRefresh,
    retry: false,
  })

  if (!monitored) {
    return (
      <span className='text-muted-foreground text-xs'>{t('Not monitored')}</span>
    )
  }

  // 上游查询失败时后端仍回 200：success=false 与 HTTP 报错都算失败，原因挂 hover。
  const failed = isError || data?.success === false
  let failureReason = t('Query failed')
  if (isError) {
    failureReason = error instanceof Error ? error.message : t('Query failed')
  } else if (data?.error) {
    failureReason = data.error
  }

  const tiers = data?.tiers ?? []
  let body
  if (isLoading) {
    body = (
      <div className='flex flex-col gap-1'>
        <Skeleton className='h-1.5 w-28' />
        <Skeleton className='h-1.5 w-28' />
      </div>
    )
  } else if (failed) {
    body = (
      <span className='text-destructive text-xs' title={failureReason}>
        {t('Query failed')}
      </span>
    )
  } else if (tiers.length === 0) {
    body = (
      <span
        className='text-muted-foreground text-xs'
        title={t('No quota windows returned for this account.')}
      >
        —
      </span>
    )
  } else {
    body = (
      <div className='flex flex-col gap-1'>
        {tiers.map((tier) => (
          <QuotaTierBar key={tier.name} tier={tier} />
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-1'>
        <span className='text-xs'>
          {providerLabel(account.coding_plan_provider)}
        </span>
        {data?.level ? (
          <span className='bg-muted/60 text-muted-foreground shrink-0 rounded px-1 py-0.5 text-[10px] font-medium'>
            {data.level}
          </span>
        ) : null}
        <TooltipProvider delay={100}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Query quota')}
                  onClick={() => void refetch()}
                />
              }
            >
              <RefreshCw
                className={cn('size-3.5', isFetching && 'animate-spin')}
              />
            </TooltipTrigger>
            <TooltipContent>{t('Query quota')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {body}
    </div>
  )
}
