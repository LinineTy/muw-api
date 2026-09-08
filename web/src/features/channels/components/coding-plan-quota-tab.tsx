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
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

import { getChannelCodingPlanQuota, getChannels, updateChannel } from '../api'
import {
  CHANNEL_STATUS,
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
function isQuotaEnabled(channel: Channel): boolean {
  if (channel.coding_plan_provider === CODING_PLAN_PROVIDER_DISABLED) {
    return false
  }
  return Boolean(
    channel.coding_plan_provider ||
      detectCodingPlanProvider(channel.base_url)
  )
}

// 厂商展示名:显式 provider 优先,其次按 base_url 探测出的厂商。
function providerLabel(
  channel: Channel,
  t: (key: string) => string
): string {
  if (channel.coding_plan_provider === CODING_PLAN_PROVIDER_DISABLED) {
    return ''
  }
  const provider =
    channel.coding_plan_provider ||
    detectCodingPlanProvider(channel.base_url)
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
      return res.data
    },
    retry: false,
    // 关闭自动刷新后不再轮询,也不在窗口聚焦时重新拉取,只有手动刷新才更新。
    refetchInterval: autoRefresh ? QUOTA_REFRESH_MS : false,
    refetchOnWindowFocus: autoRefresh,
    staleTime: 60 * 1000,
  })

  const providerLabelText = providerLabel(channel, t)
  const autoControl = channel.coding_plan_auto_control ?? false
  const effectiveUtilization =
    quotaQuery.data && quotaQuery.data.tiers.length > 0
      ? Math.max(...quotaQuery.data.tiers.map((tier) => tier.utilization))
      : null

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
      quota.tiers.length > 0 ? (
        <div className='divide-y divide-border'>
          {quota.tiers.map((tier) => (
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
            aria-label={t('Coding plan auto-control settings')}
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
        utilization={effectiveUtilization}
        open={manageOpen}
        onOpenChange={setManageOpen}
      />
    </div>
  )
}

/**
 * 自动启停配置表单(组级语义):配置存组内每渠道并保持同步,改代表渠道 = 改整个套餐
 * 账号。放在详情抽屉里,抽屉开合期间配置变化会即时保存并同步到同 key 渠道。
 */
function CodingPlanAutoControlForm({
  channel,
  utilization,
}: {
  channel: Channel
  utilization: number | null // 有效用量(各窗口最大值);余量查询失败/加载中为 null
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(
    channel.coding_plan_auto_control ?? false
  )
  const [disableThreshold, setDisableThreshold] = useState(
    channel.coding_plan_disable_threshold ?? 98
  )
  const [enableThreshold, setEnableThreshold] = useState(
    channel.coding_plan_enable_threshold ?? 90
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 配置变化(保存回读或其它入口改动)时同步本地态。
  useEffect(() => {
    setEnabled(channel.coding_plan_auto_control ?? false)
    setDisableThreshold(channel.coding_plan_disable_threshold ?? 98)
    setEnableThreshold(channel.coding_plan_enable_threshold ?? 90)
  }, [
    channel.id,
    channel.coding_plan_auto_control,
    channel.coding_plan_disable_threshold,
    channel.coding_plan_enable_threshold,
  ])

  const save = useCallback(
    async (nextEnabled: boolean, nextDisable: number, nextEnable: number) => {
      if (nextDisable < 1 || nextDisable > 100) {
        setError(t('Disable threshold must be between 1 and 100'))
        return
      }
      if (nextEnable >= nextDisable) {
        setError(t('Enable threshold must be lower than disable threshold'))
        return
      }
      setError('')
      setSaving(true)
      try {
        const res = await updateChannel(channel.id, {
          coding_plan_auto_control: nextEnabled,
          coding_plan_disable_threshold: nextDisable,
          coding_plan_enable_threshold: nextEnable,
        })
        if (!res.success) {
          setError(res.message || t('Save failed'))
          // 回滚到已保存的配置,避免开关/输入显示与实际不符。
          setEnabled(channel.coding_plan_auto_control ?? false)
          setDisableThreshold(channel.coding_plan_disable_threshold ?? 98)
          setEnableThreshold(channel.coding_plan_enable_threshold ?? 90)
          return
        }
        // 后端已同步到同组其余渠道;刷新列表让卡片/渠道列表反映新配置。
        void queryClient.invalidateQueries({
          queryKey: ['channels', 'list', 'coding-plan-enabled'],
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : t('Save failed'))
        setEnabled(channel.coding_plan_auto_control ?? false)
        setDisableThreshold(channel.coding_plan_disable_threshold ?? 98)
        setEnableThreshold(channel.coding_plan_enable_threshold ?? 90)
      } finally {
        setSaving(false)
      }
    },
    [channel.id, channel.coding_plan_auto_control, queryClient, t]
  )

  const handleToggle = (checked: boolean) => {
    setEnabled(checked)
    void save(checked, disableThreshold, enableThreshold)
  }

  // 决策预览(纯前端按当前用量/阈值/状态推算,非真实状态机):让不操纵套餐余量的
  // 验证成为可能——把禁用阈值调到当前用量以下,预览立即显示「将禁用」。
  let preview: ReactNode = null
  if (enabled && utilization != null) {
    const pct = Math.round(utilization)
    if (
      channel.status === CHANNEL_STATUS.ENABLED &&
      utilization >= disableThreshold
    ) {
      preview = (
        <p className='text-destructive mt-1.5 text-[11px]'>
          {t('Will disable: usage {{pct}}% reaches the disable threshold', {
            pct,
          })}
        </p>
      )
    } else if (
      channel.status === CHANNEL_STATUS.AUTO_DISABLED &&
      utilization < enableThreshold
    ) {
      preview = (
        <p className='text-emerald-600 dark:text-emerald-500 mt-1.5 text-[11px]'>
          {t('Will re-enable: usage {{pct}}% drops below the enable threshold', {
            pct,
          })}
        </p>
      )
    } else {
      preview = (
        <p className='text-muted-foreground mt-1.5 text-[11px]'>
          {t('No action: usage {{pct}}% within current thresholds', { pct })}
        </p>
      )
    }
  }

  return (
    <div className='space-y-5'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-0.5'>
          <Label
            htmlFor={`coding-plan-auto-control-${channel.id}`}
            className='font-medium'
          >
            {t('Auto enable/disable by quota')}
          </Label>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Disable the channel when coding-plan usage reaches the disable threshold, re-enable it after usage drops below the enable threshold.'
            )}
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-1.5'>
          {saving && (
            <Loader2
              className='text-muted-foreground size-3.5 animate-spin'
              aria-hidden='true'
            />
          )}
          <Switch
            id={`coding-plan-auto-control-${channel.id}`}
            checked={enabled}
            disabled={saving}
            onCheckedChange={handleToggle}
          />
        </div>
      </div>

      {enabled && (
        <div className='space-y-3'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label
                htmlFor={`cp-disable-threshold-${channel.id}`}
                className='text-xs'
              >
                {t('Disable threshold')} (%)
              </Label>
              <Input
                id={`cp-disable-threshold-${channel.id}`}
                type='number'
                min={1}
                max={100}
                value={disableThreshold}
                disabled={saving}
                onChange={(e) => setDisableThreshold(Number(e.target.value))}
                onBlur={() => void save(enabled, disableThreshold, enableThreshold)}
              />
            </div>
            <div className='space-y-1.5'>
              <Label
                htmlFor={`cp-enable-threshold-${channel.id}`}
                className='text-xs'
              >
                {t('Enable threshold')} (%)
              </Label>
              <Input
                id={`cp-enable-threshold-${channel.id}`}
                type='number'
                min={0}
                max={100}
                value={enableThreshold}
                disabled={saving}
                onChange={(e) => setEnableThreshold(Number(e.target.value))}
                onBlur={() => void save(enabled, disableThreshold, enableThreshold)}
              />
            </div>
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Re-enable the channel when usage drops below the enable threshold (e.g. after the 5-hour window rolls).'
            )}
          </p>
        </div>
      )}

      {preview}
      {error && <p className='text-destructive text-xs'>{error}</p>}
    </div>
  )
}

/**
 * 详情/管理抽屉:从卡片右上角按钮打开。原来外显的渠道名、等级都收进来,加上
 * 用量详情与自动管理设置(开关/阈值/决策预览),改动即时保存并同步到同 key 渠道。
 */
function CodingPlanAutoControlSheet({
  channels,
  quota,
  utilization,
  open,
  onOpenChange,
}: {
  channels: Channel[]
  quota: CodingPlanQuota | null
  utilization: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const channel = channels[0]
  const providerLabelText = providerLabel(channel, t)

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
              {quota.tiers.length > 0 ? (
                <div className='divide-y divide-border'>
                  {quota.tiers.map((tier) => (
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

          {/* 自动管理 */}
          <div className={sideDrawerSectionClassName()}>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('Auto-manage')}
            </div>
            <CodingPlanAutoControlForm
              channel={channel}
              utilization={utilization}
            />
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
