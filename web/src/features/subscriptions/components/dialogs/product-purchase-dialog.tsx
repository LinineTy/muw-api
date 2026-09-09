// @muw-owned

import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
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
import { useSystemConfig } from '@/hooks/use-system-config'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { DEFAULT_CURRENCY_CONFIG } from '@/stores/system-config-store'

export interface PaymentMethod {
  type: string
  name?: string
}

/** 支付 API 统一返回形态（余额/epay 各接口字段的并集）。 */
export interface PurchasePayResult {
  success?: boolean
  message?: string
  url?: string
  data?: Record<string, unknown>
}

/** 摘要卡中的一行（商品信息区，Amount Due 之前）。 */
export interface PurchaseSummaryRow {
  key: string
  label: string
  icon?: ReactNode
  value: ReactNode
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 弹窗标题（图标 + 文案），由调用方决定商品类型标识。 */
  title: ReactNode
  /** 商品摘要行（名称/有效期/升级组等），Amount Due 行由组件统一渲染。 */
  summaryRows: PurchaseSummaryRow[]
  priceAmount: number
  allowBalancePay?: boolean
  userQuota: number
  purchaseLimit?: number
  purchaseCount?: number
  enableOnlineTopUp?: boolean
  epayMethods?: PaymentMethod[]
  onPayEpay: (paymentMethod: string) => Promise<PurchasePayResult>
  onPayBalance: () => Promise<PurchasePayResult>
  successMessage: string
  onPurchaseSuccess?: () => void | Promise<void>
}

/**
 * 通用商品购买弹窗：订阅套餐与固定分组商品共用的唯一实现。
 * 结构/交互/支付流程与上游订阅购买弹窗一致（confirming 二次确认、
 * Required/Available 常显、Epay POST 表单含 Safari 兜底），
 * 商品差异只体现在 summaryRows 与支付回调的数据来源上。
 */
export function ProductPurchaseDialog(props: Props) {
  const { t } = useTranslation()
  const { currency } = useSystemConfig()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencySymbol =
    currencyMeta.kind === 'tokens' ? '$' : currencyMeta.symbol
  const [paying, setPaying] = useState(false)
  const [selectedEpayMethod, setSelectedEpayMethod] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (props.open && props.epayMethods && props.epayMethods.length > 0) {
      setSelectedEpayMethod(props.epayMethods[0].type)
    } else if (!props.open) {
      setSelectedEpayMethod('')
    }
  }, [props.open, props.epayMethods])

  const hasEpay =
    props.enableOnlineTopUp && (props.epayMethods || []).length > 0
  const hasAnyPayment = hasEpay
  const selectedEpayMethodLabel =
    (props.epayMethods || []).find((m) => m.type === selectedEpayMethod)
      ?.name ||
    selectedEpayMethod ||
    t('Select payment method')
  const price = Number(props.priceAmount || 0).toFixed(2)
  const quotaPerUnit =
    currency?.quotaPerUnit && currency.quotaPerUnit > 0
      ? currency.quotaPerUnit
      : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  const balanceCost = Math.max(
    0,
    Math.ceil(Number(props.priceAmount || 0) * quotaPerUnit)
  )
  const userQuota = Math.max(0, Number(props.userQuota || 0))
  const allowBalancePay = props.allowBalancePay !== false
  const insufficientBalance = userQuota < balanceCost
  const limitReached =
    (props.purchaseLimit || 0) > 0 &&
    (props.purchaseCount || 0) >= (props.purchaseLimit || 0)

  const isSafari =
    typeof navigator !== 'undefined' &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

  const handlePayEpay = async () => {
    if (!selectedEpayMethod) {
      toast.error(t('Please select a payment method'))
      return
    }
    setPaying(true)
    try {
      const res = await props.onPayEpay(selectedEpayMethod)
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

  const handlePayBalance = async () => {
    if (!allowBalancePay) {
      toast.error(t('This plan does not allow balance redemption'))
      return
    }
    setPaying(true)
    try {
      const res = await props.onPayBalance()
      if (res.success) {
        toast.success(props.successMessage)
        void props.onPurchaseSuccess?.()
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
      setConfirming(false)
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
          {props.title}
        </>
      }
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      {confirming ? (
        <div className='flex flex-col gap-3 rounded-md border p-3'>
          <p className='text-sm font-medium'>{t('Confirm purchase?')}</p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Buy {{plan}} for {{cost}} quota. Your balance is {{balance}}.',
              {
                plan: props.summaryRows[0]?.value ?? '',
                cost: formatQuota(balanceCost),
                balance: formatQuota(userQuota),
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
              onClick={() => void handlePayBalance()}
            >
              {t('Pay with Balance')}
            </Button>
          </div>
        </div>
      ) : (
        <div className='space-y-3 sm:space-y-4'>
          <div className='bg-muted/50 space-y-2.5 rounded-lg border p-3 sm:space-y-3 sm:p-4'>
            {props.summaryRows.map((row) => (
              <div key={row.key} className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {row.label}
                </span>
                <span className='flex items-center gap-1 text-right text-sm'>
                  {row.icon ? (
                    <span className='flex items-center gap-1'>{row.icon}</span>
                  ) : null}
                  <span className='max-w-[220px] truncate font-medium'>
                    {row.value}
                  </span>
                </span>
              </div>
            ))}
            <Separator />
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium'>{t('Amount Due')}</span>
              <span className='text-primary text-lg font-bold'>
                {currencySymbol}
                {price}
              </span>
            </div>
          </div>

          {limitReached && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('Purchase limit reached')} ({props.purchaseCount}/
                {props.purchaseLimit})
              </AlertDescription>
            </Alert>
          )}

          <div className='flex flex-col gap-2 rounded-md border p-3'>
            <div className='flex items-center justify-between gap-2 text-xs'>
              <span className='text-muted-foreground'>{t('Required')}</span>
              <span>{formatQuota(balanceCost)}</span>
            </div>
            <div className='flex items-center justify-between gap-2 text-xs'>
              <span className='text-muted-foreground'>{t('Available')}</span>
              <span>{formatQuota(userQuota)}</span>
            </div>
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
            <Button
              variant='outline'
              onClick={() => setConfirming(true)}
              disabled={
                paying ||
                limitReached ||
                !allowBalancePay ||
                insufficientBalance
              }
            >
              {t('Pay with Balance')}
            </Button>
          </div>

          {hasAnyPayment && (
            <div className='space-y-3'>
              <p className='text-muted-foreground text-xs'>
                {t('Select payment method')}
              </p>
              {hasEpay && (
                <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
                  <Select
                    items={[
                      ...(props.epayMethods || []).map((m) => ({
                        value: m.type,
                        label: m.name || m.type,
                      })),
                    ]}
                    value={selectedEpayMethod}
                    onValueChange={(v) =>
                      v !== null && setSelectedEpayMethod(v)
                    }
                    disabled={limitReached}
                  >
                    <SelectTrigger className='flex-1'>
                      <SelectValue>{selectedEpayMethodLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {(props.epayMethods || []).map((m) => (
                          <SelectItem key={m.type} value={m.type}>
                            {m.name || m.type}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handlePayEpay}
                    disabled={paying || !selectedEpayMethod || limitReached}
                  >
                    {t('Pay')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
