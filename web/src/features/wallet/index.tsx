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
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'

import { SectionPageLayout } from '@/components/layout'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { getSelf } from '@/lib/api'
import { MySubscriptionsProvider } from '@/features/my-subscriptions/components/my-subscriptions-provider'

import { AffiliateRewardsCard } from './components/affiliate-rewards-card'
import { PaymentConfirmDialog } from './components/dialogs/payment-confirm-dialog'
import { RedemptionDialog } from './components/dialogs/redemption-dialog'
import { TransferDialog } from './components/dialogs/transfer-dialog'
import { QuotaPoolClaimCard } from './components/quota-pool-claim-card'
import { RechargeFormCard } from './components/recharge-form-card'
import { SubscriptionSummaryCard } from './components/subscription-summary-card'
import { WalletStatsCard } from './components/wallet-stats-card'
import { DEFAULT_DISCOUNT_RATE } from './constants'
import {
  useTopupInfo,
  usePayment,
  useAffiliate,
  useRedemption,
} from './hooks'
import {
  getDefaultPaymentType,
  getMinTopupAmount,
  dispatchSelectedPayment,
} from './lib'
import type {
  UserWalletData,
  PaymentMethod,
  PresetAmount,
} from './types'

interface WalletProps {
  initialShowHistory?: boolean
}

export function Wallet(props: WalletProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [topupAmount, setTopupAmount] = useState(0)
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>()
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [redemptionDialogOpen, setRedemptionDialogOpen] = useState(false)

  const { status } = useStatus()
  const { currency } = useSystemConfig()
  const { topupInfo, presetAmounts, loading: topupLoading } = useTopupInfo()

  // 推广返利(推荐计划)开关，关闭后不展示钱包推荐卡片
  // getStatus() 返回扁平化的 status 数据，字段在顶层而非 data 下
  const affiliateEnabled = status?.affiliate_program_enabled !== false
  // 额度池功能开关
  const quotaPoolEnabled = status?.quota_pool_enabled === true

  // Calculate effective exchange rate - when display type is USD, use rate of 1
  const effectiveUsdExchangeRate = useMemo(() => {
    return currency?.quotaDisplayType === 'USD'
      ? 1
      : currency?.usdExchangeRate || 1
  }, [currency?.quotaDisplayType, currency?.usdExchangeRate])
  const {
    amount: paymentAmount,
    calculating,
    processing,
    calculatePaymentAmount,
    processPayment,
  } = usePayment()
  const {
    affiliateLink,
    loading: affiliateLoading,
    transferQuota,
    transferring,
  } = useAffiliate()
  const { redeeming, redeemCode } = useRedemption()

  // Fetch and refresh user data
  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  useEffect(() => {
    if (props.initialShowHistory) {
      // 旧 /wallet?show_history=true 深链 → 跳订单中心充值记录 Tab（跳转由 navigate
      // 改变 URL，无需再 replaceState）。
      navigate({ to: '/orders', search: { tab: 'billing' } })
    }
  }, [props.initialShowHistory, navigate])

  // Initialize topup amount when topup info is loaded
  const topupAmountInitializedRef = useRef(false)
  useEffect(() => {
    if (topupInfo && !topupAmountInitializedRef.current) {
      topupAmountInitializedRef.current = true
      const minTopup = getMinTopupAmount(topupInfo)
      setTopupAmount(minTopup)

      // Calculate initial payment amount with default payment type
      const defaultPaymentType = getDefaultPaymentType(topupInfo)
      calculatePaymentAmount(minTopup, defaultPaymentType)
    }
  }, [topupInfo, calculatePaymentAmount])

  // Get current payment type (selected or default)
  const getCurrentPaymentType = useCallback(() => {
    return selectedPaymentMethod?.type || getDefaultPaymentType(topupInfo)
  }, [selectedPaymentMethod, topupInfo])

  // Handle preset selection
  const handleSelectPreset = (preset: PresetAmount) => {
    setTopupAmount(preset.value)
    setSelectedPreset(preset.value)
    calculatePaymentAmount(preset.value, getCurrentPaymentType())
  }

  // Handle topup amount change
  const handleTopupAmountChange = (amount: number) => {
    setTopupAmount(amount)
    setSelectedPreset(null)
    calculatePaymentAmount(amount, getCurrentPaymentType())
  }

  // Handle payment method selection
  const handlePaymentMethodSelect = async (method: PaymentMethod) => {
    setSelectedPaymentMethod(method)
    setPaymentLoading(method.type)

    try {
      // Validate minimum topup
      const minTopup = getMinTopupAmount(topupInfo)
      if (topupAmount < minTopup) {
        return
      }

      // Calculate payment amount and show confirmation dialog
      await calculatePaymentAmount(topupAmount, method.type)
      setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  // Handle payment confirmation
  const handlePaymentConfirm = async () => {
    if (!selectedPaymentMethod) return

    const success = await dispatchSelectedPayment(
      selectedPaymentMethod,
      topupAmount,
      {
        regular: processPayment,
      }
    )

    if (success) {
      setConfirmDialogOpen(false)
      await fetchUser()
    }
  }

  // Handle redemption
  const handleRedeem = async (code: string) => {
    const success = await redeemCode(code)
    if (success) {
      await fetchUser()
    }
    return success
  }

  // Handle transfer
  const handleTransfer = async (amount: number) => {
    const success = await transferQuota(amount)
    if (success) {
      await fetchUser()
    }
    return success
  }

  // Get discount rate for current topup amount
  const getDiscountRate = useCallback(() => {
    return topupInfo?.discount?.[topupAmount] || DEFAULT_DISCOUNT_RATE
  }, [topupInfo, topupAmount])

  // 深链跳转生效前不渲染 Wallet，避免闪一帧再跳。条件 return 必须放在所有 hooks
  // 之后，否则同一组件实例在 show_history 参数切换时 hooks 数量不一致会触发
  // "Rendered more hooks than during the previous render" 崩溃。
  if (props.initialShowHistory) {
    return null
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Wallet')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
            {/* 布局比例与个人资料页一致：左 1fr / 右 minmax(360px, 0.46fr) */}
            <div className='grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.46fr)] xl:items-start'>
              <MySubscriptionsProvider>
                <div className='flex min-w-0 flex-col gap-4 sm:gap-5'>
                  <WalletStatsCard
                    user={user}
                    loading={userLoading}
                    onOpenRedemption={() => setRedemptionDialogOpen(true)}
                  />
                  <SubscriptionSummaryCard />
                  <div id='wallet-add-funds' className='scroll-mt-4'>
                    <RechargeFormCard
                      topupInfo={topupInfo}
                      presetAmounts={presetAmounts}
                      selectedPreset={selectedPreset}
                      onSelectPreset={handleSelectPreset}
                      topupAmount={topupAmount}
                      onTopupAmountChange={handleTopupAmountChange}
                      paymentAmount={paymentAmount}
                      calculating={calculating}
                      onPaymentMethodSelect={handlePaymentMethodSelect}
                      paymentLoading={paymentLoading}
                      loading={topupLoading}
                      priceRatio={(status?.price as number) || 1}
                      usdExchangeRate={effectiveUsdExchangeRate}
                    />
                  </div>
                </div>
              </MySubscriptionsProvider>

              <div className='flex min-w-0 flex-col gap-4 sm:gap-5'>
                {quotaPoolEnabled && (
                  <QuotaPoolClaimCard enabled onBalanceChange={fetchUser} />
                )}
                {affiliateEnabled && (
                  <AffiliateRewardsCard
                    user={user}
                    affiliateLink={affiliateLink}
                    onTransfer={() => setTransferDialogOpen(true)}
                    loading={affiliateLoading}
                  />
                )}
              </div>
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <PaymentConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        onConfirm={handlePaymentConfirm}
        topupAmount={topupAmount}
        paymentAmount={paymentAmount}
        paymentMethod={selectedPaymentMethod}
        calculating={calculating}
        processing={processing}
        discountRate={getDiscountRate()}
        usdExchangeRate={effectiveUsdExchangeRate}
      />

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={user?.aff_quota ?? 0}
        transferring={transferring}
      />

      <RedemptionDialog
        open={redemptionDialogOpen}
        onOpenChange={setRedemptionDialogOpen}
        onRedeem={handleRedeem}
        redeeming={redeeming}
        topupLink={topupInfo?.topup_link}
      />
    </>
  )
}
