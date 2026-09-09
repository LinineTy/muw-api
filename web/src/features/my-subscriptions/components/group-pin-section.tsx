// @muw-owned

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { GroupBadge } from '@/components/group-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useMySubscriptions } from '@/features/my-subscriptions/components/my-subscriptions-provider'
import {
  getGroupPinProducts,
  purchaseGroupPinBalance,
  purchaseGroupPinEpay,
  type GroupPinProduct,
} from '@/features/profile/api'
import { ProductPurchaseDialog } from '@/features/subscriptions/components/dialogs/product-purchase-dialog'
import { getEpayMethods } from '../lib/helpers'
import { getCurrencyDisplay } from '@/lib/currency'
import { cn } from '@/lib/utils'

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
  const queryClient = useQueryClient()
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
        <ProductPurchaseDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setBuying(null)
            }
          }}
          title={
            <>
              <Pin className='h-5 w-5' />
              {t('Purchase Fixed Group')}
            </>
          }
          summaryRows={[
            {
              key: 'title',
              label: t('Product Name'),
              value: buying.title,
            },
            {
              key: 'group',
              label: t('Pinned Group'),
              value: <GroupBadge group={buying.group} />,
            },
            {
              key: 'validity',
              label: t('Validity Period'),
              value: t('Permanent'),
            },
          ]}
          priceAmount={Number(buying.price_amount || 0)}
          allowBalancePay={buying.allow_balance_pay !== false}
          userQuota={userQuota}
          enableOnlineTopUp={!!topupInfo?.enable_online_topup}
          epayMethods={epayMethods}
          onPayEpay={async (paymentMethod) => {
            const res = await purchaseGroupPinEpay({
              pin_product_id: buying.id,
              payment_method: paymentMethod,
            })
            return {
              message: res.message,
              url: res.url,
              data: res.data as Record<string, unknown> | undefined,
            }
          }}
          onPayBalance={() => purchaseGroupPinBalance(buying.id)}
          successMessage={t('Fixed group activated')}
          onPurchaseSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ['group-pin'] })
          }}
        />
      )}
    </section>
  )
}
