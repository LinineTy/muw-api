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
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { getSelf } from '@/lib/api'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { purchaseSpace } from '../api'
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
 */
export function SpaceHeader({ space, onPurchased }: SpaceHeaderProps) {
  const { t } = useTranslation()
  const [buyOpen, setBuyOpen] = useState(false)
  const [mbInput, setMbInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isRoot =
    (useAuthStore.getState().auth.user?.role ?? ROLE.USER) >= ROLE.SUPER_ADMIN
  const balance = useAuthStore((state) => state.auth.user?.quota)

  const mb = Number(mbInput)
  const ratio = space?.purchase_ratio ?? 0
  const maxMB = space?.max_purchase_mb ?? 1024
  const cost =
    Number.isInteger(mb) && mb > 0 ? purchasePriceToQuota(mb, ratio) : 0
  const perMBLabel =
    ratio > 0 ? formatQuota(purchasePriceToQuota(1, ratio)) : '—'

  const percent =
    space && space.capacity_bytes > 0
      ? Math.min(100, Math.round((space.used_bytes / space.capacity_bytes) * 100))
      : 0 // capacity<=0（root 无限 / 尚未加载）时不显示满格，避免误导
  const usedLabel = space ? formatBytes(space.used_bytes) : '—'
  let totalLabel = '—'
  if (space !== null) {
    totalLabel =
      space.capacity_bytes === -1
        ? t('Unlimited')
        : formatBytes(space.capacity_bytes)
  }

  const openConfirm = () => {
    if (!Number.isInteger(mb) || mb < 1 || mb > maxMB) {
      toast.error(t('Buy 1 to {{max}} MB at a time', { max: maxMB }))
      return
    }
    setConfirmOpen(true)
  }

  const handlePurchase = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const result = await purchaseSpace(mb)
      if (!result) {
        // 业务失败：拦截器已弹出后端 message（余额不足等），这里不重复提示，
        // 也避免把「购买比例配置错误」等非余额失败误标成 Insufficient balance。
        return
      }
      toast.success(t('Storage capacity purchased'))
      setMbInput('')
      setBuyOpen(false)
      // 刷新余额与用量。
      const self = await getSelf()
      if (self?.success) {
        useAuthStore.getState().auth.setUser(self.data)
      }
      onPurchased()
    } catch {
      toast.error(t('Purchase failed'))
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 bg-card px-3 py-2.5'>
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
          {t('Global')}:{' '}
          {space ? formatBytes(space.global_used_bytes) : '—'} /{' '}
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

      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>{t('Buy storage')}</DialogTitle>
            <DialogDescription>
              {t('Buy more storage with your quota.')}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Input
                aria-label={t('Buy storage')}
                inputMode='numeric'
                max={maxMB}
                min={1}
                placeholder={t('MB')}
                type='number'
                value={mbInput}
                onChange={(event) => setMbInput(event.target.value)}
              />
              {cost > 0 && (
                <p className='text-muted-foreground text-xs'>
                  {t('Cost: {{cost}} ({{perMB}}/MB)', {
                    cost: formatQuota(cost),
                    perMB: perMBLabel,
                  })}
                </p>
              )}
            </div>
            <p className='text-muted-foreground text-xs'>
              {t('Max per order')}: {maxMB} MB · {t('Your balance')}:{' '}
              {formatQuota(balance ?? 0)}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setBuyOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button disabled={busy} onClick={openConfirm}>
              {t('Buy storage')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        desc={t(
          'Buy {{mb}} MB of storage for {{cost}} quota. Your balance is {{balance}}.',
          {
            mb,
            cost: formatQuota(cost),
            balance: formatQuota(balance ?? 0),
          }
        )}
        confirmText={t('Buy storage')}
        handleConfirm={() => void handlePurchase()}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Confirm purchase?')}
      />
    </>
  )
}
