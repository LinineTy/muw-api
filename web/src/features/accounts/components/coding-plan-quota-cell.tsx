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

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CODING_PLAN_PROVIDER_OPTIONS } from '@/features/channels/constants'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getAccountCodingPlanQuota } from '../api'
import type { Account } from '../types'

function providerLabel(provider: string | null | undefined): string {
  if (!provider) return ''
  return (
    CODING_PLAN_PROVIDER_OPTIONS.find((o) => o.value === provider)?.label ??
    provider
  )
}

/**
 * 账户维度的编码套餐余量单元格。余量按账户查（多渠道共享同一账户只查一次、
 * 共享同一张卡），点「查询」才发请求，避免列表一次性打爆厂商接口。
 */
export function CodingPlanQuotaCell({ account }: { account: Account }) {
  const { t } = useTranslation()
  const [requested, setRequested] = useState(false)
  const enabled = Boolean(account.coding_plan_provider)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['account-coding-plan-quota', account.id],
    queryFn: () => getAccountCodingPlanQuota(account.id),
    enabled: requested && enabled,
    staleTime: 60_000,
    retry: false,
  })

  if (!enabled) {
    return <span className='text-muted-foreground text-xs'>{t('Not monitored')}</span>
  }

  const tiers = data?.tiers ?? []
  const body = () => {
    if (!requested) return null
    if (isFetching) {
      return <span className='text-muted-foreground text-xs'>{t('Querying...')}</span>
    }
    if (data && data.success === false) {
      return (
        <span className='text-destructive text-xs' title={data.error}>
          {t('Query failed')}
        </span>
      )
    }
    if (tiers.length === 0) return null
    return (
      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
        {tiers.map((tier) => (
          <span key={tier.name} className='text-xs tabular-nums'>
            <span className='text-muted-foreground'>
              {tier.name === 'five_hour' ? t('5h') : tier.name === 'weekly_limit' ? t('Weekly') : tier.name}
            </span>{' '}
            <span
              className={cn(
                'font-medium',
                tier.utilization >= 90
                  ? 'text-destructive'
                  : tier.utilization >= 70
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
              )}
            >
              {formatPercent(100 - tier.utilization)}
            </span>
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-1.5'>
        <span className='text-xs'>{providerLabel(account.coding_plan_provider)}</span>
        <TooltipProvider delay={100}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Query quota')}
                  onClick={() => {
                    if (!requested) setRequested(true)
                    else void refetch()
                  }}
                />
              }
            >
              <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
            </TooltipTrigger>
            <TooltipContent>{t('Query quota')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {body()}
    </div>
  )
}
