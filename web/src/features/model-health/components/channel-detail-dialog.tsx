// @muw-owned
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import type { ModelHealthRow } from '../types'
import { ChannelTestDetailPanel } from './channel-test-detail-panel'

/**
 * 渠道「明细」弹窗：原始探测记录（含分页），**仅管理员**可达 —— 触发按钮只在
 * 管理员视角渲染，后端 `/api/channel/health/records` 本身也是 AdminAuth。
 *
 * 面板组件原样复用（它自带查询与分页），所以弹窗只负责标题与开关。
 */
export function ChannelDetailDialog({
  row,
  onClose,
}: {
  row: ModelHealthRow | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  if (!row) return null

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='min-w-0 truncate'>
            {row.channel_name || t('Channel #{{id}}', { id: row.channel_id })}
          </DialogTitle>
          <DialogDescription className='font-mono text-xs'>
            {row.model_name} · #{row.channel_id}
          </DialogDescription>
        </DialogHeader>
        <ChannelTestDetailPanel row={row} />
      </DialogContent>
    </Dialog>
  )
}
