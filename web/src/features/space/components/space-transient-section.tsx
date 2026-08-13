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
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import { clearTransientImages } from '../api'
import type { SpaceInfo } from '../types'

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
}

type SpaceTransientSectionProps = {
  space: SpaceInfo | null
  onCleared: () => void
}

/**
 * 云空间「临时图」区：只显示张数+大小，不给预览（隐私/资源考虑）。
 * 提供「清空我的临时图」批量清理。
 */
export function SpaceTransientSection({
  space,
  onCleared,
}: SpaceTransientSectionProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleClear = async () => {
    setBusy(true)
    try {
      const deleted = await clearTransientImages()
      toast.success(t('Deleted {{count}} temporary images', { count: deleted }))
      setConfirmOpen(false)
      onCleared()
    } catch {
      toast.error(t('Cleanup failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className='flex-row items-start justify-between gap-4 space-y-0'>
        <div className='space-y-1'>
          <CardTitle>{t('Temporary images')}</CardTitle>
          <CardDescription>
            {t('Chat attachments auto-expire. Only count and size are shown.')}
          </CardDescription>
        </div>
        <Button
          disabled={busy || (space?.transient_count ?? 0) === 0}
          onClick={() => setConfirmOpen(true)}
          size='sm'
          variant='outline'
        >
          <Trash2 className='mr-1.5 size-3.5' />
          {t('Clear my temporary images')}
        </Button>
      </CardHeader>
      <CardContent>
        <dl className='text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-2 text-sm'>
          <div>
            <dt className='text-xs'>{t('Count')}</dt>
            <dd className='text-foreground font-medium'>
              {space?.transient_count ?? 0}
            </dd>
          </div>
          <div>
            <dt className='text-xs'>{t('Size')}</dt>
            <dd className='text-foreground font-medium'>
              {formatBytes(space?.transient_bytes ?? 0)}
            </dd>
          </div>
        </dl>
      </CardContent>

      <ConfirmDialog
        destructive
        desc={t('Your temporary images will be deleted immediately.')}
        confirmText={t('Clear')}
        handleConfirm={() => void handleClear()}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Clear my temporary images?')}
      />
    </Card>
  )
}
