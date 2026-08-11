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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gauge, Loader2, Pencil, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getChannelCodingPlanQuota, getChannels } from '../api'
import {
  CODING_PLAN_PROVIDER_OPTIONS,
  detectCodingPlanProvider,
} from '../constants'
import type { Channel, CodingPlanTier } from '../types'
import { useChannels } from './channels-provider'

const QUOTA_REFRESH_MS = 5 * 60 * 1000

// 同 key 渠道标签的默认可见数量,超出折叠成 +N(展开/收起),避免卡片被撑高。
const MAX_CHANNEL_TAGS = 3

// 渠道是否启用编码套餐余量监控:显式配置了厂商,或 base_url 是套餐符号键/套餐专用地址。
function isQuotaEnabled(channel: Channel): boolean {
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

function QuotaTierRow({ tier }: { tier: CodingPlanTier }) {
  const { t } = useTranslation()
  const used = Math.max(0, Math.min(100, tier.utilization))

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2 text-xs'>
        <span className='font-medium'>{tierNameLabel(tier.name, t)}</span>
        <span
          className={cn(
            'font-semibold tabular-nums',
            tierColorClass(tier.utilization)
          )}
        >
          {formatPercent(tier.utilization)}
        </span>
      </div>
      <Progress value={used} className='h-1.5 flex-1' />
      <div className='text-muted-foreground flex items-center justify-between gap-2 text-[11px]'>
        <span>{t('Used')}</span>
        <span className='truncate'>
          {t('Resets at {{time}}', { time: formatResetsAt(tier.resets_at) })}
        </span>
      </div>
    </div>
  )
}

function ChannelQuotaCard({ channels }: { channels: Channel[] }) {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow } = useChannels()
  // 同 key 多渠道合并成一张卡:余量是账号级数据,取组内任一渠道查询即可。
  const channel = channels[0]
  const groupSize = channels.length
  const isGrouped = groupSize > 1
  // 渠道标签折叠:默认显示前 MAX_CHANNEL_TAGS 个,其余折叠成 +N,展开后全部显示。
  const [showAllChannels, setShowAllChannels] = useState(false)
  const hiddenCount = channels.length - MAX_CHANNEL_TAGS
  const visibleChannels = showAllChannels
    ? channels
    : channels.slice(0, MAX_CHANNEL_TAGS)

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
    refetchInterval: QUOTA_REFRESH_MS,
    staleTime: 60 * 1000,
  })

  const providerLabelText = providerLabel(channel, t)

  const openEdit = (target: Channel) => {
    setCurrentRow(target)
    setOpen('update-channel')
  }

  let quotaArea
  if (quotaQuery.isLoading) {
    quotaArea = (
      <div className='space-y-2'>
        <Skeleton className='h-3 w-1/3 rounded' />
        <Skeleton className='h-1.5 w-full rounded' />
        <Skeleton className='h-1.5 w-full rounded' />
      </div>
    )
  } else if (quotaQuery.isError) {
    quotaArea = (
      <div className='border-destructive/20 bg-destructive/5 rounded-md border px-2.5 py-2 text-xs'>
        <p className='text-destructive font-medium'>
          {t('Quota query failed')}
        </p>
        <p className='text-muted-foreground mt-0.5 truncate'>
          {quotaQuery.error instanceof Error
            ? quotaQuery.error.message
            : t('Unknown error')}
        </p>
      </div>
    )
  } else if (quotaQuery.data) {
    const quota = quotaQuery.data
    quotaArea = (
      <div className='space-y-3'>
        {quota.tiers.length > 0 ? (
          <div className='space-y-3'>
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
    )
  } else {
    quotaArea = null
  }

  return (
    <div className='bg-card flex flex-col overflow-hidden rounded-lg border border-input'>
      {/* 顶栏:卡片名 = 厂商(套餐)名;渠道名做成标签,点击标签进入对应渠道编辑 */}
      <div className='flex min-w-0 items-start justify-between gap-2 border-b px-4 py-3'>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <div className='flex min-w-0 items-center gap-2'>
            <Gauge className='text-muted-foreground mt-0.5 size-4 shrink-0' aria-hidden='true' />
            <p className='truncate text-sm font-semibold'>{providerLabelText}</p>
          </div>
          <div className='flex flex-wrap items-center gap-1.5'>
            {visibleChannels.map((ch) => (
              <Button
                key={ch.id}
                type='button'
                variant='ghost'
                size='sm'
                className='bg-muted/60 text-muted-foreground hover:text-foreground h-auto px-2 py-0.5 text-xs'
                onClick={() => openEdit(ch)}
              >
                {ch.name}
              </Button>
            ))}
            {hiddenCount > 0 && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='bg-muted/60 text-muted-foreground hover:text-foreground h-auto px-2 py-0.5 text-xs'
                onClick={() => setShowAllChannels((v) => !v)}
              >
                {showAllChannels ? t('Collapse') : `+${hiddenCount} ${t('More')}`}
              </Button>
            )}
          </div>
        </div>
        {!isGrouped && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='shrink-0'
            aria-label={t('Edit channel')}
            onClick={() => openEdit(channel)}
          >
            <Pencil className='size-3.5' aria-hidden='true' />
          </Button>
        )}
      </div>

      {/* 中间余量区 flex-1 撑开、底部固定对齐(订阅卡片同款布局),不同套餐窗口
          数量不同也不会高高低低;上下各用一条分隔线与顶栏/底栏隔开。 */}
      <div className='flex-1 px-4 py-3' aria-busy={quotaQuery.isFetching}>
        {quotaArea}
      </div>

      {/* 底部:等级标签(如 lite)+ 刷新,固定对齐 */}
      <div className='flex items-center gap-2 border-t px-4 py-2.5'>
        {quotaQuery.data?.level ? (
          <span className='bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5 text-[11px] font-medium'>
            {quotaQuery.data.level}
          </span>
        ) : null}
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='ml-auto'
          onClick={() => void quotaQuery.refetch()}
          disabled={quotaQuery.isFetching}
        >
          {quotaQuery.isFetching ? (
            <Loader2
              data-icon='inline-start'
              className='size-3.5 animate-spin'
              aria-hidden='true'
            />
          ) : (
            <RefreshCw
              data-icon='inline-start'
              className='size-3.5'
              aria-hidden='true'
            />
          )}
          {t('Refresh')}
        </Button>
      </div>
    </div>
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
      <div className='grid gap-3 sm:grid-cols-2'>
        {[0, 1].map((index) => (
          <Skeleton key={index} className='h-40 w-full rounded-lg' />
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
      <div className='grid gap-3 sm:grid-cols-2'>
        {groups.map((group) => (
          <ChannelQuotaCard key={group[0].id} channels={group} />
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
      {content}
    </div>
  )
}
