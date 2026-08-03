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
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

import { getModelHealth } from './api'
import { ModelHealthCard } from './components/model-health-card'
import type { ModelHealthRow } from './types'

const DAY_OPTIONS = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
]

export function ModelHealth() {
  const { t } = useTranslation()
  const [days, setDays] = useState(7)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [unhealthyOnly, setUnhealthyOnly] = useState(false)

  const healthQuery = useQuery({
    queryKey: ['model-health', days, appliedQuery, unhealthyOnly],
    queryFn: () =>
      getModelHealth({
        days,
        q: appliedQuery || undefined,
        unhealthy: unhealthyOnly || undefined,
      }),
    retry: false,
  })

  const rows = healthQuery.data?.data ?? []

  // Group rows by model, preserving first-seen order, then sort by name.
  const groups = new Map<string, ModelHealthRow[]>()
  for (const row of rows) {
    const list = groups.get(row.model_name)
    if (list) list.push(row)
    else groups.set(row.model_name, [row])
  }
  const modelNames = [...groups.keys()].sort((a, b) => a.localeCompare(b))

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setAppliedQuery(query.trim())
  }

  let content: ReactNode
  if (healthQuery.isLoading) {
    content = (
      <div className='space-y-3'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
      </div>
    )
  } else if (modelNames.length === 0) {
    content = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('No health data yet')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'Enable scheduled channel tests or run a manual test to start collecting health data.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    content = (
      <div className='space-y-3'>
        {modelNames.map((name) => (
          <ModelHealthCard
            key={name}
            modelName={name}
            rows={groups.get(name) ?? []}
          />
        ))}
      </div>
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        <span className='truncate'>{t('Model Health')}</span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex flex-wrap items-center gap-2'>
          <form onSubmit={handleSearch} className='relative'>
            <Search className='text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search model or channel')}
              className='h-9 w-52 pl-8'
            />
          </form>
          <Select
            value={days}
            onValueChange={(value) => setDays(Number(value))}
            items={DAY_OPTIONS}
          >
            <SelectTrigger className='h-9 w-20'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {DAY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <label className='flex h-9 cursor-pointer items-center gap-2 text-sm'>
            <Switch
              checked={unhealthyOnly}
              onCheckedChange={setUnhealthyOnly}
            />
            {t('Only unhealthy')}
          </label>
          <button
            type='button'
            onClick={() => healthQuery.refetch()}
            className='text-muted-foreground hover:text-foreground p-1'
            title={t('Refresh')}
            aria-label={t('Refresh')}
          >
            <RefreshCw className='size-4' />
          </button>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='h-full overflow-y-auto px-2 py-2'>{content}</div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
