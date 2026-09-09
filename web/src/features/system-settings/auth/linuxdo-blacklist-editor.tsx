// @muw-owned
import { ListFilter, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ENTRY_TYPES = ['id', 'username', 'both'] as const
type EntryType = (typeof ENTRY_TYPES)[number]

// Cap how many entry badges are rendered inline so a long blacklist cannot
// stretch the settings page. The rest are folded behind a +N button that opens
// the management dialog.
const MAX_VISIBLE_BADGES = 8

type BlacklistRow = {
  id: string
  type: EntryType
  value: string
}

let rowSeq = 0
function newRowId(): string {
  rowSeq += 1
  return `ldb-${rowSeq}-${Date.now()}`
}

type RawEntry = { type?: string; value?: string }

/**
 * Parses the stored option into editable rows. The current format is a JSON
 * array of {type, value} entries; the legacy format is newline/comma separated
 * text where every entry matched either the id or the username. Legacy entries
 * keep type "both" so existing configurations stay intact until edited.
 */
function parseBlacklist(raw: string): BlacklistRow[] {
  const source = (raw ?? '').trim()
  if (source === '') return []

  let entries: RawEntry[] | null = null
  try {
    const parsed = JSON.parse(source)
    if (Array.isArray(parsed)) entries = parsed as RawEntry[]
  } catch {
    entries = null
  }

  if (entries === null) {
    return source
      .split(/[,\n\r]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => ({ id: newRowId(), type: 'both' as const, value: entry }))
  }

  const rows: BlacklistRow[] = []
  for (const entry of entries) {
    const value = (entry?.value ?? '').trim()
    if (value === '') continue
    const type =
      entry?.type === 'id' || entry?.type === 'username' ? entry.type : 'both'
    rows.push({ id: newRowId(), type, value })
  }
  return rows
}

function serializeBlacklist(rows: BlacklistRow[]): string {
  const entries = rows
    .filter((row) => row.value.trim() !== '')
    .map((row) => ({ type: row.type, value: row.value.trim() }))
  return JSON.stringify(entries)
}

function typeLabel(t: ReturnType<typeof useTranslation>['t'], type: EntryType) {
  if (type === 'id') return t('ID')
  if (type === 'username') return t('Username')
  return t('Both')
}

/**
 * Structured editor for the LinuxDO blacklist. Entries are rendered as compact
 * badges; editing happens inside a dialog so a long list does not stretch the
 * settings page. Each entry carries an explicit match type (id / username) so a
 * numeric id and an identically spelled username are never conflated. The value
 * prop stays a JSON string so the backend option format is unchanged.
 */
export function LinuxDOBlacklistEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const entries = useMemo(() => parseBlacklist(value), [value])
  const [open, setOpen] = useState(false)

  const visibleEntries = entries.slice(0, MAX_VISIBLE_BADGES)
  const hiddenCount = entries.length - visibleEntries.length

  const handleSave = (json: string) => {
    onChange(json)
    setOpen(false)
  }

  return (
    <div className='space-y-2'>
      {entries.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          {t('No blacklist entries. Add a LinuxDO id or username to block.')}
        </p>
      ) : (
        <div className='flex flex-wrap items-center gap-1.5'>
          {visibleEntries.map((entry) => (
            <Badge
              key={entry.id}
              variant={entry.type === 'id' ? 'secondary' : 'outline'}
            >
              {entry.type === 'id' ? `#${entry.value}` : entry.value}
            </Badge>
          ))}
          {hiddenCount > 0 && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='h-5 rounded-full px-2 text-xs'
              title={t('Manage Blacklist')}
              onClick={() => setOpen(true)}
            >
              +{hiddenCount}
            </Button>
          )}
        </div>
      )}
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => setOpen(true)}
      >
        <ListFilter className='size-4' />
        {t('Manage Blacklist')}
      </Button>
      {open && (
        <BlacklistRowsDialog
          initialValue={value}
          onSave={handleSave}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function BlacklistRowsDialog({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue: string
  onSave: (json: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<BlacklistRow[]>(() =>
    parseBlacklist(initialValue)
  )

  const updateType = (id: string, type: EntryType) => {
    setRows(rows.map((row) => (row.id === id ? { ...row, type } : row)))
  }

  const updateValue = (id: string, value: string) => {
    setRows(rows.map((row) => (row.id === id ? { ...row, value } : row)))
  }

  const removeRow = (id: string) => {
    setRows(rows.filter((row) => row.id !== id))
  }

  const addRow = () => {
    setRows([...rows, { id: newRowId(), type: 'username', value: '' }])
  }

  const valuePlaceholder = (type: EntryType) => {
    if (type === 'id') return t('LinuxDO ID, e.g. 12345')
    if (type === 'username') return t('Username, e.g. some-user')
    return t('ID or username')
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('Edit LinuxDO Blacklist')}</DialogTitle>
        </DialogHeader>
        <div className='max-h-[45vh] space-y-2 overflow-y-auto pr-1'>
          {rows.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {t('No blacklist entries. Add a LinuxDO id or username to block.')}
            </p>
          )}
          {rows.map((row) => (
            <div key={row.id} className='flex items-center gap-2'>
              <Select
                items={ENTRY_TYPES.map((type) => ({
                  value: type,
                  label: typeLabel(t, type),
                }))}
                value={row.type}
                onValueChange={(type) =>
                  type !== null && updateType(row.id, type)
                }
              >
                <SelectTrigger className='shrink-0'>
                  <SelectValue placeholder={t('Type')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {ENTRY_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {typeLabel(t, type)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Input
                className='flex-1'
                placeholder={valuePlaceholder(row.type)}
                value={row.value}
                onChange={(event) => updateValue(row.id, event.target.value)}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-9 shrink-0 text-muted-foreground'
                onClick={() => removeRow(row.id)}
                aria-label={t('Delete')}
              >
                <Trash2 className='size-4' />
              </Button>
            </div>
          ))}
        </div>
        <Button type='button' variant='outline' size='sm' onClick={addRow}>
          <Plus className='size-4' />
          {t('Add Entry')}
        </Button>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={() => onSave(serializeBlacklist(rows))}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
