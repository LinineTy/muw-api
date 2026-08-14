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
import { Download, FileText, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
import type { RemoteConversation } from '../types'

const EXPORT_FORMAT_LABELS: Record<ConversationExportFormat, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  text: 'Plain text',
}

function formatTime(unixSeconds: number): string {
  if (!unixSeconds) {
    return '—'
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(unixSeconds * 1000))
}

/**
 * 云空间「对话」区：列出服务端同步的会话，提供导出下载，不做在线浏览。
 */
export function SpaceConversationsSection() {
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
    <Card>
      <CardHeader>
        <CardTitle>{t('Conversations')}</CardTitle>
        <CardDescription>
          {t('Synced conversations. Download to keep a copy.')}
        </CardDescription>
      </CardHeader>
      <CardContent>{listBody}</CardContent>

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
    </Card>
  )
}
