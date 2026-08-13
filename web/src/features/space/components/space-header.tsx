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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { getSelf } from '@/lib/api'
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

type SpaceHeaderProps = {
  space: SpaceInfo | null
  onPurchased: () => void
}

/**
 * 云空间头部：用量进度 + 容量购买。
 */
export function SpaceHeader({ space, onPurchased }: SpaceHeaderProps) {
  const { t } = useTranslation()
  const [mbInput, setMbInput] = useState('')
  const [busy, setBusy] = useState(false)
  const isRoot =
    (useAuthStore.getState().auth.user?.role ?? ROLE.USER) >= ROLE.SUPER_ADMIN
  const balance = useAuthStore((state) => state.auth.user?.quota)

  const handlePurchase = async () => {
    const mb = Number(mbInput)
    if (!Number.isInteger(mb) || mb < 1 || mb > 1024) {
      toast.error(t('Buy 1 to 1024 MB at a time'))
      return
    }
    setBusy(true)
    try {
      const result = await purchaseSpace(mb)
      if (!result) {
        toast.error(t('Insufficient balance'))
        return
      }
      toast.success(t('Storage capacity purchased'))
      setMbInput('')
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
    }
  }

  const percent =
    space && space.capacity_bytes > 0
      ? Math.min(100, Math.round((space.used_bytes / space.capacity_bytes) * 100))
      : 100
  let totalLabel = '—'
  if (space !== null) {
    totalLabel =
      space.capacity_bytes === -1
        ? t('Unlimited')
        : formatBytes(space.capacity_bytes)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Cloud Space')}</CardTitle>
        <CardDescription>
          {t('Storage of your playground files and synced conversations.')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='space-y-2'>
          <div className='text-muted-foreground flex items-baseline justify-between text-sm'>
            <span>
              {t('Used')}: {space ? formatBytes(space.used_bytes) : '—'}
            </span>
            <span>
              {t('Total')}: {totalLabel}
            </span>
          </div>
          <Progress aria-label={t('Storage usage')} value={percent} />
        </div>

        <div className='text-muted-foreground text-xs'>
          {t('Global')}: {space ? formatBytes(space.global_used_bytes) : '—'} /{' '}
          {space ? formatBytes(space.global_max_bytes) : '—'}
        </div>

        {!isRoot && (
          <div className='border-border/60 flex flex-wrap items-end gap-2 border-t pt-4'>
            <div className='space-y-1'>
              <Input
                aria-label={t('Buy storage')}
                className='w-36'
                inputMode='numeric'
                min={1}
                placeholder={t('MB')}
                type='number'
                value={mbInput}
                onChange={(event) => setMbInput(event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                {t('Purchase ratio')}: {space?.purchase_ratio ?? '—'}{' '}
                {t('quota per MB')} · {t('Your balance')}: {balance ?? 0}
              </p>
            </div>
            <Button disabled={busy} onClick={() => void handlePurchase()}>
              {t('Buy storage')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
