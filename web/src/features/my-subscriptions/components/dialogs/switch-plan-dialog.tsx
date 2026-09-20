// @muw-owned
import { ArrowLeftRight, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  plan: SubscriptionPlan,
  quotaPerUnit: number
): number {
  // 用续费条款快照的周期时长与价格估值：续费只延长 end_time 不更新 start_time，
  // 用 end-start 当分母会被历史续费拉伸、稀释当前套餐价值。无快照回退当前套餐。
  const renewTerms = parseRenewTerms(sub?.renew_terms)
  const periodSeconds = renewTerms?.duration_seconds ?? planDurationSeconds(plan)
  if (!periodSeconds || periodSeconds <= 0) return 0
  const price = renewTerms?.price_amount ?? Number(plan.price_amount || 0)
  const remain = Math.max(0, Number(sub.end_time || 0) - Date.now() / 1000)
  // 剩余多期时价值按多期计（用户为多期付过费），不封顶到单期。
  const timeValue = price * (remain / periodSeconds)
  // 单期账本封顶，与后端 PurchaseWithStrategy 的 clamp 保持一致：按时间折算的剩余价值
  // 不得超过「快照价 − 当前预付期已消耗价值」。后端真按这个数出账，不加这层，
  // 弹窗会报出一个后端永远不会兑现的退款额（烧爆当期额度后尤其明显）。
  const unit =
    quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  const consumedValue = Number(sub.period_used || 0) / unit
  return Math.max(0, Math.min(timeValue, price - consumedValue))
}

export function SwitchPlanDialog(props: Props) {
  const { t } = useTranslation()
  const { currency } = useSystemConfig()
  const { userQuota, refresh } = useMySubscriptions()
  const [paying, setPaying] = useState(false)
  // 二次确认步：第一条「确认更换」只进确认页，确认页里再点一次才真正出账。
  const [confirming, setConfirming] = useState(false)
  const { open } = props

  // 弹窗关闭时组件只是 return null，state 不会被清 —— 不显式回退，
  // 下次打开就会直接落在确认步（看起来像少了一步）。
  useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])

  const plan = props.plan
  const oldSub = props.oldSub
  const oldPlan = props.oldPlan
  if (!plan || !oldSub || !oldPlan) return null

  const quotaPerUnit =
    currency?.quotaPerUnit && currency.quotaPerUnit > 0
      ? currency.quotaPerUnit
      : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  const remainingValue = calcSubscriptionRemainingValue(
    oldSub,
    oldPlan,
    quotaPerUnit
  )
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

  const chargeQuota = payAmount ? Math.ceil(diff * quotaPerUnit) : 0
  const available = Math.max(0, Number(userQuota || 0))
  // 方向文案单一来源（弹窗标题用）。
  const directionLabel = isUpgrade
    ? t('Upgrade Plan')
    : isDowngrade
      ? t('Downgrade Plan')
      : t('Switch Plan')
  const amountLabel = payAmount
    ? t('Amount to Pay')
    : refundAmount
      ? t('Refund Amount')
      : t('Difference')
  const amountClassName = payAmount
    ? 'text-destructive'
    : refundAmount
      ? 'text-primary'
      : undefined

  const doSwitch = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionBalance({ plan_id: plan.id })
      if (res.success) {
        toast.success(
          (res.data as { message?: string } | undefined)?.message ||
            t('Subscription switched')
        )
        setConfirming(false)
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
          {directionLabel}
        </>
      }
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      {confirming ? (
        // 二次确认步：给出方向、新套餐与真实出账金额，确认后才提交。
        <div
          className='flex flex-col gap-3 rounded-md border p-3'
          data-slot='switch-plan-confirm-step'
        >
          <p className='text-sm font-medium'>{t('Action confirmation')}</p>
          <div className='space-y-1.5 text-sm'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>{t('New Plan')}</span>
              <span className='font-medium'>{plan.title}</span>
            </div>
            <div className='flex items-center justify-between font-medium'>
              <span className='text-muted-foreground'>{amountLabel}</span>
              <span className={amountClassName}>
                {payAmount ? '+' : refundAmount ? '-' : ''}$
                {diffAbs.toFixed(2)}
              </span>
            </div>
          </div>
          <p className='text-muted-foreground text-sm'>
            {t(
              'The current subscription will be replaced. Remaining quota is not refunded.'
            )}
          </p>
          <div className='flex gap-2'>
            <Button
              className='flex-1'
              variant='outline'
              disabled={paying}
              onClick={() => setConfirming(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              className='flex-1'
              variant={isDowngrade ? 'destructive' : 'default'}
              disabled={paying || (payAmount && available < chargeQuota)}
              onClick={() => void doSwitch()}
            >
              {paying ? t('Saving...') : t('Confirm Switch')}
            </Button>
          </div>
        </div>
      ) : (
        <div className='space-y-3'>
          <div className='bg-muted/50 space-y-2.5 rounded-lg border p-3 text-sm'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>→ {t('New Plan')}</span>
              <span className='font-medium'>{plan.title}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>
                {t('Validity Period')}
              </span>
              <span>{formatDuration(plan, t)}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>{t('Plan Price')}</span>
              <span>${Number(plan.price_amount || 0).toFixed(2)}</span>
            </div>
            <Separator />
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>
                {t('Current Plan Value')}
              </span>
              <span>${remainingValue.toFixed(2)}</span>
            </div>
            <div className='flex items-center justify-between font-medium'>
              <span className='text-muted-foreground'>{amountLabel}</span>
              <span className={amountClassName}>
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
              onClick={() => setConfirming(true)}
              disabled={paying || (payAmount && available < chargeQuota)}
            >
              {t('Confirm Switch')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
