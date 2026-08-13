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
import {
  ChevronDown,
  Download,
  ImageIcon,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import type { ConversationExportFormat } from '../../lib/export/conversation-export'
import type { Conversation, PlaygroundMode } from '../../types'

type PlaygroundConversationBarProps = {
  conversations: Conversation[]
  activeConversationId: string | null
  activeTitle: string
  disabled?: boolean
  onSwitch: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onExport: (format: ConversationExportFormat) => void
  onOpenSystemPrompt: () => void
  mode: PlaygroundMode
  onModeChange: (mode: PlaygroundMode) => void
}

/**
 * Slim toolbar above the playground chat: mode switch (chat / image),
 * conversation switcher with rename/delete, new chat, system prompt and export.
 */
export function PlaygroundConversationBar({
  conversations,
  activeConversationId,
  activeTitle,
  disabled = false,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onExport,
  onOpenSystemPrompt,
  mode,
  onModeChange,
}: PlaygroundConversationBarProps) {
  const { t } = useTranslation()
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const activeId =
    activeConversationId &&
    conversations.some((conversation) => conversation.id === activeConversationId)
      ? activeConversationId
      : conversations[0]?.id ?? null

  const openRename = () => {
    setRenameValue(activeTitle)
    setRenameOpen(true)
  }

  const commitRename = () => {
    if (activeId && renameValue.trim()) {
      onRename(activeId, renameValue.trim())
    }
    setRenameOpen(false)
  }

  return (
    <div className='mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1.5 px-4 py-2'>
      {/* Mode switch */}
      <div className='bg-muted/50 border-border/60 flex items-center rounded-lg border p-0.5'>
        <Button
          className='h-6 px-2 text-xs'
          disabled={disabled}
          onClick={() => onModeChange('chat')}
          size='xs'
          variant={mode === 'chat' ? 'secondary' : 'ghost'}
        >
          <MessageSquareText />
          <span className='hidden sm:inline'>{t('Chat')}</span>
        </Button>
        <Button
          className='h-6 px-2 text-xs'
          disabled={disabled}
          onClick={() => onModeChange('image')}
          size='xs'
          variant={mode === 'image' ? 'secondary' : 'ghost'}
        >
          <ImageIcon />
          <span className='hidden sm:inline'>{t('Image generation')}</span>
        </Button>
      </div>

      {/* Conversation switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className='max-w-48 text-muted-foreground hover:text-foreground'
              disabled={disabled}
              size='sm'
              variant='ghost'
            >
              <span className='truncate'>{activeTitle}</span>
              <ChevronDown />
            </Button>
          }
        />
        <DropdownMenuContent align='start' className='min-w-56'>
          {conversations.map((conversation) => (
            <DropdownMenuItem
              key={conversation.id}
              onClick={() => onSwitch(conversation.id)}
            >
              <span className='min-w-0 flex-1 truncate'>
                {conversation.title}
              </span>
              <Button
                aria-label={t('Delete conversation')}
                className='size-5 shrink-0'
                onClick={(event) => {
                  event.stopPropagation()
                  setDeleteTarget(conversation.id)
                }}
                size='icon-xs'
                variant='ghost'
              >
                <Trash2 className='text-destructive' />
              </Button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem inset onClick={openRename}>
            <Pencil />
            {t('Rename')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        aria-label={t('New chat')}
        disabled={disabled}
        onClick={onCreate}
        size='sm'
        variant='ghost'
      >
        <Plus />
      </Button>

      <div className='flex-1' />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={t('System prompt')}
              disabled={disabled}
              onClick={onOpenSystemPrompt}
              size='sm'
              variant='ghost'
            >
              <Pencil />
              <span className='hidden md:inline'>{t('System prompt')}</span>
            </Button>
          }
        >
          {t('System prompt')}
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('System prompt')}</p>
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t('Export')}
              disabled={disabled || conversations.length === 0}
              size='sm'
              variant='ghost'
            >
              <Download />
              <span className='hidden md:inline'>{t('Export')}</span>
            </Button>
          }
        />
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={() => onExport('markdown')}>
            {t('Markdown')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExport('json')}>
            {t('JSON')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExport('text')}>
            {t('Plain text')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        destructive
        desc={t('This conversation will be removed. This cannot be undone.')}
        confirmText={t('Delete')}
        handleConfirm={() => {
          if (deleteTarget) {
            onDelete(deleteTarget)
          }
          setDeleteTarget(null)
        }}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        title={t('Delete conversation?')}
      />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>{t('Rename')}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              commitRename()
            }}
          >
            <Label htmlFor='conversation-name'>{t('Conversation name')}</Label>
            <Input
              autoFocus
              className='mt-2'
              id='conversation-name'
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setRenameOpen(false)
                }
              }}
              value={renameValue}
            />
            <DialogFooter className='mt-4'>
              <Button
                onClick={() => setRenameOpen(false)}
                type='button'
                variant='outline'
              >
                {t('Cancel')}
              </Button>
              <Button type='submit'>{t('Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
