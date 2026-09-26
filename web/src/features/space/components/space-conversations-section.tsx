// @muw-owned
import { Download, FileText, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { downloadBlob } from '@/lib/download'
import { DEFAULT_CONFIG } from '@/features/playground/constants'
import {
  type ConversationExportFormat,
  buildConversationExport,
} from '@/features/playground/lib/export/conversation-export'

import {
  deletePlaygroundConversation,
  listPlaygroundConversations,
} from '../api'
import type { RemoteConversation, SpaceInfo } from '../types'

const EXPORT_FORMAT_LABELS: Record<ConversationExportFormat, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  text: 'Plain text',
}

// updated_time 已是毫秒时间戳（后端 UnixMilli），直接 new Date，不再 ×1000——
// 二次放大会把 2026 年的值推到 58588 年。
function formatTime(timestampMs: number): string {
  if (!timestampMs) {
    return '—'
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestampMs))
}

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
 * 云空间「对话」区：列出服务端同步的会话，提供导出下载，不做在线浏览。
 * 顶部显示对话占用的云空间用量（与图片合并计入同一容量）。
 */
export function SpaceConversationsSection({
  space,
  onChanged,
}: {
  space: SpaceInfo | null
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const [conversations, setConversations] = useState<RemoteConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<RemoteConversation | null>(
    null
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setConversations(await listPlaygroundConversations())
    } catch {
      // 网络失败与「无数据」空态区分：失败给明确提示，避免误导用户以为没有会话。
      toast.error(t('Failed to load conversations'))
      setConversations([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const handleExport = (
    conversation: RemoteConversation,
    format: ConversationExportFormat
  ) => {
    const payload = buildConversationExport(
      format,
      conversation.title || 'conversation',
      conversation.messages ?? [],
      DEFAULT_CONFIG
    )
    downloadBlob(payload.content, payload.filename, payload.mimeType)
    toast.success(t('Conversation exported'))
  }

  const handleDelete = async () => {
    if (!deleteTarget) {
      return
    }
    try {
      await deletePlaygroundConversation(deleteTarget.client_id)
      toast.success(t('Conversation deleted'))
      setDeleteTarget(null)
      await load()
      // 删除后刷新顶部用量条与对话占用统计。
      onChanged?.()
    } catch {
      toast.error(t('Delete failed'))
    }
  }

  let listBody
  if (loading) {
    listBody = (
      <div className='space-y-2'>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton className='h-12 w-full rounded-lg' key={i} />
        ))}
      </div>
    )
  } else if (conversations.length === 0) {
    listBody = (
      <p className='text-muted-foreground text-sm'>
        {t('No synced conversations yet.')}
      </p>
    )
  } else {
    listBody = (
      <ul className='divide-border/60 divide-y'>
        {conversations.map((conversation) => (
          <li
            className='flex items-center gap-3 py-2.5'
            key={conversation.client_id}
          >
            <FileText className='text-muted-foreground size-4 shrink-0' />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm font-medium'>
                {conversation.title || t('Untitled conversation')}
              </p>
              <p className='text-muted-foreground text-xs'>
                {formatTime(conversation.updated_time)} ·{' '}
                {t('{{count}} messages', {
                  count: conversation.messages?.length ?? 0,
                })}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={t('Download conversation')}
                    size='sm'
                    variant='ghost'
                  >
                    <Download className='size-4' />
                  </Button>
                }
              />
              <DropdownMenuContent align='end'>
                {(['markdown', 'json', 'text'] as const).map((format) => (
                  <DropdownMenuItem
                    key={format}
                    onClick={() => handleExport(conversation, format)}
                  >
                    {t(EXPORT_FORMAT_LABELS[format])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              aria-label={t('Delete conversation')}
              className='text-muted-foreground hover:text-destructive'
              onClick={() => setDeleteTarget(conversation)}
              size='sm'
              variant='ghost'
            >
              <Trash2 className='size-4' />
            </Button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-sm'>
        {t('Synced conversations. Download to keep a copy.')}
      </p>
      {space != null && space.conversation_count > 0 && (
        <p className='text-muted-foreground text-xs'>
          {t('{{count}} conversations · {{size}} used', {
            count: space.conversation_count,
            size: formatBytes(space.conversation_used_bytes ?? 0),
          })}
        </p>
      )}
      {listBody}

      <ConfirmDialog
        destructive
        desc={t('This synced conversation will be removed from the server.')}
        confirmText={t('Delete')}
        handleConfirm={() => void handleDelete()}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        title={t('Delete conversation?')}
      />
    </div>
  )
}
