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
import { ArrowLeftRight, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useSystemConfig } from '@/hooks/use-system-config'
import { formatQuota } from '@/lib/format'
import { DEFAULT_CURRENCY_CONFIG } from '@/stores/system-config-store'
import {
  formatDuration,
  parseRenewTerms,
  planDurationSeconds,
} from '@/features/subscriptions/lib'

import { paySubscriptionBalance } from '../../api'
import type {
  SubscriptionPlan,
  UserSubscription,
} from '@/features/subscriptions/types'
import { useMySubscriptions } from '../my-subscriptions-provider'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: SubscriptionPlan | null
  oldSub: UserSubscription | null
  oldPlan: SubscriptionPlan | null
  onSuccess?: () => void | Promise<void>
}

export function calcSubscriptionRemainingValue(
  sub: UserSubscription,
  plan: SubscriptionPlan
): number {
  // 用续费条款快照的周期时长与价格估值：续费只延长 end_time 不更新 start_time，
  // 用 end-start 当分母会被历史续费拉伸、稀释当前套餐价值。无快照回退当前套餐。
  const renewTerms = parseRenewTerms(sub?.renew_terms)
  const periodSeconds = renewTerms?.duration_seconds ?? planDurationSeconds(plan)
  if (!periodSeconds || periodSeconds <= 0) return 0
  const price = renewTerms?.price_amount ?? Number(plan.price_amount || 0)
  const remain = Math.max(0, Number(sub.end_time || 0) - Date.now() / 1000)
  // 剩余多期时价值按多期计（用户为多期付过费），不封顶到单期。
  return price * (remain / periodSeconds)
}

export function SwitchPlanDialog(props: Props) {
  const { t } = useTranslation()
  const { currency } = useSystemConfig()
  const { userQuota, refresh } = useMySubscriptions()
  const [paying, setPaying] = useState(false)

  const plan = props.plan
  const oldSub = props.oldSub
  const oldPlan = props.oldPlan
  if (!plan || !oldSub || !oldPlan) return null

  const remainingValue = calcSubscriptionRemainingValue(oldSub, oldPlan)
  const diff = Number(plan.price_amount || 0) - remainingValue
  const diffAbs = Math.abs(diff)
  // 升降级方向按套餐档位判定（Priority → 价格兜底），与后端 comparePlanTier 一致。
  const tierDir =
    Number(plan.priority || 0) !== Number(oldPlan.priority || 0)
      ? Number(plan.priority || 0) > Number(oldPlan.priority || 0)
        ? 1
        : -1
      : Number(plan.price_amount || 0) > Number(oldPlan.price_amount || 0)
        ? 1
        : Number(plan.price_amount || 0) < Number(oldPlan.price_amount || 0)
          ? -1
          : 0
  const isUpgrade = tierDir > 0
  const isDowngrade = tierDir < 0
  // 金额仍按价格差额：diff>0 补差额，diff<0 退差额。
  const payAmount = diff > 0.005
  const refundAmount = diff < -0.005

  const quotaPerUnit =
    currency?.quotaPerUnit && currency.quotaPerUnit > 0
      ? currency.quotaPerUnit
      : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  const chargeQuota = payAmount ? Math.ceil(diff * quotaPerUnit) : 0
  const available = Math.max(0, Number(userQuota || 0))

  const handleConfirm = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionBalance({ plan_id: plan.id })
      if (res.success) {
        toast.success(
          (res.data as { message?: string } | undefined)?.message ||
            t('Subscription switched')
        )
        props.onOpenChange(false)
        void props.onSuccess?.()
        void refresh()
      } else {
        toast.error(res.message || t('Payment request failed'))
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <ArrowLeftRight className='h-5 w-5' />
          {isUpgrade ? t('Upgrade Plan') : isDowngrade ? t('Downgrade Plan') : t('Switch Plan')}
        </>
      }
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div className='space-y-3'>
        <div className='bg-muted/50 space-y-2.5 rounded-lg border p-3 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>→ {t('New Plan')}</span>
            <span className='font-medium'>{plan.title}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{t('Validity Period')}</span>
            <span>{formatDuration(plan, t)}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{t('Plan Price')}</span>
            <span>${Number(plan.price_amount || 0).toFixed(2)}</span>
          </div>
          <Separator />
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{t('Current Plan Value')}</span>
            <span>${remainingValue.toFixed(2)}</span>
          </div>
          <div className='flex items-center justify-between font-medium'>
            <span className='text-muted-foreground'>
              {payAmount ? t('Amount to Pay') : refundAmount ? t('Refund Amount') : t('Difference')}
            </span>
            <span
              className={
                payAmount
                  ? 'text-destructive'
                  : refundAmount
                    ? 'text-primary'
                    : undefined
              }
            >
              {payAmount ? '+' : refundAmount ? '-' : ''}$
              {diffAbs.toFixed(2)}
            </span>
          </div>
          <p className='text-muted-foreground flex items-center gap-1 text-xs'>
            {isUpgrade ? (
              <TrendingUp className='size-3.5' />
            ) : isDowngrade ? (
              <TrendingDown className='size-3.5' />
            ) : null}
            {t(
              'The current subscription will be replaced. Remaining quota is not refunded.'
            )}
          </p>
        </div>

        {payAmount && (
          <div className='flex flex-col gap-2 rounded-md border p-3 text-xs'>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground'>{t('Required')}</span>
              <span>{formatQuota(chargeQuota)}</span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground'>{t('Available')}</span>
              <span>{formatQuota(available)}</span>
            </div>
            {available < chargeQuota && (
              <p className='text-destructive'>{t('Insufficient balance')}</p>
            )}
          </div>
        )}

        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={paying || (payAmount && available < chargeQuota)}
          >
            {paying ? t('Saving...') : t('Confirm Switch')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
