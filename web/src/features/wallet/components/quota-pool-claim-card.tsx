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
import { Coins } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatQuota } from '@/lib/format'

import { claimQuotaPool, getQuotaPools } from '../api'

type QuotaPoolRecord = {
  id: number
  name: string
  description: string
  amount_type: 'fixed' | 'random'
  amount: number
  min_amount: number
  max_amount: number
  period: string
  balance_mode: 'off' | 'below' | 'above'
  balance_limit: number
  pool_period_cap: number
  user_period_cap: number
  user_period_count_limit: number
  time_rule: string
  status: {
    pool_cap_reached: boolean
    user_cap_reached: boolean
    count_limit_reached: boolean
    time_open: boolean
    balance_allowed: boolean
  }
}

interface QuotaPoolClaimCardProps {
  enabled: boolean
  onBalanceChange?: () => void
}

export function QuotaPoolClaimCard({
  enabled,
  onBalanceChange,
}: QuotaPoolClaimCardProps) {
  const { t } = useTranslation()
  const [claimingId, setClaimingId] = useState<number | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['user-quota-pools'],
    queryFn: async () => {
      const result = await getQuotaPools()
      if (!result.success) {
        throw new Error(result.message || 'failed')
      }
      return (result.data || []) as QuotaPoolRecord[]
    },
    enabled,
  })

  const pools = useMemo(() => data || [], [data])

  const handleClaim = useCallback(
    async (pool: QuotaPoolRecord) => {
      setClaimingId(pool.id)
      try {
        const result = await claimQuotaPool(pool.id)
        if (result.success && result.data) {
          toast.success(
            t('Claimed {{quota}} from {{pool}}', {
              quota: formatQuota(result.data.quota),
              pool: pool.name,
            })
          )
          onBalanceChange?.()
          refetch()
        } else {
          toast.error(result.message || t('Failed to claim quota'))
        }
      } finally {
        setClaimingId(null)
      }
    },
    [onBalanceChange, refetch, t]
  )

  if (!enabled || isLoading || pools.length === 0) {
    return null
  }

  const amountLabel = (pool: QuotaPoolRecord) =>
    pool.amount_type === 'random'
      ? `${formatQuota(pool.min_amount)} - ${formatQuota(pool.max_amount)}`
      : formatQuota(pool.amount)

  const canClaim = (pool: QuotaPoolRecord) =>
    !pool.status.pool_cap_reached &&
    !pool.status.user_cap_reached &&
    !pool.status.count_limit_reached &&
    pool.status.time_open &&
    pool.status.balance_allowed

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Coins className='h-4 w-4' />
          {t('Quota Pools')}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {pools.map((pool) => {
          const claimable = canClaim(pool)
          return (
            <div
              key={pool.id}
              className='flex items-center justify-between gap-3 rounded-lg border p-3'
            >
              <div className='min-w-0'>
                <div className='flex items-center gap-2'>
                  <span className='truncate font-medium'>{pool.name}</span>
                  <span className='text-muted-foreground text-sm'>
                    {amountLabel(pool)}
                  </span>
                </div>
                {pool.description && (
                  <div className='text-muted-foreground truncate text-xs'>
                    {pool.description}
                  </div>
                )}
                {!claimable && (
                  <div className='text-muted-foreground mt-0.5 text-xs'>
                    {pool.status.pool_cap_reached &&
                      t('This pool is fully claimed this period')}
                    {pool.status.user_cap_reached &&
                      t('You have reached your claim limit this period')}
                    {pool.status.count_limit_reached &&
                      t('You have reached your claim count this period')}
                    {!pool.status.time_open &&
                      t('Not available in the current time window')}
                    {!pool.status.balance_allowed &&
                      t('Your balance does not meet the pool requirement')}
                  </div>
                )}
              </div>
              <Button
                size='sm'
                disabled={!claimable || claimingId === pool.id}
                onClick={() => handleClaim(pool)}
              >
                {claimingId === pool.id ? t('Claiming...') : t('Claim')}
              </Button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
