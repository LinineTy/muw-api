// @muw-owned
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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

// parseTerms 把输入文本拆成要去除的词：每行一个词，行内也可用逗号分隔，去重。
function parseTerms(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of input.split(/\r?\n/)) {
    for (const part of line.split(',')) {
      const w = part.trim()
      if (w && !seen.has(w)) {
        seen.add(w)
        out.push(w)
      }
    }
  }
  return out
}

// matchesWords 返回词库 words 中匹配输入词 term 的项（大小写不敏感）。exact=完全等于；contains=包含。
function matchesWords(words: string[], term: string, mode: MatchMode): string[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return []
  return words.filter((w) =>
    mode === 'exact'
      ? w.toLowerCase() === needle
      : w.toLowerCase().includes(needle)
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

// 批量排除关键词：可一次输入多个词（每行一个/逗号分隔），点一次"从列表移除"删除全部
// 命中项，弹窗保持打开，可继续追加词；会话内累计显示已删除数量。精确/包含模式对整个输入生效。
export function SensitiveWordsRemoveDialog({
  open,
  onOpenChange,
  existingWords,
  onApply,
}: SensitiveWordsRemoveDialogProps) {
  const { t } = useTranslation()
  const [termsInput, setTermsInput] = useState('')
  const [mode, setMode] = useState<MatchMode>('exact')
  // 会话内的词库快照：每次删除后更新，后续输入的词基于删除后的库继续匹配。
  const [currentWords, setCurrentWords] = useState<string[]>([])
  const [removedCount, setRemovedCount] = useState(0)

  // 仅在弹窗由关→开时快照词库并清零；弹窗保持打开期间 onApply 会更新父级
  // existingWords，不能用它做依赖重置（否则每次删除后都会清空已删计数）。
  const prevOpen = useRef(open)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setTermsInput('')
      setCurrentWords(listWords(existingWords))
      setRemovedCount(0)
    }
    prevOpen.current = open
  }, [open, existingWords])

  const terms = useMemo(() => parseTerms(termsInput), [termsInput])

  // 当前输入词（们）会从词库删除的项（去重，预览用）。
  const matchedPreview = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const term of terms) {
      for (const w of matchesWords(currentWords, term, mode)) {
        if (!seen.has(w)) {
          seen.add(w)
          out.push(w)
        }
      }
    }
    return out
  }, [currentWords, mode, terms])

  const apply = () => {
    if (terms.length === 0) return
    const toRemove = new Set(matchedPreview)
    if (toRemove.size === 0) {
      toast.info(t('No matching keyword to remove.'))
      return
    }
    const next = currentWords.filter((w) => !toRemove.has(w))
    setCurrentWords(next)
    setRemovedCount((c) => c + toRemove.size)
    onApply(next)
    setTermsInput('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden'>
        <DialogHeader>
          <DialogTitle>{t('Remove keywords')}</DialogTitle>
          <DialogDescription>
            {t(
              'Enter one keyword per line (or comma-separated) and remove them all at once. The dialog stays open so you can keep adding keywords. Useful for pruning false positives (e.g. system) from an imported word list.'
            )}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={termsInput}
          onChange={(e) => setTermsInput(e.target.value)}
          rows={3}
          placeholder={t('keyword one, keyword two')}
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
          {removedCount > 0 && (
            <span className='text-muted-foreground text-xs'>
              {t('Removed {{count}} keyword(s) this session.', {
                count: removedCount,
              })}
            </span>
          )}
        </div>

        {terms.length > 0 && (
          <div className='space-y-2'>
            {matchedPreview.length === 0 ? (
              <p className='text-muted-foreground text-xs'>
                {t('No matching keyword.')}
              </p>
            ) : (
              <>
                <p className='text-muted-foreground text-xs'>
                  {t('Will remove {{count}} keyword(s):', {
                    count: matchedPreview.length,
                  })}
                </p>
                <div className='flex max-h-40 min-w-0 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2 text-xs'>
                  {matchedPreview.slice(0, PREVIEW_LIMIT).map((w) => (
                    <span
                      key={w}
                      className='bg-destructive/10 text-destructive max-w-full break-all rounded px-1 py-0.5'
                    >
                      {w}
                    </span>
                  ))}
                  {matchedPreview.length > PREVIEW_LIMIT && (
                    <span className='text-muted-foreground w-full'>
                      {t('Showing first {{shown}} of {{total}}.', {
                        shown: PREVIEW_LIMIT,
                        total: matchedPreview.length,
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
            {t('Done')}
          </Button>
          <Button
            type='button'
            variant='destructive'
            disabled={terms.length === 0 || matchedPreview.length === 0}
            onClick={apply}
          >
            {t('Remove from list')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
