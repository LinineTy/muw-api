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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BillingPreferenceSelect } from '@/features/my-subscriptions/components/billing-preference-select'
import { useMySubscriptions } from '@/features/my-subscriptions/components/my-subscriptions-provider'
import { classifySubscriptionStatus } from '@/features/my-subscriptions/lib/helpers'
import { getUserLogStats } from '@/features/usage-logs/api'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatQuota } from '@/lib/format'

import type { UserWalletData } from '../types'

interface WalletStatsCardProps {
  user: UserWalletData | null
  loading?: boolean
  onOpenRedemption?: () => void
}

// 余额卡：大余额 + 本月消费/订阅抵扣两个小统计 + 右上角兑换码按钮。
// 轻量无大图标；本月消费按本月消费日志汇总（与 usage-logs 统计框同源），
// 订阅抵扣取生效订阅 month_used 之和。数据展示统一去单位（纯数字）。
export function WalletStatsCard(props: WalletStatsCardProps) {
  const { t } = useTranslation()

  // 本月消费：消费日志按本月起止时间汇总
  const monthStart = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])
  const { data: monthConsumption } = useQuery({
    queryKey: ['wallet-month-consumption', monthStart],
    queryFn: async () => {
      // 日志统计接口时间戳按秒计（created_at 为秒）
      const res = await getUserLogStats({
        start_timestamp: Math.floor(monthStart / 1000),
        end_timestamp: Math.floor(Date.now() / 1000),
      })
      return res.success ? (res.data?.quota ?? 0) : 0
    },
    staleTime: 60000,
  })

  // 订阅抵扣：生效订阅本月已用（month_used）之和
  const { selfData } = useMySubscriptions()
  const subDeduction = useMemo(
    () =>
      (selfData?.subscriptions || [])
        .filter((s) => classifySubscriptionStatus(s).isActive)
        .reduce((sum, s) => sum + Number(s.subscription?.month_used || 0), 0),
    [selfData]
  )

  // 换算成显示币种、不带符号/缩写的纯数字（与订阅限额行一致）
  const fmtPlain = (v: number) =>
    formatQuotaWithCurrency(v, { abbreviate: false, showSymbol: false })

  return (
    <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
      <div className='p-4 sm:p-5'>
        {/* 标题行：与充值卡「Add Funds」同款轻量小标题，右上角消费偏好 + 兑换码按钮 */}
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h2 className='text-muted-foreground text-sm font-semibold tracking-tight'>
            {t('Balance')}
          </h2>
          <div className='flex flex-wrap items-center gap-2'>
            <BillingPreferenceSelect />
            {props.onOpenRedemption && (
              <Button
                variant='outline'
                size='sm'
                onClick={props.onOpenRedemption}
                className='shrink-0'
              >
                {t('Redeem Code')}
              </Button>
            )}
          </div>
        </div>
        <div className='mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 sm:mt-3'>
          <div className='min-w-0'>
            {props.loading ? (
              <Skeleton className='h-8 w-40' />
            ) : (
              <div className='text-foreground truncate font-mono text-2xl font-bold tracking-tight sm:text-3xl'>
                {formatQuota(props.user?.quota ?? 0)}
              </div>
            )}
          </div>
          {/* 本月消费 / 订阅抵扣：与余额同行，靠右 */}
          <div className='text-muted-foreground flex items-end gap-6 text-xs'>
            <div className='min-w-0 text-right'>
              <span className='block text-[11px]'>{t("This Month's Usage")}</span>
              {props.loading ? (
                <Skeleton className='mt-1 h-4 w-16' />
              ) : (
                <span className='text-foreground mt-0.5 block font-mono font-semibold tabular-nums'>
                  {fmtPlain(monthConsumption ?? 0)}
                </span>
              )}
            </div>
            <div className='min-w-0 text-right'>
              <span className='block text-[11px]'>{t('Subscription Offset')}</span>
              {props.loading ? (
                <Skeleton className='mt-1 h-4 w-16' />
              ) : (
                <span className='text-foreground mt-0.5 block font-mono font-semibold tabular-nums'>
                  {fmtPlain(subDeduction)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
