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
import { type Column } from '@tanstack/react-table'
import { Check as CheckIcon, PlusCircle as PlusCircledIcon } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type DataTableFacetedFilterProps<TData, TValue> = {
  column?: Column<TData, TValue>
  title?: string
  options: {
    label: string
    value: string
    icon?: React.ComponentType<{ className?: string }>
    iconNode?: React.ReactNode
    count?: number
  }[]
  /** Enable single select mode (only one option can be selected at a time) */
  singleSelect?: boolean
}

function DataTableFacetedFilterInner<TData, TValue>({
  column,
  title,
  options,
  singleSelect = false,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const { t } = useTranslation()
  const facets = column?.getFacetedUniqueValues()
  const filterValue = column?.getFilterValue() as string[] | undefined
  const selectedValues = new Set(filterValue)

  const handleOptionSelect = (optionValue: string) => {
    const nextSelectedValues = getNextSelectedValues(
      selectedValues,
      optionValue,
      singleSelect
    )

    column?.setFilterValue(
      nextSelectedValues.length ? nextSelectedValues : undefined
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant='outline' size='sm' className='h-8 border-dashed' />
        }
      >
        <PlusCircledIcon className='size-4' />
        {title}
        {selectedValues?.size > 0 && (
          <>
            <Separator orientation='vertical' className='mx-2 h-4' />
            <Badge
              variant='secondary'
              className='rounded-sm px-1 font-normal lg:hidden'
            >
              {selectedValues.size}
            </Badge>
            <div className='hidden space-x-1 lg:flex'>
              {selectedValues.size > 2 ? (
                <Badge
                  variant='secondary'
                  className='rounded-sm px-1 font-normal'
                >
                  {selectedValues.size} {t('selected')}
                </Badge>
              ) : (
                options
                  .filter((option) => selectedValues.has(option.value))
                  .map((option) => (
                    <Badge
                      variant='secondary'
                      key={option.value}
                      className='rounded-sm px-1 font-normal'
                    >
                      {t(option.label)}
                    </Badge>
                  ))
              )}
            </div>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className='max-w-[360px] min-w-[200px] p-0' align='start'>
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>{t('No results found.')}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedValues.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => handleOptionSelect(option.value)}
                  >
                    <div
                      className={cn(
                        'border-primary flex size-4 items-center justify-center rounded-sm border',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible'
                      )}
                    >
                      <CheckIcon className={cn('text-background h-4 w-4')} />
                    </div>
                    {option.iconNode ? (
                      <span className='text-muted-foreground flex size-4 items-center justify-center'>
                        {option.iconNode}
                      </span>
                    ) : option.icon ? (
                      <option.icon className='text-muted-foreground size-4' />
                    ) : null}
                    <span
                      className='min-w-0 flex-1 truncate'
                      title={t(option.label)}
                    >
                      {t(option.label)}
                    </span>
                    {typeof option.count === 'number' ? (
                      <span className='text-muted-foreground ms-auto flex h-4 min-w-4 items-center justify-center font-mono text-xs'>
                        {option.count}
                      </span>
                    ) : facets?.get(option.value) ? (
                      <span className='ms-auto flex h-4 w-4 items-center justify-center font-mono text-xs'>
                        {facets.get(option.value)}
                      </span>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selectedValues.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => column?.setFilterValue(undefined)}
                    className='justify-center text-center'
                  >
                    {t('Clear filters')}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// React.memo 浅比较 props 会漏掉受控 column 的 filterValue 变化：column/options 引用
// 不变（如模块级常量 options）时，勾选后 columnFilters 更新但本组件不重渲染，
// 勾选状态停留在旧值。自定义比较纳入 filterValue，filter 值变化即重渲染。
export const DataTableFacetedFilter = React.memo(
  DataTableFacetedFilterInner,
  (prevProps, nextProps) =>
    prevProps.column === nextProps.column &&
    prevProps.title === nextProps.title &&
    prevProps.options === nextProps.options &&
    prevProps.singleSelect === nextProps.singleSelect &&
    prevProps.column?.getFilterValue() === nextProps.column?.getFilterValue()
) as typeof DataTableFacetedFilterInner

function getNextSelectedValues(
  selectedValues: Set<string>,
  optionValue: string,
  singleSelect: boolean
): string[] {
  if (singleSelect) {
    return selectedValues.has(optionValue) ? [] : [optionValue]
  }

  const nextSelectedValues = new Set(selectedValues)
  if (nextSelectedValues.has(optionValue)) {
    nextSelectedValues.delete(optionValue)
  } else {
    nextSelectedValues.add(optionValue)
  }

  return Array.from(nextSelectedValues)
}
