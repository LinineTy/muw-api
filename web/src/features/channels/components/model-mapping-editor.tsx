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
import { Code, Loader2, Plus, Search, Table, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { JsonCodeEditor } from '@/components/json-code-editor'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ModelMappingEditorProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  // Returns the models available from the upstream channel (fetched on demand)
  // for the model picker. When omitted, the picker button is hidden.
  fetchChannelModels?: () => Promise<string[]>
}

type PickerTarget = {
  rowId: string
  field: 'from' | 'to'
}

type MappingRow = {
  id: string
  from: string
  to: string
}

const DUPLICATE_MAPPING_SENTINEL = '{ "duplicate_source_models": '

function getDuplicateSources(rows: MappingRow[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const row of rows) {
    const source = row.from.trim()
    if (!source) continue
    if (seen.has(source)) {
      duplicates.add(source)
    } else {
      seen.add(source)
    }
  }

  return Array.from(duplicates)
}

export function ModelMappingEditor(props: ModelMappingEditorProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const [rows, setRows] = useState<MappingRow[]>([])
  const [jsonValue, setJsonValue] = useState(props.value)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const nextRowIdRef = useRef(0)
  // Tracks the last value this editor emitted via onChange. External edits to
  // the field (e.g. loading a channel) change props.value to something else;
  // values we emitted ourselves should not be re-parsed back into `rows`,
  // otherwise a row whose "from" was cleared (which serializes to `{}`) is
  // dropped and the whole rule disappears.
  const lastEmittedRef = useRef<string | null>(null)
  const duplicateSources = useMemo(() => getDuplicateSources(rows), [rows])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerModels, setPickerModels] = useState<string[]>([])
  const [pickerKeyword, setPickerKeyword] = useState('')
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)

  const filteredPickerModels = useMemo(() => {
    const keyword = pickerKeyword.trim().toLowerCase()
    if (!keyword) return pickerModels
    return pickerModels.filter((model) =>
      model.toLowerCase().includes(keyword)
    )
  }, [pickerModels, pickerKeyword])

  const createRowId = () => {
    nextRowIdRef.current += 1
    return `mapping-${nextRowIdRef.current}`
  }

  const parseJsonToRows = (json: string): boolean => {
    try {
      if (!json.trim()) {
        setRows([])
        setJsonError(null)
        return true
      }
      const parsed = JSON.parse(json)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError(t('Model mapping must be a valid JSON object'))
        return false
      }
      const entries = Object.entries(parsed)
      const invalidValue = entries.find(([, to]) => typeof to !== 'string')
      if (invalidValue) {
        setJsonError(t('Model mapping values must be strings'))
        return false
      }
      setRows((previousRows) => {
        const remainingRows = [...previousRows]
        return entries.map(([from, to], index) => {
          const toString = String(to)
          const existingIndex = remainingRows.findIndex(
            (row) =>
              row.from === from ||
              (row.from === from && row.to === toString) ||
              previousRows[index]?.id === row.id
          )
          if (existingIndex >= 0) {
            const [existing] = remainingRows.splice(existingIndex, 1)
            return {
              id: existing.id,
              from,
              to: toString,
            }
          }
          return {
            id: createRowId(),
            from,
            to: toString,
          }
        })
      })
      setJsonError(null)
      return true
    } catch (_error) {
      setJsonError(t('Model mapping must be valid JSON format'))
      return false
    }
  }

  // Parse JSON to rows when value changes externally
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJsonValue(props.value)
    if (props.value === lastEmittedRef.current) {
      return
    }
    parseJsonToRows(props.value)
  }, [props.value])

  const convertRowsToJson = (updatedRows: MappingRow[]): string => {
    if (updatedRows.length === 0) {
      return ''
    }
    const obj: Record<string, string> = {}
    updatedRows.forEach((row) => {
      if (row.from.trim()) {
        obj[row.from.trim()] = row.to.trim()
      }
    })
    return JSON.stringify(obj, null, 2)
  }

  const syncRows = (updatedRows: MappingRow[]) => {
    setRows(updatedRows)
    const duplicates = getDuplicateSources(updatedRows)
    if (duplicates.length > 0) {
      setJsonError(t('Duplicate source model mappings are not allowed'))
      setJsonValue(DUPLICATE_MAPPING_SENTINEL)
      lastEmittedRef.current = DUPLICATE_MAPPING_SENTINEL
      props.onChange(DUPLICATE_MAPPING_SENTINEL)
      return
    }

    const json = convertRowsToJson(updatedRows)
    setJsonError(null)
    setJsonValue(json)
    lastEmittedRef.current = json
    props.onChange(json)
  }

  const handleAddRow = () => {
    const newRow: MappingRow = {
      id: createRowId(),
      from: '',
      to: '',
    }
    syncRows([...rows, newRow])
  }

  const handleDeleteRow = (id: string) => {
    syncRows(rows.filter((row) => row.id !== id))
  }

  const handleRowChange = (
    id: string,
    field: 'from' | 'to',
    newValue: string
  ) => {
    const updatedRows = rows.map((row) =>
      row.id === id ? { ...row, [field]: newValue } : row
    )
    syncRows(updatedRows)
  }

  const handleJsonChange = (newJson: string) => {
    setJsonValue(newJson)
    lastEmittedRef.current = newJson
    props.onChange(newJson)
    parseJsonToRows(newJson)
  }

  const handleFillTemplate = () => {
    const template = JSON.stringify(
      { 'gpt-3.5-turbo': 'gpt-3.5-turbo-0125' },
      null,
      2
    )
    setJsonValue(template)
    lastEmittedRef.current = template
    props.onChange(template)
    parseJsonToRows(template)
  }

  const handleModeChange = (nextMode: string) => {
    if (nextMode !== 'visual' && nextMode !== 'json') return
    if (nextMode === 'json') {
      const duplicates = getDuplicateSources(rows)
      if (duplicates.length === 0) {
        const json = convertRowsToJson(rows)
        setJsonValue(json)
        lastEmittedRef.current = json
        props.onChange(json)
      }
      setMode('json')
      return
    }
    parseJsonToRows(jsonValue)
    setMode('visual')
  }

  const closePicker = () => {
    setPickerOpen(false)
    setPickerTarget(null)
    setPickerKeyword('')
    setPickerModels([])
  }

  const openPicker = async (rowId: string, field: 'from' | 'to') => {
    if (!props.fetchChannelModels) return
    setPickerTarget({ rowId, field })
    setPickerKeyword('')
    setPickerModels([])
    setPickerOpen(true)
    setPickerLoading(true)
    try {
      const models = await props.fetchChannelModels()
      setPickerModels(Array.isArray(models) ? models : [])
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to fetch models')
      )
      setPickerModels([])
    } finally {
      setPickerLoading(false)
    }
  }

  const pickModel = (model: string) => {
    if (!pickerTarget) return
    handleRowChange(pickerTarget.rowId, pickerTarget.field, model)
    closePicker()
  }

  return (
    <div className='space-y-2'>
      <Tabs value={mode} onValueChange={handleModeChange} className='space-y-2'>
        <div className='flex items-center justify-between gap-3'>
          <TabsList>
            <TabsTrigger value='visual'>
              <Table className='h-4 w-4' aria-hidden='true' />
              {t('Visual')}
            </TabsTrigger>
            <TabsTrigger value='json'>
              <Code className='h-4 w-4' aria-hidden='true' />
              {t('JSON')}
            </TabsTrigger>
          </TabsList>
          <Button
            type='button'
            variant='link'
            size='sm'
            className='h-auto p-0'
            onClick={handleFillTemplate}
            disabled={props.disabled}
          >
            {t('Fill Template')}
          </Button>
        </div>

        {jsonError && (
          <Alert variant='destructive'>
            <AlertDescription>{jsonError}</AlertDescription>
          </Alert>
        )}

        {duplicateSources.length > 0 && (
          <Alert>
            <AlertDescription>
              {t('Duplicate source model(s): {{models}}', {
                models: duplicateSources.join(', '),
              })}
            </AlertDescription>
          </Alert>
        )}

        <TabsContent value='visual' className='space-y-2'>
          {rows.length > 0 ? (
            <div className='space-y-2'>
              <div className='grid grid-cols-[1fr_1fr_auto] gap-2 text-sm font-medium'>
                <div>{t('Request Model')}</div>
                <div>{t('Upstream Model')}</div>
                <div className='w-10'></div>
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className='grid grid-cols-[1fr_1fr_auto] items-center gap-2'
                >
                  <Input
                    value={row.from}
                    onChange={(e) =>
                      handleRowChange(row.id, 'from', e.target.value)
                    }
                    placeholder='gpt-3.5-turbo'
                    disabled={props.disabled}
                  />
                  <div className='relative'>
                    <Input
                      value={row.to}
                      onChange={(e) =>
                        handleRowChange(row.id, 'to', e.target.value)
                      }
                      placeholder='gpt-3.5-turbo-0125'
                      disabled={props.disabled}
                      className={props.fetchChannelModels ? 'pr-9' : undefined}
                    />
                    {props.fetchChannelModels && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-xs'
                        onClick={() => openPicker(row.id, 'to')}
                        disabled={props.disabled}
                        aria-label={t('Select Model')}
                        className='text-muted-foreground absolute right-1 inset-y-0 my-auto'
                      >
                        <Search className='size-3.5' aria-hidden='true' />
                      </Button>
                    )}
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => handleDeleteRow(row.id)}
                    disabled={props.disabled}
                    className='h-10 w-10'
                    aria-label={t('Delete mapping')}
                  >
                    <Trash2 className='h-4 w-4' aria-hidden='true' />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className='text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm'>
              {t(
                'No model mappings configured. Click "Add Mapping" to get started.'
              )}
            </div>
          )}
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={handleAddRow}
            disabled={props.disabled}
            className='w-full'
          >
            <Plus className='mr-2 h-4 w-4' />
            {t('Add Mapping')}
          </Button>
        </TabsContent>
        <TabsContent value='json' className='space-y-2'>
          {/* 与上游同款提示（文案 key 7 语言已齐），补回合并时丢的说明行 */}
          <p className='text-muted-foreground text-sm'>
            {t(
              'JSON keys are request model names; values are upstream model names.'
            )}
          </p>
          <JsonCodeEditor
            value={jsonValue}
            onChange={handleJsonChange}
            placeholder={t('{"original-model": "replacement-model"}')}
            disabled={props.disabled}
            className={jsonError ? 'border-destructive' : undefined}
            aria-invalid={Boolean(jsonError)}
            ariaLabel={t('Model Mapping')}
          />
        </TabsContent>
      </Tabs>

      <Dialog
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!open) closePicker()
        }}
        title={t('Select Model')}
        description={t('Choose a model available from the channel')}
        contentClassName='sm:max-w-md'
        contentHeight='auto'
        bodyClassName='space-y-3'
        footer={
          <Button type='button' variant='outline' onClick={closePicker}>
            {t('Cancel')}
          </Button>
        }
      >
        <Input
          value={pickerKeyword}
          onChange={(e) => setPickerKeyword(e.target.value)}
          placeholder={t('Search models...')}
        />
        {pickerLoading && (
          <div className='flex items-center justify-center py-10'>
            <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
          </div>
        )}
        {!pickerLoading && pickerModels.length === 0 && (
          <div className='text-muted-foreground py-8 text-center text-sm'>
            {t('No models available')}
          </div>
        )}
        {!pickerLoading && pickerModels.length > 0 && (
          <div className='max-h-72 space-y-1 overflow-y-auto pr-1'>
            {filteredPickerModels.map((model) => (
              <Button
                key={model}
                type='button'
                variant='ghost'
                size='sm'
                className='w-full justify-start font-mono'
                onClick={() => pickModel(model)}
              >
                {model}
              </Button>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  )
}
