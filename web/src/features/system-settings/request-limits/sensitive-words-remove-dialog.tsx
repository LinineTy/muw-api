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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type MatchMode = 'exact' | 'contains'

// listWords 把词库按行拆成去重后的词列表（与导入解析保持一致）。
function listWords(existing: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of existing.split(/\r?\n/)) {
    const w = line.trim()
    if (w && !seen.has(w)) {
      seen.add(w)
      out.push(w)
    }
  }
  return out
}

// matchesWords 返回词库中匹配输入词的项（大小写不敏感）。exact=完全等于；contains=包含。
function matchesWords(
  existing: string,
  term: string,
  mode: MatchMode
): string[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return []
  return listWords(existing).filter((w) =>
    mode === 'exact'
      ? w.toLowerCase() === needle
      : w.toLowerCase().includes(needle)
  )
}

// keepAfterRemove 返回删除匹配项后剩余的词。
function keepAfterRemove(
  existing: string,
  term: string,
  mode: MatchMode
): string[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return listWords(existing)
  return listWords(existing).filter(
    (w) =>
      !(mode === 'exact'
        ? w.toLowerCase() === needle
        : w.toLowerCase().includes(needle))
  )
}

// 预览最多渲染的词条数，避免词库很大时卡页面。
const PREVIEW_LIMIT = 200

type SensitiveWordsRemoveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingWords: string
  onApply: (words: string[]) => void
}

export function SensitiveWordsRemoveDialog({
  open,
  onOpenChange,
  existingWords,
  onApply,
}: SensitiveWordsRemoveDialogProps) {
  const { t } = useTranslation()
  const [term, setTerm] = useState('')
  const [mode, setMode] = useState<MatchMode>('exact')

  // 每次打开重置输入。
  useEffect(() => {
    if (open) setTerm('')
  }, [open])

  const needle = term.trim()
  const matched = useMemo(
    () => matchesWords(existingWords, needle, mode),
    [existingWords, needle, mode]
  )

  const apply = () => {
    if (!needle) return
    onApply(keepAfterRemove(existingWords, needle, mode))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden'>
        <DialogHeader>
          <DialogTitle>{t('Remove keywords')}</DialogTitle>
          <DialogDescription>
            {t(
              'Type a keyword to find and remove it from the list. Useful for pruning false positives (e.g. system) from an imported word list.'
            )}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('Type a keyword to remove...')}
        />

        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <Button
            type='button'
            size='sm'
            variant={mode === 'exact' ? 'default' : 'outline'}
            onClick={() => setMode('exact')}
          >
            {t('Exact match')}
          </Button>
          <Button
            type='button'
            size='sm'
            variant={mode === 'contains' ? 'default' : 'outline'}
            onClick={() => setMode('contains')}
          >
            {t('Contains')}
          </Button>
        </div>

        {needle && (
          <div className='space-y-2'>
            {matched.length === 0 ? (
              <p className='text-muted-foreground text-xs'>
                {t('No matching keyword.')}
              </p>
            ) : (
              <>
                <p className='text-muted-foreground text-xs'>
                  {t('Will remove {{count}} keyword(s):', {
                    count: matched.length,
                  })}
                </p>
                <div className='flex max-h-40 min-w-0 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2 text-xs'>
                  {matched.slice(0, PREVIEW_LIMIT).map((w) => (
                    <span
                      key={w}
                      className='bg-destructive/10 text-destructive max-w-full break-all rounded px-1 py-0.5'
                    >
                      {w}
                    </span>
                  ))}
                  {matched.length > PREVIEW_LIMIT && (
                    <span className='text-muted-foreground w-full'>
                      {t('Showing first {{shown}} of {{total}}.', {
                        shown: PREVIEW_LIMIT,
                        total: matched.length,
                      })}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            variant='destructive'
            disabled={!needle || matched.length === 0}
            onClick={apply}
          >
            {t('Remove from list')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
