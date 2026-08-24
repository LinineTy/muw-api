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
import { CalendarClock, Package, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  formatDuration,
  formatDurationSeconds,
  formatWindowPeriodLabel,
  isCapWindow,
  parsePlanResetWindows,
  parseRenewTerms,
} from '@/features/subscriptions/lib'
import type {
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { useSystemConfig } from '@/hooks/use-system-config'
import { formatQuota } from '@/lib/format'
import { DEFAULT_CURRENCY_CONFIG } from '@/stores/system-config-store'

import { renewSubscriptionBalance, paySubscriptionEpay } from '../../api'
import { getEpayMethods } from '../../lib/helpers'
import { useMySubscriptions } from '../my-subscriptions-provider'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription: UserSubscriptionRecord | null
  plan?: SubscriptionPlan | null
  onSuccess?: () => void | Promise<void>
}

export function RenewSubscriptionDialog(props: Props) {
  const { t } = useTranslation()
  const { currency } = useSystemConfig()
  const { topupInfo, userQuota } = useMySubscriptions()
  const [paying, setPaying] = useState(false)
  const [selectedEpayMethod, setSelectedEpayMethod] = useState('')
  const [confirming, setConfirming] = useState(false)

  const sub = props.subscription?.subscription
  const plan = props.plan
  const epayMethods = getEpayMethods(topupInfo?.pay_methods)
  const enableOnlineTopUp = !!topupInfo?.enable_online_topup

  useEffect(() => {
    if (props.open && epayMethods.length > 0) {
      setSelectedEpayMethod(epayMethods[0].type)
    } else if (!props.open) {
      setSelectedEpayMethod('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open])

  if (!sub || !plan) return null

  // 续费价格/时长走订阅的条款快照（旧条款），后端实际扣款按它；无快照回退当前套餐。
  const renewTerms = parseRenewTerms(sub.renew_terms)
  const effectivePrice =
    renewTerms?.price_amount ?? Number(plan.price_amount || 0)

  const price = effectivePrice.toFixed(2)
  // 套餐额度展示：动态窗口 = 各窗口摘要；全部窗口额度 0 = 无限额度。
  const planQuotaLabel = (() => {
    const windows = parsePlanResetWindows(plan.reset_windows)
    if (windows.length > 0 && windows.every((w) => Number(w.limit) <= 0)) {
      return t('Unlimited')
    }
    return windows
      .map((w) =>
        // 封顶窗口（周期 >= 有效期）只显示总额度，不暴露周期（如 "12 个月"）。
        isCapWindow(w, plan)
          ? t('{{amount}} total', { amount: formatQuota(w.limit || 0) })
          : t('{{amount}} every {{period}}', {
              amount: formatQuota(w.limit || 0),
              period: formatWindowPeriodLabel(w, t),
            })
      )
      .join(' / ')
  })()
  const quotaPerUnit =
    currency?.quotaPerUnit && currency.quotaPerUnit > 0
      ? currency.quotaPerUnit
      : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  const balanceCost = Math.max(0, Math.ceil(effectivePrice * quotaPerUnit))
  const available = Math.max(0, Number(userQuota || 0))
  const insufficientBalance = available < balanceCost
  const allowBalancePay = plan.allow_balance_pay !== false
  const hasEpay = enableOnlineTopUp && epayMethods.length > 0

  const isSafari =
    typeof navigator !== 'undefined' &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

  const handleRenewBalance = async () => {
    setPaying(true)
    try {
      const res = await renewSubscriptionBalance(sub.id)
      if (res.success) {
        toast.success(
          res.data?.message || t('Subscription renewed successfully')
        )
        props.onOpenChange(false)
        void props.onSuccess?.()
      } else {
        toast.error(res.message || t('Payment request failed'))
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
      setConfirming(false)
    }
  }

  const handleRenewEpay = async () => {
    if (!selectedEpayMethod) {
      toast.error(t('Please select a payment method'))
      return
    }
    setPaying(true)
    try {
      const res = await paySubscriptionEpay({
        plan_id: plan.id,
        payment_method: selectedEpayMethod,
        subscription_id: sub.id,
      })
      if (res.message === 'success' && res.url) {
        const form = document.createElement('form')
        form.action = res.url
        form.method = 'POST'
        if (!isSafari) {
          form.target = '_blank'
        }
        Object.entries(res.data || {}).forEach(([key, value]) => {
          const input = document.createElement('input')
          input.type = 'hidden'
          input.name = key
          input.value = String(value)
          form.appendChild(input)
        })
        document.body.appendChild(form)
        form.submit()
        document.body.removeChild(form)
        toast.success(t('Payment initiated'))
        props.onOpenChange(false)
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
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
      onOpenChange={(open) => {
        props.onOpenChange(open)
        if (!open) {
          setConfirming(false)
        }
      }}
      title={
        <>
          <RefreshCw className='h-5 w-5' />
          {t('Renew Subscription')}
        </>
      }
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      {confirming ? (
        <div className='flex flex-col gap-3 rounded-md border p-3'>
          <p className='text-sm font-medium'>{t('Confirm renewal?')}</p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Renew {{plan}} for {{cost}} quota. Your balance is {{balance}}.',
              {
                plan: plan.title,
                cost: formatQuota(balanceCost),
                balance: formatQuota(available),
              }
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
              disabled={paying}
              onClick={() => void handleRenewBalance()}
            >
              {t('Renew with Balance')}
            </Button>
          </div>
        </div>
      ) : (
        <div className='space-y-3 sm:space-y-4'>
          <div className='bg-muted/50 space-y-2.5 rounded-lg border p-3 sm:space-y-3 sm:p-4'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Plan Name')}
              </span>
              <span className='max-w-[200px] truncate text-sm font-medium'>
                {plan.title}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Validity Period')}
              </span>
              <span className='flex items-center gap-1 text-sm'>
                <CalendarClock className='h-3.5 w-3.5' />
                {renewTerms
                  ? formatDurationSeconds(renewTerms.duration_seconds, t)
                  : formatDuration(plan, t)}
              </span>
            </div>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-muted-foreground shrink-0 text-sm'>
                {t('Plan Quota')}
              </span>
              <span className='flex items-center gap-1 text-right text-sm'>
                <Package className='h-3.5 w-3.5 shrink-0' />
                <span className='max-w-[220px] truncate'>
                  {planQuotaLabel}
                </span>
              </span>
            </div>
            <Separator />
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium'>{t('Amount Due')}</span>
              <span className='text-primary text-lg font-bold'>${price}</span>
            </div>
          </div>

          <div className='flex flex-col gap-2 rounded-md border p-3'>
            <div className='flex items-center justify-between gap-2 text-xs'>
              <span className='text-muted-foreground'>{t('Required')}</span>
              <span>{formatQuota(balanceCost)}</span>
            </div>
            <div className='flex items-center justify-between gap-2 text-xs'>
              <span className='text-muted-foreground'>{t('Available')}</span>
              <span>{formatQuota(available)}</span>
            </div>
            <Button
              variant='outline'
              onClick={() => setConfirming(true)}
              disabled={paying || insufficientBalance || !allowBalancePay}
            >
              {t('Renew with Balance')}
            </Button>
            {!allowBalancePay ? (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t('This plan does not allow balance redemption')}
                </AlertDescription>
              </Alert>
            ) : (
              insufficientBalance && (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t('Insufficient balance')}
                  </AlertDescription>
                </Alert>
              )
            )}
          </div>

          {hasEpay && (
            <div className='space-y-3'>
              <p className='text-muted-foreground text-xs'>
                {t('Select payment method')}
              </p>
              <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
                <Select
                  items={epayMethods.map((m) => ({
                    value: m.type,
                    label: m.name || m.type,
                  }))}
                  value={selectedEpayMethod}
                  onValueChange={(v) => v !== null && setSelectedEpayMethod(v)}
                >
                  <SelectTrigger className='flex-1'>
                    <SelectValue>{selectedEpayMethod}</SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {epayMethods.map((m) => (
                        <SelectItem key={m.type} value={m.type}>
                          {m.name || m.type}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleRenewEpay}
                  disabled={paying || !selectedEpayMethod}
                >
                  {t('Pay')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
