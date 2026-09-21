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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { CODING_PLAN_PROVIDER_OPTIONS } from '@/features/channels/constants'
import { formatPercent, formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getAccountCodingPlanQuota } from '../api'
import { isCodingPlanMonitored, QUOTA_REFRESH_MS } from '../constants'
import type {
  Account,
  AccountCodingPlanExtra,
  AccountCodingPlanTier,
} from '../types'

// 进度条宽度：表格单元格（窄）里靠外层的最小轨道撑住，卡片里随列宽拉伸成左右多列。
const TIER_ROW_CLASS = 'flex items-center gap-1.5'
const TIER_GRID_CLASS =
  'grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-4 gap-y-1.5'

function providerLabel(provider: string | null | undefined): string {
  if (!provider) return ''
  return (
    CODING_PLAN_PROVIDER_OPTIONS.find((o) => o.value === provider)?.label ??
    provider
  )
}

/** 窗口短名：5h / Weekly / Monthly / Daily，其余厂商窗口（xx_limit 等）转成可读文本。 */
function tierLabel(name: string, t: (key: string) => string): string {
  if (name === 'five_hour') return t('5h')
  if (name === 'weekly_limit') return t('Weekly')
  if (name === 'monthly_limit') return t('Monthly')
  if (name === 'daily_limit') return t('Daily')
  return name.replaceAll('_', ' ').replaceAll(/\b\w/g, (ch) => ch.toUpperCase())
}

/** 余量越低越红：≤10% 红、≤30% 琥珀，其余绿。 */
function remainingToneClass(remaining: number): string {  if (remaining <= 10) return 'bg-destructive'
  if (remaining <= 30) return 'bg-warning'
  return 'bg-emerald-500'
}

function remainingTextClass(remaining: number): string {
  if (remaining <= 10) return 'text-destructive'
  if (remaining <= 30) return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

// 厂商给的原始额度数值：整数照原样（Kimi 的 1000/600 仍是 1000/600，不加千分位），
// 小数保留两位——credits 类厂商（Command Code）的额度本身就是小数（13.93）。
function formatAmount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

// 厂商给的是 ISO 字符串；统一走全局日期写法（YYYY-MM-DD HH:mm:ss），
// 别用 toLocaleString —— 那会跟着浏览器默认语言变（中文界面里出现 9/13/2026, 3:00:00 PM）。
function formatResetsAt(resetsAt: string | null | undefined): string {
  if (!resetsAt) return '—'
  const ms = new Date(resetsAt).getTime()
  if (Number.isNaN(ms)) return resetsAt
  return formatTimestampToDate(ms, 'milliseconds')
}

/** 余量条：填的是**剩余**量（与右边的百分比同口径）。 */
function QuotaBar({
  remaining,
  className,
}: {
  remaining: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'bg-muted h-1.5 min-w-12 overflow-hidden rounded-full',
        className
      )}
    >
      <div
        className={cn('h-full rounded-full', remainingToneClass(remaining))}
        style={{ width: `${remaining}%` }}
      />
    </div>
  )
}

/**
 * 单元格里的一行：窗口短名 + 余量条 + 剩余百分比，**整行可点** —— 点开列出全部窗口的
 * 居中弹窗（手机上没法悬停，`title` 只在桌面有效；而周限/月限这类窗口一多，单元格里
 * 也塞不下文字。2026-09-13 maintainer定：点条条开居中弹窗，里面所有数据条都在）。
 */
function QuotaTierRow({
  tier,
  onOpen,
}: {
  tier: AccountCodingPlanTier
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const used = Math.max(0, Math.min(100, tier.utilization))
  const remaining = 100 - used
  const label = tierLabel(tier.name, t)
  const title = tier.resets_at
    ? `${t('Used {{pct}}%', { pct: formatPercent(used) })} · ${t('Reset')} ${formatResetsAt(tier.resets_at)}`
    : t('Used {{pct}}%', { pct: formatPercent(used) })

  return (
    <button
      type='button'
      onClick={onOpen}
      title={title}
      aria-label={`${label} · ${t('Remaining')} ${formatPercent(remaining)} · ${title}`}
      className={cn(
        TIER_ROW_CLASS,
        'hover:bg-muted/60 focus-visible:ring-ring/50 w-full cursor-pointer rounded-sm px-0.5 text-left focus-visible:ring-2 focus-visible:outline-hidden'
      )}
    >
      <span className='text-muted-foreground min-w-8 shrink-0 text-[11px] whitespace-nowrap'>
        {label}
      </span>
      <QuotaBar remaining={remaining} className='flex-1' />
      <span
        className={cn(
          'shrink-0 font-mono text-[11px] tabular-nums',
          remainingTextClass(remaining)
        )}
      >
        {formatPercent(remaining)}
      </span>
    </button>
  )
}

/** 弹窗里的一行：窗口名 + 余量条 + 已使用 + **完整重置时间**（厂商给了原始数值就再补一行）。 */
function QuotaTierDetail({ tier }: { tier: AccountCodingPlanTier }) {
  const { t } = useTranslation()
  const used = Math.max(0, Math.min(100, tier.utilization))
  const remaining = 100 - used
  const hasRawValues = tier.limit != null || tier.remaining != null

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <span className='text-sm font-medium'>{tierLabel(tier.name, t)}</span>
        <span
          className={cn(
            'font-mono text-sm tabular-nums',
            remainingTextClass(remaining)
          )}
        >
          {formatPercent(remaining)}
        </span>
      </div>
      <QuotaBar remaining={remaining} className='h-2' />
      <div className='text-muted-foreground text-xs'>
        {t('Used')} {formatPercent(used)}
      </div>
      <div className='text-muted-foreground text-xs'>
        {t('Reset')} {formatResetsAt(tier.resets_at)}
      </div>
      {hasRawValues ? (
        <div className='text-muted-foreground text-xs'>
          {t('Total')} {formatAmount(tier.limit)} · {t('Remaining')}{' '}
          {formatAmount(tier.remaining)}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 窗口外的额外额度（如 Command Code 的额外购买/赠送 credits）：不受任何滚动窗口限制，
 * 只报剩余数值，画成进度条没有意义 —— 所以单独一行文字，不用条。
 */
function ExtraCreditsLine({
  extra,
  className,
}: {
  extra: AccountCodingPlanExtra
  className?: string
}) {
  const { t } = useTranslation()
  const purchased = extra.purchased ?? 0
  const free = extra.free ?? 0
  const total = purchased + free
  if (total <= 0) return null

  return (
    <div
      className={cn(
        'text-muted-foreground text-xs whitespace-nowrap',
        className
      )}
    >
      {t('Extra credits')}{' '}
      <span className='font-mono tabular-nums'>{formatAmount(total)}</span>
      {purchased > 0 && free > 0 ? (
        <span className='opacity-80'>
          {' · '}
          {t('Purchased')} {formatAmount(purchased)}
          {' · '}
          {t('Free credits')} {formatAmount(free)}
        </span>
      ) : null}
    </div>
  )
}

/**
 * 账户维度的编码套餐余量单元格。余量按账户查（多渠道共享同一账户只查一次、
 * 共享同一张卡）。
 *
 * 2026-09-11 起：账户开了监控（`coding_plan_provider`）就**进页面自动查询**并用进度条
 * 直显，不再需要点「查询」；统一由账户页工具栏的「自动刷新」开关控制轮询（默认 30s 一轮，
 * 与后端自动启停任务的 tick 对齐；关掉后只有手动刷新才更新）。只有当前页里开了监控的
 * 账户会发请求，量可控。
 */
export function CodingPlanQuotaCell({
  account,
  autoRefresh = true,
}: {
  account: Account
  autoRefresh?: boolean
}) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const monitored = isCodingPlanMonitored(account.coding_plan_provider)

  const { data, error, isError, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['account-coding-plan-quota', account.id],
    queryFn: () => getAccountCodingPlanQuota(account.id),
    enabled: monitored,
    staleTime: QUOTA_REFRESH_MS,
    refetchInterval: autoRefresh && monitored ? QUOTA_REFRESH_MS : false,
    refetchOnWindowFocus: autoRefresh,
    retry: false,
  })

  if (!monitored) {
    return (
      <span className='text-muted-foreground text-xs'>
        {t('Not monitored')}
      </span>
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
      <div className={TIER_GRID_CLASS}>
        <Skeleton className='h-1.5 w-full' />
        <Skeleton className='h-1.5 w-full' />
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
      <div className={TIER_GRID_CLASS}>
        {tiers.map((tier) => (
          <QuotaTierRow
            key={tier.name}
            tier={tier}
            onOpen={() => setDetailsOpen(true)}
          />
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
      {!failed && data?.extra ? <ExtraCreditsLine extra={data.extra} /> : null}
      <Dialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={t('Coding plan quota')}
        description={[providerLabel(account.coding_plan_provider), data?.level]
          .filter(Boolean)
          .join(' · ')}
        contentClassName='sm:max-w-md'
      >
        <div className='flex flex-col gap-5'>
          {tiers.map((tier) => (
            <QuotaTierDetail key={tier.name} tier={tier} />
          ))}
          {data?.extra ? <ExtraCreditsLine extra={data.extra} /> : null}
        </div>
      </Dialog>
    </div>
  )
}
