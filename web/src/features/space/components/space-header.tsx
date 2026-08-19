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
import { HardDrive, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTopupInfo } from '@/features/wallet/hooks/use-topup-info'
import { getSelf } from '@/lib/api'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { paySpaceEpay, purchaseSpace } from '../api'
import type { SpaceInfo } from '../types'

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 MB'
  }
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`
  }
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
}

/**
 * 展示货币价格 × MB → 原始额度。与后端 userSpacePurchaseRawQuota 一致：
 * 货币类 display = raw / quotaPerUnit × rate，TOKENS 直接相等。
 */
function purchasePriceToQuota(mb: number, pricePerMB: number): number {
  const { config, meta } = getCurrencyDisplay()
  const amount = mb * pricePerMB
  if (meta.kind === 'tokens') {
    return Math.round(amount)
  }
  const rate = meta.exchangeRate > 0 ? meta.exchangeRate : 1
  return Math.round((amount / rate) * config.quotaPerUnit)
}

type SpaceHeaderProps = {
  space: SpaceInfo | null
  onPurchased: () => void
}

/**
 * 云空间用量：紧凑横条（进度 + 已用/总量 + 购买入口），购买流程在弹窗内完成。
 * 支付双通道：余额购买（扣 quota）+ 在线支付（易支付，按充值同价换算）。
 */
export function SpaceHeader({ space, onPurchased }: SpaceHeaderProps) {
  const { t } = useTranslation()
  const [buyOpen, setBuyOpen] = useState(false)
  const [mbInput, setMbInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [selectedEpayMethod, setSelectedEpayMethod] = useState('')
  const isRoot =
    (useAuthStore.getState().auth.user?.role ?? ROLE.USER) >= ROLE.SUPER_ADMIN
  const balance = useAuthStore((state) => state.auth.user?.quota)

  // 在线支付配置：支付方式列表 + 开关（来自充值设置）。
  const { topupInfo } = useTopupInfo()
  const epayMethods = useMemo(
    () => (topupInfo?.pay_methods || []).filter((m) => m?.type),
    [topupInfo]
  )
  const hasEpay = !!topupInfo?.enable_online_topup && epayMethods.length > 0

  useEffect(() => {
    if (buyOpen && epayMethods.length > 0) {
      setSelectedEpayMethod(epayMethods[0].type)
    } else if (!buyOpen) {
      setSelectedEpayMethod('')
    }
  }, [buyOpen, epayMethods])

  const mb = Number(mbInput)
  const ratio = space?.purchase_ratio ?? 0
  const maxMB = space?.max_purchase_mb ?? 1024
  const cost =
    Number.isInteger(mb) && mb > 0 ? purchasePriceToQuota(mb, ratio) : 0
  const perMBLabel =
    ratio > 0 ? formatQuota(purchasePriceToQuota(1, ratio)) : '—'
  const insufficientBalance = cost > 0 && balance != null && balance < cost

  // 展示货币值（与 purchasePriceToQuota 的 amount 同口径），用于与支付方式
  // min_topup（展示货币下限）比较：低于下限的小额购买会在网关侧失败或产生
  // 小额异常单，钱包充值对每张支付卡做了同样校验，这里对齐。
  const displayAmount = mb * ratio
  const selectedEpayMethodObj = epayMethods.find(
    (m) => m.type === selectedEpayMethod
  )
  const selectedEpayMinTopup = Math.max(
    selectedEpayMethodObj?.min_topup ?? 0,
    topupInfo?.min_topup ?? 0
  )
  const epayBelowMin =
    selectedEpayMinTopup > 0 &&
    displayAmount > 0 &&
    displayAmount < selectedEpayMinTopup

  const percent =
    space && space.capacity_bytes > 0
      ? Math.min(
          100,
          Math.round((space.used_bytes / space.capacity_bytes) * 100)
        )
      : 0 // capacity<=0（root 无限 / 尚未加载）时不显示满格，避免误导
  const usedLabel = space ? formatBytes(space.used_bytes) : '—'
  let totalLabel = '—'
  if (space !== null) {
    totalLabel =
      space.capacity_bytes === -1
        ? t('Unlimited')
        : formatBytes(space.capacity_bytes)
  }

  const isSafari =
    typeof navigator !== 'undefined' &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

  const openConfirm = () => {
    if (!Number.isInteger(mb) || mb < 1 || mb > maxMB) {
      toast.error(t('Buy 1 to {{max}} MB at a time', { max: maxMB }))
      return
    }
    setConfirming(true)
  }

  const handlePurchase = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const result = await purchaseSpace(mb)
      if (!result) {
        // 业务失败：拦截器已弹出后端 message（余额不足等），这里不重复提示。
        return
      }
      toast.success(t('Storage capacity purchased'))
      setMbInput('')
      setBuyOpen(false)
      // 刷新余额与用量是购买成功后的非关键步骤：独立 try/catch，失败静默。
      // 绝不能与购买同 try——否则刷新抖动会弹「Purchase failed」且不关弹窗、
      // 不清金额，诱导用户二次点击重复扣费（后端购买非幂等）。
      try {
        const self = await getSelf()
        if (self?.success) {
          useAuthStore.getState().auth.setUser(self.data)
        }
        onPurchased()
      } catch {
        // 刷新失败不影响购买成功结论。
      }
    } catch {
      toast.error(t('Purchase failed'))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const handlePayEpay = async () => {
    if (!Number.isInteger(mb) || mb < 1 || mb > maxMB) {
      toast.error(t('Buy 1 to {{max}} MB at a time', { max: maxMB }))
      return
    }
    if (!selectedEpayMethod) {
      toast.error(t('Please select a payment method'))
      return
    }
    if (epayBelowMin) {
      toast.error(
        t('Minimum topup amount: {{amount}}', { amount: selectedEpayMinTopup })
      )
      return
    }
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const res = await paySpaceEpay({
        mb,
        payment_method: selectedEpayMethod,
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
        setMbInput('')
        setBuyOpen(false)
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
      setBusy(false)
    }
  }

  const selectedEpayMethodLabel =
    epayMethods.find((m) => m.type === selectedEpayMethod)?.name ||
    selectedEpayMethod ||
    t('Select payment method')

  return (
    <>
      <div className='border-border/60 bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5'>
        <span className='text-foreground text-sm font-medium'>
          {t('Storage')}
        </span>
        <div className='flex min-w-0 flex-1 basis-40 items-center gap-2'>
          <Progress
            aria-label={t('Storage usage')}
            className='flex-1'
            value={percent}
          />
          <span className='text-muted-foreground shrink-0 text-xs'>
            {usedLabel}
            {isRoot ? (
              <span> / {t('Unlimited')}</span>
            ) : (
              space !== null && <span> / {totalLabel}</span>
            )}
          </span>
        </div>
        <span className='text-muted-foreground text-xs'>
          {t('Global')}: {space ? formatBytes(space.global_used_bytes) : '—'} /{' '}
          {space ? formatBytes(space.global_max_bytes) : '—'}
        </span>
        {!isRoot && (
          <Button
            size='sm'
            variant='outline'
            disabled={!space}
            onClick={() => setBuyOpen(true)}
          >
            <Plus className='mr-1 size-3.5' />
            {t('Buy storage')}
          </Button>
        )}
      </div>

      <Dialog
        open={buyOpen}
        onOpenChange={(open) => {
          setBuyOpen(open)
          if (!open) {
            setConfirming(false)
          }
        }}
        title={
          <>
            <HardDrive className='h-5 w-5' />
            {t('Buy storage')}
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
                'Buy {{mb}} MB of storage for {{cost}} quota. Your balance is {{balance}}.',
                {
                  mb,
                  cost: formatQuota(cost),
                  balance: formatQuota(balance ?? 0),
                }
              )}
            </p>
            <div className='flex gap-2'>
              <Button
                className='flex-1'
                variant='outline'
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {t('Cancel')}
              </Button>
              <Button
                className='flex-1'
                disabled={busy}
                onClick={() => void handlePurchase()}
              >
                {t('Buy storage')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* 费用信息卡：数量 / 成本 / 单次上限 */}
            <div className='bg-muted/50 space-y-2.5 rounded-lg border p-3 sm:space-y-3 sm:p-4'>
              <div className='flex items-center justify-between gap-2'>
                <span className='text-muted-foreground text-sm'>MB</span>
                <Input
                  aria-label={t('Buy storage')}
                  className='w-32'
                  inputMode='numeric'
                  max={maxMB}
                  min={1}
                  placeholder={t('MB')}
                  type='number'
                  value={mbInput}
                  onChange={(event) => setMbInput(event.target.value)}
                />
              </div>
              {cost > 0 && (
                <p className='text-muted-foreground text-xs'>
                  {t('Cost: {{cost}} ({{perMB}}/MB)', {
                    cost: formatQuota(cost),
                    perMB: perMBLabel,
                  })}
                </p>
              )}
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {t('Max per order')}
                </span>
                <span className='text-sm'>{maxMB} MB</span>
              </div>
            </div>

            {/* 余额支付区 */}
            <div className='flex flex-col gap-2 rounded-md border p-3'>
              <div className='flex items-center justify-between gap-2 text-xs'>
                <span className='text-muted-foreground'>{t('Required')}</span>
                <span>{formatQuota(cost)}</span>
              </div>
              <div className='flex items-center justify-between gap-2 text-xs'>
                <span className='text-muted-foreground'>{t('Available')}</span>
                <span>{formatQuota(balance ?? 0)}</span>
              </div>
              {insufficientBalance && (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t('Insufficient balance')}
                  </AlertDescription>
                </Alert>
              )}
              <Button
                variant='outline'
                onClick={openConfirm}
                disabled={busy || insufficientBalance}
              >
                {t('Pay with Balance')}
              </Button>
            </div>

            {/* 在线支付区 */}
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
                    onValueChange={(v) =>
                      v !== null && setSelectedEpayMethod(v)
                    }
                  >
                    <SelectTrigger className='flex-1'>
                      <SelectValue>{selectedEpayMethodLabel}</SelectValue>
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
                    onClick={handlePayEpay}
                    disabled={busy || !selectedEpayMethod || epayBelowMin}
                  >
                    {t('Pay')}
                  </Button>
                </div>
                {epayBelowMin && (
                  <Alert variant='destructive'>
                    <AlertDescription>
                      {t('Minimum topup amount: {{amount}}', {
                        amount: selectedEpayMinTopup,
                      })}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </>
        )}
      </Dialog>
    </>
  )
}
