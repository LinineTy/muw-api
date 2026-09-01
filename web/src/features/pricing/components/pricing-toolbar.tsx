/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  ArrowUpDown,
  Check,
  Filter,
  Grid2X2,
  Search,
  Table2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { getSortLabels, VIEW_MODES, type SortOption, type ViewMode } from '../constants'
import type { PricingModel, PricingVendor, TokenUnit } from '../types'
import { PricingSidebar } from './pricing-sidebar'

type SegmentOption = { value: string; label: string; icon?: LucideIcon }

export interface PricingToolbarProps {
  searchInput: string
  onSearchChange: (value: string) => void
  sortBy: string
  onSortChange: (value: string) => void
  viewMode: ViewMode
  onViewModeChange: (value: ViewMode) => void
  tokenUnit: TokenUnit
  onTokenUnitChange: (value: TokenUnit) => void
  showRechargePrice: boolean
  onRechargePriceChange: (value: boolean) => void
  quotaTypeFilter: string
  endpointTypeFilter: string
  vendorFilter: string
  groupFilter: string
  tagFilter: string
  onQuotaTypeChange: (value: string) => void
  onEndpointTypeChange: (value: string) => void
  onVendorChange: (value: string) => void
  onGroupChange: (value: string) => void
  onTagChange: (value: string) => void
  vendors: PricingVendor[]
  groups: string[]
  groupRatios?: Record<string, number>
  tags: string[]
  models: PricingModel[]
  hasActiveFilters: boolean
  activeFilterCount: number
  onClearFilters: () => void
}

function SegmentedControl(props: {
  options: SegmentOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}) {
  return (
    <div
      role='group'
      aria-label={props.ariaLabel}
      className='bg-muted/60 inline-flex h-8 items-center rounded-lg border p-0.5'
    >
      {props.options.map((option) => {
        const isActive = option.value === props.value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type='button'
            onClick={() => props.onChange(option.value)}
            aria-pressed={isActive}
            title={option.label}
            className={cn(
              'inline-flex h-full items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all',
              Icon && 'px-2.5',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon className='size-3.5' />}
            {!Icon && option.label}
          </button>
        )
      })}
    </div>
  )
}

export function PricingToolbar(props: PricingToolbarProps) {
  const { t } = useTranslation()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const sortLabels = getSortLabels(t)

  const handleTokenUnitChange = useCallback(
    (value: string) => props.onTokenUnitChange(value as TokenUnit),
    [props]
  )

  const handleRechargePriceChange = useCallback(
    (value: string) => props.onRechargePriceChange(value === 'recharge'),
    [props]
  )

  const handleViewModeChange = useCallback(
    (value: string) => props.onViewModeChange(value as ViewMode),
    [props]
  )

  return (
    <div className='flex flex-col gap-2.5 pb-1 sm:flex-row sm:items-center'>
      {/* Search */}
      <div className='relative min-w-0 flex-1 sm:max-w-md'>
        <Search className='text-muted-foreground/60 pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2' />
        <input
          type='search'
          value={props.searchInput}
          onChange={(e) => props.onSearchChange(e.target.value)}
          placeholder={t(
            'Search model name, provider, endpoint, or tag...'
          )}
          aria-label={t('Search models')}
          className='focus-visible:ring-ring/40 h-9 w-full rounded-full border bg-transparent pr-9 pl-10 text-sm outline-none transition-shadow focus-visible:ring-2'
        />
        {props.searchInput && (
          <button
            type='button'
            onClick={() => props.onSearchChange('')}
            aria-label={t('Clear search')}
            className='text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2'
          >
            <X className='size-4' />
          </button>
        )}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => setFiltersOpen(true)}
          className='h-8 gap-1.5 px-3 text-xs'
        >
          <Filter className='size-3.5' />
          {t('Filter')}
          {props.activeFilterCount > 0 && (
            <Badge className='ml-0.5 size-5 justify-center p-0 text-[10px]'>
              {props.activeFilterCount}
            </Badge>
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-8 gap-1.5 px-3 text-xs'
              />
            }
          >
            <ArrowUpDown className='size-3.5' />
            <span>{sortLabels[props.sortBy as SortOption] || t('Sort')}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-44'>
            {Object.entries(sortLabels).map(([value, label]) => (
              <DropdownMenuItem
                key={value}
                onClick={() => props.onSortChange(value)}
                className='gap-2'
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    props.sortBy === value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <SegmentedControl
          options={[
            { value: VIEW_MODES.CARD, label: t('Card view'), icon: Grid2X2 },
            { value: VIEW_MODES.TABLE, label: t('Table view'), icon: Table2 },
          ]}
          value={props.viewMode}
          onChange={handleViewModeChange}
          ariaLabel={t('View mode')}
        />

        <div className='ml-auto flex items-center gap-2 sm:ml-0'>
          <SegmentedControl
            options={[
              { value: 'standard', label: t('Standard') },
              { value: 'recharge', label: t('Recharge') },
            ]}
            value={props.showRechargePrice ? 'recharge' : 'standard'}
            onChange={handleRechargePriceChange}
            ariaLabel={t('Price display mode')}
          />
          <SegmentedControl
            options={[
              { value: 'M', label: '/1M' },
              { value: 'K', label: '/1K' },
            ]}
            value={props.tokenUnit}
            onChange={handleTokenUnitChange}
            ariaLabel={t('Token unit')}
          />
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side='right'
          className={sideDrawerContentClassName('sm:max-w-md')}
        >
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>{t('Filter')}</SheetTitle>
            <SheetDescription>
              {t('Filter models by provider, group, type, endpoint, and tags.')}
            </SheetDescription>
          </SheetHeader>
          <div className={sideDrawerFormClassName('gap-0')}>
            <PricingSidebar
              quotaTypeFilter={props.quotaTypeFilter}
              endpointTypeFilter={props.endpointTypeFilter}
              vendorFilter={props.vendorFilter}
              groupFilter={props.groupFilter}
              tagFilter={props.tagFilter}
              onQuotaTypeChange={props.onQuotaTypeChange}
              onEndpointTypeChange={props.onEndpointTypeChange}
              onVendorChange={props.onVendorChange}
              onGroupChange={props.onGroupChange}
              onTagChange={props.onTagChange}
              vendors={props.vendors}
              groups={props.groups}
              groupRatios={props.groupRatios}
              tags={props.tags}
              models={props.models}
              hasActiveFilters={props.hasActiveFilters}
              onClearFilters={props.onClearFilters}
              className='border-0 bg-transparent p-0 shadow-none'
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
