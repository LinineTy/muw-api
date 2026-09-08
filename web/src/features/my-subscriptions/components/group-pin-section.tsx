// @muw-owned

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useMySubscriptions } from '@/features/my-subscriptions/components/my-subscriptions-provider'
import {
  getGroupPinProducts,
  purchaseGroupPinBalance,
  purchaseGroupPinEpay,
  type GroupPinProduct,
} from '@/features/profile/api'
import { getEpayMethods } from '../lib/helpers'
import type { PaymentMethod } from '@/features/wallet/types'
import { formatQuota } from '@/lib/format'
import { getCurrencyDisplay } from '@/lib/currency'
import { DEFAULT_CURRENCY_CONFIG } from '@/stores/system-config-store'
import { cn } from '@/lib/utils'

// ---- 支付对话框：固定分组购买（Epay 在线支付 / 余额兑换，与订阅购买一致） ----

function GroupPinPayDialog({
  product,
  balance,
  epayMethods,
  onClose,
}: {
  product: GroupPinProduct
  balance: number
  epayMethods: PaymentMethod[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencySymbol = currencyMeta.kind === 'tokens' ? '$' : currencyMeta.symbol
  const quotaPerUnit =
    currencyMeta.kind === 'tokens' ? DEFAULT_CURRENCY_CONFIG.quotaPerUnit : 1
  const price = Number(product.price_amount || 0).toFixed(2)
  const balanceCost = Math.max(0, Math.ceil(Number(product.price_amount || 0) * quotaPerUnit))
  const insufficientBalance = balance < balanceCost

  const hasEpay = epayMethods.length > 0
  const allowBalance = product.allow_balance_pay !== false
  const [method, setMethod] = useState(
    hasEpay ? `epay:${epayMethods[0].type}` : allowBalance ? 'balance' : ''
  )
  const [paying, setPaying] = useState(false)
  const isBalance = method === 'balance'

  useEffect(() => {
    if (!hasEpay && allowBalance) setMethod('balance')
    if (!allowBalance && method === 'balance') setMethod(hasEpay ? `epay:${epayMethods[0].type}` : '')
  }, [hasEpay, allowBalance])

  const finish = () => {
    toast.success(t('Fixed group activated'))
    queryClient.invalidateQueries({ queryKey: ['group-pin'] })
    onClose()
  }

  const payBalance = useMutation({
    mutationFn: () => purchaseGroupPinBalance(product.id),
    onSettled: () => setPaying(false),
    onSuccess: (res) => {
      if (res.success) {
        finish()
      } else {
        toast.error(res.message ?? t('Purchase failed'))
      }
    },
    onError: () => toast.error(t('Purchase failed')),
  })

  const payEpay = useMutation({
    mutationFn: () =>
      purchaseGroupPinEpay({
        pin_product_id: product.id,
        payment_method: method.slice(5),
      }),
    onSettled: () => setPaying(false),
    onSuccess: (res) => {
      if (res.message === 'success' && res.url) {
        const form = document.createElement('form')
        form.action = res.url
        form.method = 'POST'
        form.target = '_blank'
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
        onClose()
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    },
    onError: () => toast.error(t('Payment request failed')),
  })

  const paymentItems = [
    ...epayMethods.map((m) => ({
      value: `epay:${m.type}`,
      label: m.name || m.type,
    })),
    ...(allowBalance ? [{ value: 'balance', label: t('Balance') }] : []),
  ]
  const selectedPaymentLabel =
    paymentItems.find((it) => it.value === method)?.label ?? method

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('Subscribe Now')} — {product.title}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3 py-2'>
          <p className='text-muted-foreground text-xs'>
            {t('Select payment method')}
          </p>
          <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
            <Select
              items={paymentItems}
              value={method}
              onValueChange={(v) => v !== null && setMethod(v)}
            >
              <SelectTrigger className='flex-1'>
                <SelectValue>{selectedPaymentLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {paymentItems.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {it.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              disabled={paying || (isBalance && insufficientBalance)}
              onClick={() => (isBalance ? payBalance.mutate() : payEpay.mutate())}
            >
              {isBalance ? t('Subscribe Now') : t('Pay')}
            </Button>
          </div>
          {isBalance && (
            <div className='text-muted-foreground grid gap-1 text-xs'>
              <div className='flex justify-between'>
                <span>{t('Required')}</span>
                <span>
                  {currencySymbol}
                  {price}
                </span>
              </div>
              <div className='flex justify-between'>
                <span>{t('Available')}</span>
                <span>{formatQuota(balance)}</span>
              </div>
            </div>
          )}
          {isBalance && insufficientBalance && (
            <p className='text-destructive text-xs'>
              {t('Insufficient balance')}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('Cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- 固定分组商品区块：卡片结构与订阅套餐卡片一致 ----

function GroupPinCard({
  product,
  onBuy,
}: {
  product: GroupPinProduct
  onBuy: (product: GroupPinProduct) => void
}) {
  const { t } = useTranslation()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencySymbol = currencyMeta.kind === 'tokens' ? '$' : currencyMeta.symbol
  const price = Number(product.price_amount || 0).toFixed(2)

  // 权益条目：一行一个（区别于套餐的双列），描述特殊订阅的语义。
  const benefits = [
    t('Special subscription'),
    t('Group pinned to {{group}}', { group: product.group }),
  ]

  return (
    <div
      className={cn(
        'bg-card flex h-full min-h-[280px] flex-col justify-between gap-4 rounded-xl border border-border/70 p-5',
        product.is_recommended && 'border-primary/40'
      )}
    >
      {/* 头部：标题 + 推荐 tag + 副标题（无说明时淡色占位，与套餐卡片对齐） */}
      <div className='flex flex-col gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <h3 className='truncate text-lg font-medium'>{product.title}</h3>
          {product.is_recommended && (
            <span className='bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium'>
              <Sparkles className='size-3' />
              {t('Recommended')}
            </span>
          )}
        </div>
        <p
          className={cn(
            'min-h-5 truncate text-xs',
            product.subtitle
              ? 'text-muted-foreground'
              : 'text-muted-foreground/50'
          )}
          title={product.subtitle}
        >
          {product.subtitle || t('No description')}
        </p>

        {/* 价格行：无周期（固定分组没有时长概念） */}
        <div className='flex flex-wrap items-end gap-1 pt-1'>
          <span className='text-primary text-sm leading-5'>
            {currencySymbol}
          </span>
          <span className='text-primary text-3xl leading-8 font-bold'>
            {price}
          </span>
        </div>

        {/* 虚线分隔 */}
        <div className='border-t border-dashed border-border/70 pt-3' />

        {/* 权益列表：单列 */}
        <ul className='flex flex-col gap-1.5'>
          {benefits.map((benefit) => (
            <li
              key={benefit}
              className='text-muted-foreground flex items-center gap-1.5 text-sm'
            >
              <span className='text-primary'>✓</span>
              {benefit}
            </li>
          ))}
        </ul>
      </div>

      {/* 底部操作区：与套餐卡片一致的通栏按钮，点击弹出支付方式选择 */}
      <Button variant='outline' className='w-full' onClick={() => onBuy(product)}>
        {t('Subscribe Now')}
      </Button>
    </div>
  )
}

/**
 * 固定分组商品区块（购买页）：卡片结构与订阅套餐一致（价格/注释/单列条目/通栏按钮）。
 * 无上架商品时整块不渲染。支持 Epay 在线支付与余额兑换（与订阅购买同通道）。
 */

/**
 * 固定分组商品区块（购买页）：卡片结构与订阅套餐一致（价格/注释/单列条目/通栏按钮）。
 * 无上架商品时整块不渲染。支持 Epay 在线支付与余额兑换（与订阅购买同通道）。
 */
export function GroupPinCatalogSection() {
  const { t } = useTranslation()
  const { topupInfo, userQuota } = useMySubscriptions()
  const [buying, setBuying] = useState<GroupPinProduct | null>(null)

  const productsQuery = useQuery({
    queryKey: ['group-pin', 'products'],
    queryFn: getGroupPinProducts,
  })
  const products = productsQuery.data?.data ?? []
  const epayMethods = useMemo(
    () => getEpayMethods(topupInfo?.pay_methods),
    [topupInfo?.pay_methods]
  )

  if (productsQuery.isLoading) {
    return (
      <section className='flex flex-col gap-3'>
        <h2 className='text-sm font-semibold tracking-tight'>
          {t('Fixed Groups')}
        </h2>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className='h-64 w-full' />
          ))}
        </div>
      </section>
    )
  }

  if (products.length === 0) return null

  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-sm font-semibold tracking-tight'>
        {t('Fixed Groups')}
      </h2>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {products.map((product) => (
          <GroupPinCard
            key={product.id}
            product={product}
            onBuy={setBuying}
          />
        ))}
      </div>
      {buying && (
        <GroupPinPayDialog
          product={buying}
          balance={userQuota}
          epayMethods={epayMethods}
          onClose={() => setBuying(null)}
        />
      )}
    </section>
  )
}
