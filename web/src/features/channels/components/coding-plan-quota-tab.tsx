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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getChannelCodingPlanQuota, getChannels } from '../api'
import {
  CODING_PLAN_PROVIDER_OPTIONS,
  CODING_PLAN_SYMBOL_KEYS,
  CODING_PLAN_SYMBOL_OPTIONS,
} from '../constants'
import type { Channel, CodingPlanTier } from '../types'
import { useChannels } from './channels-provider'

const QUOTA_REFRESH_MS = 5 * 60 * 1000

// 渠道是否启用编码套餐余量监控:base_url 填了符号键,或手动指定了厂商。
function isQuotaEnabled(channel: Channel): boolean {
  return (
    CODING_PLAN_SYMBOL_KEYS.includes(channel.base_url ?? '') ||
    Boolean(channel.coding_plan_provider)
  )
}

// 厂商展示名:手动 provider 优先,其次 base_url 符号键。
function providerLabel(
  channel: Channel,
  t: (key: string) => string
): string {
  if (channel.coding_plan_provider) {
    const option = CODING_PLAN_PROVIDER_OPTIONS.find(
      (item) => item.value === channel.coding_plan_provider
    )
    return option ? t(option.label) : channel.coding_plan_provider
  }
  const symbol = CODING_PLAN_SYMBOL_OPTIONS.find(
    (item) => item.value === channel.base_url
  )
  return symbol ? t(symbol.label) : ''
}

function tierColorClass(percent: number) {
  if (percent >= 90) return 'text-red-500'
  if (percent >= 70) return 'text-amber-500'
  return 'text-emerald-500'
}

function tierNameLabel(name: string, t: (key: string) => string) {
  if (name === 'five_hour') return t('5 Hour Window')
  if (name === 'weekly_limit') return t('Weekly Limit')
  return name
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

function ChannelQuotaCard({ channel }: { channel: Channel }) {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow } = useChannels()

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
        {quota.level ? <p className='text-xs font-medium'>{quota.level}</p> : null}
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
    <div className='border-input bg-card flex flex-col gap-3 rounded-lg border p-4'>
      <div className='flex min-w-0 items-start justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <Gauge className='text-muted-foreground mt-0.5 size-4 shrink-0' aria-hidden='true' />
          <div className='min-w-0'>
            <p className='truncate text-sm font-semibold'>{channel.name}</p>
            <p className='text-muted-foreground truncate text-xs'>
              {providerLabelText}
            </p>
          </div>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='shrink-0'
          aria-label={t('Edit channel')}
          onClick={() => {
            setCurrentRow(channel)
            setOpen('update-channel')
          }}
        >
          <Pencil className='size-3.5' aria-hidden='true' />
        </Button>
      </div>

      <div aria-busy={quotaQuery.isFetching}>{quotaArea}</div>

      <div className='flex items-center gap-1'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
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
 * Coding-plan quota tab: lists every channel with coding-plan quota monitoring
 * enabled and shows each one's remaining quota.
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
        {channels.map((channel) => (
          <ChannelQuotaCard key={channel.id} channel={channel} />
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
