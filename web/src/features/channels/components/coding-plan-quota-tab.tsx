// @muw-owned
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Gauge,
  Loader2,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShieldOff,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSectionClassName,
} from '@/components/drawer-layout'
import { formatCompactNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getChannelCodingPlanQuota, getChannels } from '../api'
import {
  CODING_PLAN_PROVIDER_DISABLED,
  CODING_PLAN_PROVIDER_OPTIONS,
  detectCodingPlanProvider,
} from '../constants'
import type { Channel, CodingPlanQuota, CodingPlanTier } from '../types'

const QUOTA_REFRESH_MS = 5 * 60 * 1000

// 自动刷新开关的本地持久化键:默认开启,关闭后余量仅在手动刷新时更新。
const AUTO_REFRESH_STORAGE_KEY = 'coding-plan-auto-refresh'

// 渠道是否启用编码套餐余量监控:显式配置了厂商,或 base_url 是套餐符号键/套餐专用地址。
// 显式关闭监控("none",手动/自定义渠道默认)一律视为不监控,即使 base_url 是套餐端点。
// 账户化后套餐配置在账户上：渠道的监控状态看绑定账户（渠道内有启用且配了厂商的账户）。
// 迁移过渡期：渠道还没绑任何账户时，回退看渠道自身的 legacy 列。
function monitoredAccounts(channel: Channel) {
  return (channel.account_bindings ?? []).filter(
    (binding) =>
      binding.enabled &&
      Boolean(binding.coding_plan_provider) &&
      binding.coding_plan_provider !== CODING_PLAN_PROVIDER_DISABLED
  )
}

function isQuotaEnabled(channel: Channel): boolean {
  if ((channel.account_bindings ?? []).length > 0) {
    return monitoredAccounts(channel).length > 0
  }
  if (channel.coding_plan_provider === CODING_PLAN_PROVIDER_DISABLED) {
    return false
  }
  return Boolean(
    channel.coding_plan_provider ||
      detectCodingPlanProvider(channel.base_url)
  )
}

// 厂商展示名：以绑定账户上的配置为准（配置已迁到账户），无绑定时回退渠道 legacy 列。
function providerLabel(
  channel: Channel,
  t: (key: string) => string
): string {
  const accountProvider = monitoredAccounts(channel)[0]?.coding_plan_provider
  let provider = accountProvider ?? ''
  if (!provider && channel.coding_plan_provider !== CODING_PLAN_PROVIDER_DISABLED) {
    provider =
      channel.coding_plan_provider ||
      detectCodingPlanProvider(channel.base_url) ||
      ''
  }
  if (provider) {
    const option = CODING_PLAN_PROVIDER_OPTIONS.find(
      (item) => item.value === provider
    )
    return option ? t(option.label) : provider
  }
  return ''
}

function tierColorClass(percent: number) {
  if (percent >= 90) return 'text-red-500'
  if (percent >= 70) return 'text-amber-500'
  return 'text-emerald-500'
}

function tierNameLabel(name: string, t: (key: string) => string) {
  if (name === 'five_hour') return t('5 Hour Window')
  if (name === 'weekly_limit') return t('Weekly Limit')
  // 未知窗口兜底:后端 tier name 是 snake_case(如 monthly_limit),未来厂商/套餐
  // 若返回月窗、日窗等新窗口,也转成可读文本展示,而不是直接显示下划线原名。
  return name
    .replaceAll('_', ' ')
    .replaceAll(/\b\w/g, (ch) => ch.toUpperCase())
}

function formatResetsAt(resetsAt: string | null | undefined): string {
  if (!resetsAt) return '—'
  const ms = new Date(resetsAt).getTime()
  if (Number.isNaN(ms)) return resetsAt
  return new Date(ms).toLocaleString()
}

// 单条用量行(对齐钱包订阅卡的 LimitRow):label 左、已用/限额(或百分比)右,进度条按
// 使用率阈值变色(>=90 红 / >=70 琥珀 / 其余主色),底部显示重置时间。仅 Kimi 等
// 厂商返回原始数值(limit/remaining),其余回退成百分比。
function QuotaTierRow({ tier }: { tier: CodingPlanTier }) {
  const { t } = useTranslation()
  const pct = Math.max(0, Math.min(100, tier.utilization))
  let barClass = 'bg-primary'
  if (pct >= 90) {
    barClass = 'bg-destructive'
  } else if (pct >= 70) {
    barClass = 'bg-warning'
  }
  const value =
    tier.limit != null && tier.limit > 0
      ? `${formatCompactNumber(tier.used ?? 0)} / ${formatCompactNumber(
          tier.limit
        )}`
      : formatPercent(tier.utilization)

  return (
    <div className='py-2.5'>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='min-w-0 truncate text-sm font-medium'>
          {tierNameLabel(tier.name, t)}
        </span>
        <span
          className={cn(
            'shrink-0 font-mono text-sm font-medium tabular-nums',
            tierColorClass(tier.utilization)
          )}
          title={
            tier.limit != null && tier.limit > 0
              ? t('Used {{pct}}%', { pct: formatPercent(tier.utilization) })
              : undefined
          }
        >
          {value}
        </span>
      </div>
      <div className='bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full'>
        <div
          className={cn('h-full rounded-full', barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {tier.resets_at && (
        <div className='text-muted-foreground mt-1 text-xs'>
          {t('Reset')} {formatResetsAt(tier.resets_at)}
        </div>
      )}
    </div>
  )
}

// 底部功能状态小图标:纯彩色图标 + tooltip,无背景(卡片本身带半透明 --table-row,
// 不再叠 bg-muted 圆圈,避免在深色主题下变成一圈黑)。
function StateChip({
  icon: Icon,
  label,
  tone,
}: {
  icon: LucideIcon
  label: string
  tone: 'success' | 'warning' | 'neutral'
}) {
  const toneClass = {
    success: 'text-success',
    warning: 'text-warning',
    neutral: 'text-muted-foreground',
  }[tone]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              'inline-flex cursor-help items-center justify-center',
              toneClass
            )}
          />
        }
      >
        <Icon className='size-4' aria-hidden='true' />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ChannelQuotaCard({
  channels,
  autoRefresh,
}: {
  channels: Channel[]
  autoRefresh: boolean
}) {
  const { t } = useTranslation()
  // 同 key 多渠道合并成一张卡:余量是账号级数据,取组内任一渠道查询即可。
  const channel = channels[0]
  const [manageOpen, setManageOpen] = useState(false)

  const quotaQuery = useQuery({
    queryKey: ['channels', 'coding-plan-quota', channel.id],
    queryFn: async () => {
      const res = await getChannelCodingPlanQuota(channel.id)
      if (!res.success) {
        throw new Error(res.message || t('Quota query failed'))
      }
      // 上游查询失败时后端仍回 200：把原因抛出来，卡片显示具体错误而不是空窗口。
      if (res.data && res.data.success === false) {
        throw new Error(res.data.error || t('Quota query failed'))
      }
      return res.data
    },
    retry: false,
    // 关闭自动刷新后不再轮询,也不在窗口聚焦时重新拉取,只有手动刷新才更新。
    refetchInterval: autoRefresh ? QUOTA_REFRESH_MS : false,
    refetchOnWindowFocus: autoRefresh,
    staleTime: 60 * 1000,
  })

  const providerLabelText = providerLabel(channel, t)
  // 自动控制在账户上；渠道 legacy 列只作迁移过渡的回退。
  const autoControl =
    monitoredAccounts(channel)[0]?.coding_plan_auto_control ??
    channel.coding_plan_auto_control ??
    false
  let quotaArea
  if (quotaQuery.isLoading) {
    quotaArea = (
      <div className='space-y-2 py-1'>
        <Skeleton className='h-3 w-1/3' />
        <Skeleton className='h-1.5 w-full' />
        <Skeleton className='h-1.5 w-full' />
      </div>
    )
  } else if (quotaQuery.isError) {
    quotaArea = (
      <div className='text-muted-foreground py-2 text-xs'>
        {quotaQuery.error instanceof Error
          ? quotaQuery.error.message
          : t('Quota query failed')}
      </div>
    )
  } else if (quotaQuery.data) {
    const quota = quotaQuery.data
    quotaArea =
      (quota.tiers?.length ?? 0) > 0 ? (
        <div className='divide-y divide-border'>
          {(quota.tiers ?? []).map((tier) => (
            <QuotaTierRow key={tier.name} tier={tier} />
          ))}
        </div>
      ) : (
        <p className='text-muted-foreground py-2 text-xs'>
          {t('No quota windows returned for this account.')}
        </p>
      )
  } else {
    quotaArea = null
  }

  return (
    <div className='rounded-lg border bg-(--data-table-card-bg,var(--table-row)) px-3 py-2.5'>
      {/* 顶:套餐名(厂商) + 右上角操作按钮(刷新 / 详情齿轮,纯图标无背景) */}
      <div className='flex items-center justify-between gap-2'>
        <h3 className='min-w-0 truncate text-sm font-semibold tracking-tight'>
          {providerLabelText}
        </h3>
        <div className='flex shrink-0 items-center'>
          <button
            type='button'
            className='text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:text-foreground'
            onClick={() => void quotaQuery.refetch()}
            disabled={quotaQuery.isFetching}
            aria-label={t('Refresh')}
          >
            {quotaQuery.isFetching ? (
              <Loader2 className='size-4 animate-spin' aria-hidden='true' />
            ) : (
              <RefreshCw className='size-4' aria-hidden='true' />
            )}
          </button>
          <button
            type='button'
            className='text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:text-foreground'
            onClick={() => setManageOpen(true)}
            aria-label={t('Quota Details')}
          >
            <Settings className='size-4' aria-hidden='true' />
          </button>
        </div>
      </div>

      {/* 中:用量条 */}
      <div className='flex flex-col' aria-busy={quotaQuery.isFetching}>
        {quotaArea}
      </div>

      {/* 底:功能状态标签置底(对齐钱包订阅卡底部徽标:极简图标 + tooltip) */}
      <div className='mt-2 flex items-center gap-1.5'>
        <TooltipProvider delay={100}>
          <StateChip
            icon={Gauge}
            label={t('Quota monitoring enabled')}
            tone='warning'
          />
          <StateChip
            icon={autoControl ? ShieldCheck : ShieldOff}
            label={
              autoControl ? t('Auto-manage: On') : t('Auto-manage: Off')
            }
            tone={autoControl ? 'success' : 'neutral'}
          />
        </TooltipProvider>
      </div>

      <CodingPlanAutoControlSheet
        channels={channels}
        quota={quotaQuery.data ?? null}
        open={manageOpen}
        onOpenChange={setManageOpen}
      />
    </div>
  )
}

/**
 * 详情抽屉：从卡片右上角按钮打开。展示该套餐账号的用量详情、引用渠道与自动控制状态；
 * 自动控制的配置在账户抽屉里（余量配置已随账户改造迁到账户上），这里只读。
 */
function CodingPlanAutoControlSheet({
  channels,
  quota,
  open,
  onOpenChange,
}: {
  channels: Channel[]
  quota: CodingPlanQuota | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const channel = channels[0]
  const providerLabelText = providerLabel(channel, t)
  const monitored = monitoredAccounts(channel)
  const autoControlOn =
    monitored[0]?.coding_plan_auto_control ??
    channel.coding_plan_auto_control ??
    false

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-md')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle className='flex items-center gap-2 text-sm'>
            <Gauge className='text-warning size-4' aria-hidden='true' />
            <span className='min-w-0 truncate'>{providerLabelText}</span>
            {quota?.level ? (
              <span className='bg-muted/60 text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium'>
                {quota.level}
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription className='text-xs'>
            {t('Applied to every channel sharing this coding-plan account.')}
          </SheetDescription>
        </SheetHeader>
        <div className={sideDrawerFormClassName()}>
          {/* 渠道 */}
          <div className={sideDrawerSectionClassName()}>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('Channels')}
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {channels.map((ch) => (
                <span
                  key={ch.id}
                  className='bg-muted/60 text-muted-foreground rounded-md px-2 py-0.5 text-xs'
                >
                  {ch.name}
                </span>
              ))}
            </div>
          </div>

          {/* 用量详情 */}
          {quota && (
            <div className={sideDrawerSectionClassName()}>
              <div className='text-muted-foreground text-xs font-medium'>
                {t('Quota Details')}
              </div>
              {(quota.tiers?.length ?? 0) > 0 ? (
                <div className='divide-y divide-border'>
                  {(quota.tiers ?? []).map((tier) => (
                    <QuotaTierRow key={tier.name} tier={tier} />
                  ))}
                </div>
              ) : (
                <p className='text-muted-foreground text-xs'>
                  {t('No quota windows returned for this account.')}
                </p>
              )}
            </div>
          )}

          {/* 自动管理（配置在账户上，这里只读） */}
          <div className={sideDrawerSectionClassName()}>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('Auto-manage')}
            </div>
            <p className='text-xs'>
              {autoControlOn ? t('Auto-manage: On') : t('Auto-manage: Off')}
            </p>
            {monitored.length > 0 && (
              <p className='text-muted-foreground text-xs'>
                {t('Quota monitoring account')}:{' '}
                {monitored.map((binding) => binding.name).join(' / ')}
              </p>
            )}
            <p className='text-muted-foreground text-xs'>
              {t('Auto-control and thresholds are configured on the account.')}{' '}
              <a className='text-primary underline' href='/accounts'>
                {t('Accounts')}
              </a>
            </p>
          </div>
        </div>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Coding-plan quota tab: lists coding-plan quota monitoring groups. Channels
 * sharing the same provider + key are merged into a single card (quota is
 * account-level), each card queries the upstream once.
 */
export function CodingPlanQuotaTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [autoRefresh, setAutoRefresh] = useState(() => {
    return localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) !== 'false'
  })

  const handleAutoRefreshToggle = (checked: boolean) => {
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(checked))
    setAutoRefresh(checked)
  }

  const channelsQuery = useQuery({
    queryKey: ['channels', 'list', 'coding-plan-enabled'],
    queryFn: async () => {
      const res = await getChannels({ page_size: 1000 })
      if (!res.success || !res.data) {
        throw new Error(res.message || t('Failed to load channels'))
      }
      return res.data.items
    },
    staleTime: 30 * 1000,
  })

  const channels = (channelsQuery.data ?? []).filter(isQuotaEnabled)

  // 按 key 合并:同一"厂商 + 密钥指纹"的渠道并成一组,只查/只展示一份账号级余量。
  // 指纹缺失时(如列表接口未下发)各自独立成组。
  const groups = useMemo(() => {
    const map = new Map<string, Channel[]>()
    for (const ch of channels) {
      const groupId = ch.coding_plan_quota_group || `ch:${ch.id}`
      const arr = map.get(groupId)
      if (arr) {
        arr.push(ch)
      } else {
        map.set(groupId, [ch])
      }
    }
    return [...map.values()]
  }, [channels])

  const refreshAll = () => {
    void queryClient.invalidateQueries({
      queryKey: ['channels', 'coding-plan-quota'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['channels', 'list', 'coding-plan-enabled'],
    })
  }

  let content
  if (channelsQuery.isLoading) {
    content = (
      <div className='grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3'>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className='h-40 w-full rounded-lg border' />
        ))}
      </div>
    )
  } else if (channelsQuery.isError) {
    content = (
      <div className='border-destructive/20 bg-destructive/5 rounded-md border px-4 py-8 text-center text-xs'>
        <p className='text-destructive font-medium'>
          {t('Failed to load channels')}
        </p>
        {channelsQuery.error instanceof Error ? (
          <p className='text-muted-foreground mt-1'>
            {channelsQuery.error.message}
          </p>
        ) : null}
      </div>
    )
  } else if (channels.length === 0) {
    content = (
      <div className='bg-muted/40 px-4 py-12 text-center text-sm text-muted-foreground'>
        {t(
          'No channels have coding-plan quota monitoring enabled yet. Open a channel and enable it in the form.'
        )}
      </div>
    )
  } else {
    content = (
      <div className='grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3'>
        {groups.map((group) => (
          <ChannelQuotaCard
            key={group[0].id}
            channels={group}
            autoRefresh={autoRefresh}
          />
        ))}
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>
          {t('Channels with coding-plan quota monitoring enabled.')}
        </p>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
          <div className='flex items-center gap-1.5'>
            <Label
              htmlFor='coding-plan-auto-refresh'
              className='text-muted-foreground cursor-pointer text-xs'
            >
              {t('Auto refresh')}
            </Label>
            <Switch
              id='coding-plan-auto-refresh'
              size='sm'
              checked={autoRefresh}
              onCheckedChange={handleAutoRefreshToggle}
            />
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={refreshAll}
            disabled={channels.length === 0}
            aria-label={t('Refresh All')}
          >
            <RefreshCw
              data-icon='inline-start'
              className='size-3.5'
              aria-hidden='true'
            />
            {t('Refresh All')}
          </Button>
        </div>
      </div>
      {content}
    </div>
  )
}
