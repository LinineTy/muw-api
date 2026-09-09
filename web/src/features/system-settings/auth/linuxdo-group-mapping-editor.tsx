// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getGroups } from '@/features/users/api'

const TRUST_LEVELS = ['0', '1', '2', '3', '4']

type MappingRow = {
  id: string
  level: string
  group: string
}

let rowSeq = 0
function newRowId(): string {
  rowSeq += 1
  return `ldm-${rowSeq}-${Date.now()}`
}

function parseMapping(raw: string): MappingRow[] {
  try {
    const obj = JSON.parse(raw || '{}') as Record<string, unknown>
    const rows: MappingRow[] = []
    for (const level of Object.keys(obj)) {
      const group = obj[level]
      if (typeof group === 'string' && group.trim() !== '') {
        rows.push({ id: newRowId(), level, group: group.trim() })
      }
    }
    return rows.sort((a, b) => a.level.localeCompare(b.level, 'en'))
  } catch {
    return []
  }
}

function serializeMapping(rows: MappingRow[]): string {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const level = row.level.trim()
    const group = row.group.trim()
    if (level !== '' && group !== '') {
      out[level] = group
    }
  }
  return JSON.stringify(out)
}

/**
 * Structured editor for the LinuxDO trust-level → group mapping. Edits rows in
 * a table instead of raw JSON; the value prop stays a JSON string so the
 * backend option format is unchanged.
 */
export function LinuxDOGroupMappingEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<MappingRow[]>(() => parseMapping(value))
  const lastCommittedRef = useRef(value)

  // Existing user groups, offered as dropdown options. Custom values are still
  // allowed so a mapping can target a group that does not exist yet.
  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  })
  const groupOptions = useMemo(
    () =>
      (groupsData?.data ?? []).map((group) => ({
        label: group,
        value: group,
      })),
    [groupsData]
  )

  // Re-sync from the prop only when the change did not originate from this
  // editor (e.g. the settings form reset after navigation).
  useEffect(() => {
    if (value === lastCommittedRef.current) return
    lastCommittedRef.current = value
    setRows(parseMapping(value))
  }, [value])

  const commit = (next: MappingRow[]) => {
    const json = serializeMapping(next)
    lastCommittedRef.current = json
    setRows(next)
    onChange(json)
  }

  const updateLevel = (id: string, level: string) => {
    // Moving a level onto a row that already maps that level removes the old
    // row so no duplicate keys are produced.
    const next = rows.filter((row) => row.id === id || row.level !== level)
    commit(next.map((row) => (row.id === id ? { ...row, level } : row)))
  }

  const updateGroup = (id: string, group: string) => {
    commit(rows.map((row) => (row.id === id ? { ...row, group } : row)))
  }

  const removeRow = (id: string) => {
    commit(rows.filter((row) => row.id !== id))
  }

  const addRow = () => {
    commit([...rows, { id: newRowId(), level: '', group: '' }])
  }

  const hasDuplicateLevels = useMemo(() => {
    const seen = new Set<string>()
    for (const row of rows) {
      const level = row.level.trim()
      if (level === '') continue
      if (seen.has(level)) return true
      seen.add(level)
    }
    return false
  }, [rows])

  return (
    <div className='space-y-2'>
      {rows.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          {t(
            'No mappings. Users without a mapped trust level fall back to the default group.'
          )}
        </p>
      )}
      <div className='space-y-2'>
        {rows.map((row) => (
          <div key={row.id} className='flex items-center gap-2'>
            <Select
              items={TRUST_LEVELS.map((level) => ({
                value: level,
                label: `L${level}`,
              }))}
              value={row.level}
              onValueChange={(level) =>
                level !== null && updateLevel(row.id, level)
              }
            >
              <SelectTrigger className='shrink-0'>
                <SelectValue placeholder={t('Level')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {TRUST_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      L{level}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Combobox
              className='flex-1'
              options={groupOptions}
              value={row.group}
              onValueChange={(group) => updateGroup(row.id, group ?? '')}
              allowCustomValue
              placeholder={t('Group name, e.g. vip')}
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
      {hasDuplicateLevels && (
        <p className='text-destructive text-xs'>
          {t('Duplicate trust levels: only the last group will be used.')}
        </p>
      )}
      <Button type='button' variant='outline' size='sm' onClick={addRow}>
        <Plus className='size-4' />
        {t('Add Mapping')}
      </Button>
    </div>
  )
}
