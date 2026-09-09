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
import { CalendarClock, Crown, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { formatQuota } from '@/lib/format'

import { paySubscriptionEpay, paySubscriptionBalance } from '../../api'
import {
  formatDuration,
  formatWindowPeriodLabel,
  isCapWindow,
  parsePlanResetWindows,
} from '../../lib'
import type { PlanRecord } from '../../types'
import {
  ProductPurchaseDialog,
  type PurchaseSummaryRow,
} from './product-purchase-dialog'

interface PaymentMethod {
  type: string
  name?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanRecord | null
  enableOnlineTopUp?: boolean
  epayMethods?: PaymentMethod[]
  purchaseLimit?: number
  purchaseCount?: number
  userQuota?: number
  onPurchaseSuccess?: () => void | Promise<void>
}

/**
 * 订阅套餐购买弹窗：ProductPurchaseDialog（通用商品购买弹窗）的订阅适配层，
 * 只负责把 PlanRecord 映射为摘要行与支付回调，交互/支付流程统一在通用组件内。
 */
export function SubscriptionPurchaseDialog(props: Props) {
  const { t } = useTranslation()

  const plan = props.plan?.plan
  if (!plan) return null

  // 动态窗口套餐：额度由各窗口定义，展示窗口摘要；全部窗口额度 0 = 无限额度。
  const resetWindows = parsePlanResetWindows(plan.reset_windows)
  const unlimited =
    resetWindows.length > 0 &&
    resetWindows.every((w) => Number(w.limit) <= 0)
  let planQuotaLabel: string
  if (unlimited) {
    planQuotaLabel = t('Unlimited')
  } else {
    planQuotaLabel = resetWindows
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
  }

  const summaryRows: PurchaseSummaryRow[] = [
    {
      key: 'title',
      label: t('Plan Name'),
      value: plan.title,
    },
    {
      key: 'validity',
      label: t('Validity Period'),
      icon: <CalendarClock className='h-3.5 w-3.5' />,
      value: formatDuration(plan, t),
    },
    {
      key: 'reset-period',
      label: t('Reset Period'),
      value: t('Rolling windows'),
    },
    {
      key: 'quota',
      label: t('Plan Quota'),
      icon: <Package className='h-3.5 w-3.5 shrink-0' />,
      value: planQuotaLabel,
    },
    ...(plan.upgrade_group
      ? [
          {
            key: 'upgrade-group',
            label: t('Upgrade Group'),
            value: <GroupBadge group={plan.upgrade_group} />,
          },
        ]
      : []),
  ]

  return (
    <ProductPurchaseDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <Crown className='h-5 w-5' />
          {t('Purchase Subscription')}
        </>
      }
      summaryRows={summaryRows}
      priceAmount={Number(plan.price_amount || 0)}
      allowBalancePay={plan.allow_balance_pay !== false}
      userQuota={Number(props.userQuota || 0)}
      purchaseLimit={props.purchaseLimit}
      purchaseCount={props.purchaseCount}
      enableOnlineTopUp={props.enableOnlineTopUp}
      epayMethods={props.epayMethods}
      onPayEpay={(paymentMethod) =>
        paySubscriptionEpay({ plan_id: plan.id, payment_method: paymentMethod })
      }
      onPayBalance={() => paySubscriptionBalance({ plan_id: plan.id })}
      successMessage={t('Subscription purchased successfully')}
      onPurchaseSuccess={props.onPurchaseSuccess}
    />
  )
}
