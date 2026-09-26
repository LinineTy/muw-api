// @muw-owned
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'

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
      if (deleted === null) {
        // 业务失败：明确报错，不把失败误报成「删除 0 张」的成功提示。
        toast.error(t('Cleanup failed'))
        setConfirmOpen(false)
        return
      }
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
    <div className='space-y-3'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>
          {t('Chat attachments auto-expire. Only count and size are shown.')}
        </p>
        <Button
          disabled={busy || (space?.transient_count ?? 0) === 0}
          onClick={() => setConfirmOpen(true)}
          size='sm'
          variant='outline'
        >
          <Trash2 className='mr-1.5 size-3.5' />
          {t('Clear my temporary images')}
        </Button>
      </div>

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

      <ConfirmDialog
        destructive
        desc={t('Your temporary images will be deleted immediately.')}
        confirmText={t('Clear')}
        handleConfirm={() => void handleClear()}
        isLoading={busy}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Clear my temporary images?')}
      />
    </div>
  )
}
