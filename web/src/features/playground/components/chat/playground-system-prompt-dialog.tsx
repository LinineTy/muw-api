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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { deleteSystemPreset, loadSystemPresets, saveSystemPreset } from '../../lib'
import type { SystemPreset } from '../../types'

type PlaygroundSystemPromptDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialContent: string
  onApply: (content: string) => void
  onClear: () => void
}

/**
 * Edit the active conversation's system prompt, with saved presets.
 */
export function PlaygroundSystemPromptDialog({
  open,
  onOpenChange,
  initialContent,
  onApply,
  onClear,
}: PlaygroundSystemPromptDialogProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState(initialContent)
  const [presets, setPresets] = useState<SystemPreset[]>(() =>
    loadSystemPresets()
  )
  const [presetName, setPresetName] = useState('')

  // 弹窗常驻挂载，content 初始化只在首次挂载生效；切换会话后重开必须重置为
  // 当前会话的 initialContent，否则会把上一个会话的文本写进新会话。
  useEffect(() => {
    if (open) {
      setContent(initialContent)
    }
  }, [open, initialContent])

  const handleSavePreset = () => {
    const name = presetName.trim()
    if (!name || !content.trim()) {
      toast.error(t('Enter a preset name'))
      return
    }
    setPresets((prev) => saveSystemPreset(prev, name, content))
    setPresetName('')
    toast.success(t('Preset saved'))
  }

  const handleApply = () => {
    onApply(content)
    onOpenChange(false)
  }

  const handleClear = () => {
    onClear()
    setContent('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('System prompt')}</DialogTitle>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='system-prompt'>{t('System prompt')}</Label>
            <Textarea
              className='min-h-32'
              id='system-prompt'
              onChange={(event) => setContent(event.target.value)}
              placeholder={t('System prompt')}
              value={content}
            />
          </div>

          <div className='space-y-2'>
            <Label>{t('System prompt presets')}</Label>
            {presets.length === 0 ? (
              <p className='text-muted-foreground text-xs'>
                {t('No presets yet')}
              </p>
            ) : (
              <div className='flex max-h-40 flex-col gap-1 overflow-y-auto'>
                {presets.map((preset) => (
                  <div
                    className='bg-muted/40 flex items-center gap-1 rounded-md px-2 py-1'
                    key={preset.id}
                  >
                    <Button
                      className='h-6 flex-1 justify-start truncate px-1 text-xs'
                      onClick={() => setContent(preset.content)}
                      size='xs'
                      variant='ghost'
                    >
                      {preset.name}
                    </Button>
                    <Button
                      aria-label={t('Delete')}
                      className='size-5 shrink-0'
                      onClick={() =>
                        setPresets((prev) => deleteSystemPreset(prev, preset.id))
                      }
                      size='icon-xs'
                      variant='ghost'
                    >
                      <Trash2 className='text-destructive' />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className='flex items-center gap-2 pt-1'>
              <Input
                className='h-8 flex-1'
                onChange={(event) => setPresetName(event.target.value)}
                placeholder={t('Preset name')}
                value={presetName}
              />
              <Button
                className='h-8'
                onClick={handleSavePreset}
                size='sm'
                variant='outline'
              >
                {t('Save as preset')}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleClear} type='button' variant='ghost'>
            {t('Clear system prompt')}
          </Button>
          <Button onClick={() => onOpenChange(false)} type='button' variant='outline'>
            {t('Cancel')}
          </Button>
          <Button onClick={handleApply} type='button'>
            {t('Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
