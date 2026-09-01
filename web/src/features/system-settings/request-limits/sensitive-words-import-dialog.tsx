// @muw-owned
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { parseSensitiveWords } from './sensitive-words-parse'

// 预览最多渲染的词条数：词库可能很大（几万个），全量渲染会卡死页面；只显示前 N 个，
// 其余在文案里给出总数。"移除被标记词"仍作用于全部解析结果，不受预览截断影响。
const PREVIEW_LIMIT = 200

// mergeWords 把新词并入现有词库（现有在前、新词追加，整体去重保序）。
function mergeWords(existing: string, incoming: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (w: string) => {
    const t = w.trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  for (const line of existing.split(/\r?\n/)) push(line)
  for (const w of incoming) push(w)
  return out
}

// countWords 统计现有词库的词数（去重），供"追加到现有 (N)"展示。
function countWords(existing: string): number {
  const seen = new Set<string>()
  let n = 0
  for (const line of existing.split(/\r?\n/)) {
    const t = line.trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      n++
    }
  }
  return n
}

type SensitiveWordsImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingWords: string
  onApply: (words: string[]) => void
}

export function SensitiveWordsImportDialog({
  open,
  onOpenChange,
  existingWords,
  onApply,
}: SensitiveWordsImportDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [raw, setRaw] = useState('')
  const [replace, setReplace] = useState(false)
  const [fileName, setFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 每次打开弹窗重置状态，避免残留上次内容。
  useEffect(() => {
    if (open) {
      setRaw('')
      setReplace(false)
      setFileName('')
    }
  }, [open])

  const parsed = useMemo(
    () => (raw.trim() ? parseSensitiveWords(raw) : null),
    [raw]
  )
  const existingCount = useMemo(() => countWords(existingWords), [existingWords])
  const riskCount = parsed?.riskIndices.length ?? 0
  const riskSet = useMemo(
    () => new Set(parsed?.riskIndices ?? []),
    [parsed]
  )

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setRaw(await file.text())
  }

  const removeRisky = () => {
    if (!parsed) return
    const kept = parsed.words.filter((_, i) => !parsed.riskIndices.includes(i))
    setRaw(kept.join('\n'))
  }

  const apply = () => {
    if (!parsed) return
    const final = replace ? parsed.words : mergeWords(existingWords, parsed.words)
    onApply(final)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden'>
        <DialogHeader>
          <DialogTitle>{t('Import sensitive keywords')}</DialogTitle>
          <DialogDescription>
            {t(
              'Paste or upload a keyword list. It is parsed, cleaned and previewed before applying; broad single words (short English words or very short Chinese terms) are flagged as likely false positives.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='flex items-center gap-1'>
          <Button
            type='button'
            size='sm'
            variant={mode === 'paste' ? 'default' : 'outline'}
            onClick={() => setMode('paste')}
          >
            {t('Paste text')}
          </Button>
          <Button
            type='button'
            size='sm'
            variant={mode === 'file' ? 'default' : 'outline'}
            onClick={() => setMode('file')}
          >
            {t('Upload file')}
          </Button>
        </div>

        {mode === 'paste' ? (
          <Textarea
            rows={6}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t(
              'Paste keywords here, one per line (commas or semicolons also work)...'
            )}
          />
        ) : (
          <div className='space-y-2'>
            <input
              ref={fileInputRef}
              type='file'
              accept='.txt,.csv'
              onChange={handleFile}
              className='hidden'
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => fileInputRef.current?.click()}
            >
              {t('Choose a .txt or .csv file')}
            </Button>
            {fileName && (
              <p className='text-muted-foreground text-xs'>{fileName}</p>
            )}
            {raw && (
              <p className='text-muted-foreground text-xs'>
                {t('Read {{count}} lines.', {
                  count: raw.split(/\r?\n/).length,
                })}
              </p>
            )}
          </div>
        )}

        {parsed && (
          <div className='space-y-2'>
            <p className='text-muted-foreground text-xs'>
              {t('Parsed {{count}} keywords, {{risk}} may be too generic.', {
                count: parsed.words.length,
                risk: riskCount,
              })}
            </p>
            <div className='flex max-h-48 min-w-0 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2 text-xs'>
              {parsed.words.length === 0 && (
                <span className='text-muted-foreground'>
                  {t('No keywords found')}
                </span>
              )}
              {parsed.words.slice(0, PREVIEW_LIMIT).map((w, i) => (
                <span
                  key={w}
                  className={cn(
                    'max-w-full break-all rounded px-1 py-0.5',
                    riskSet.has(i)
                      ? 'bg-amber-500/15 text-amber-600'
                      : 'bg-muted'
                  )}
                >
                  {w}
                </span>
              ))}
              {parsed.words.length > PREVIEW_LIMIT && (
                <span className='text-muted-foreground w-full'>
                  {t('Showing first {{shown}} of {{total}} keywords.', {
                    shown: PREVIEW_LIMIT,
                    total: parsed.words.length,
                  })}
                </span>
              )}
            </div>
            {riskCount > 0 && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={removeRisky}
              >
                {t('Remove {{count}} flagged words', { count: riskCount })}
              </Button>
            )}
          </div>
        )}

        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <span className='text-muted-foreground'>{t('Apply mode')}</span>
          <Button
            type='button'
            size='sm'
            variant={!replace ? 'default' : 'outline'}
            onClick={() => setReplace(false)}
          >
            {t('Append to existing ({{count}})', { count: existingCount })}
          </Button>
          <Button
            type='button'
            size='sm'
            variant={replace ? 'default' : 'outline'}
            onClick={() => setReplace(true)}
          >
            {t('Replace all')}
          </Button>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='button' disabled={!parsed} onClick={apply}>
            {t('Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
