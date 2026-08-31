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
import { useCallback, useMemo, useState } from 'react'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'

import { EmptyState, LoadingSkeleton, ModelDetailsDrawer, PricingToolbar } from './components'
import { EXCLUDED_GROUPS } from './constants'
import { PricingHero } from './components/pricing-hero'
import { GroupTree } from './components/group-tree'
import { useFilters } from './hooks/use-filters'
import { usePricingData } from './hooks/use-pricing-data'

export function Pricing() {
  const [selectedModelName, setSelectedModelName] = useState<string | null>(
    null
  )

  const {
    models,
    vendors,
    groupRatio,
    usableGroup,
    endpointMap,
    autoGroups,
    isLoading,
    priceRate,
    usdExchangeRate,
  } = usePricingData()

  const {
    searchInput,
    sortBy,
    vendorFilter,
    groupFilter,
    quotaTypeFilter,
    endpointTypeFilter,
    tagFilter,
    tokenUnit,
    showRechargePrice,
    setSearchInput,
    setSortBy,
    setVendorFilter,
    setGroupFilter,
    setQuotaTypeFilter,
    setEndpointTypeFilter,
    setTagFilter,
    setTokenUnit,
    setShowRechargePrice,
    filteredModels,
    hasActiveFilters,
    activeFilterCount,
    availableTags,
    clearFilters,
    clearSearch,
  } = useFilters(models || [])

  const handleModelClick = useCallback((modelName: string) => {
    setSelectedModelName(modelName)
  }, [])

  const selectedModel = useMemo(
    () =>
      selectedModelName
        ? (models || []).find(
            (model) => model.model_name === selectedModelName
          ) || null
        : null,
    [models, selectedModelName]
  )

  const availableGroups = useMemo(
    () =>
      Object.keys(usableGroup || {}).filter(
        (g) => !EXCLUDED_GROUPS.includes(g)
      ),
    [usableGroup]
  )

  const handleClearAll = useCallback(() => {
    clearFilters()
    clearSearch()
  }, [clearFilters, clearSearch])

  if (isLoading) {
    return (
      <PublicLayout showMainContainer={false}>
        <div className='mx-auto w-full max-w-[1200px] px-4 pt-16 pb-8 sm:px-6 sm:pt-20 sm:pb-10'>
          <LoadingSkeleton />
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto w-full max-w-[1200px] px-4 pt-16 pb-8 sm:px-6 sm:pt-20 sm:pb-10'>
        <PricingHero
          modelCount={models?.length || 0}
          vendorCount={vendors?.length || 0}
          groups={groupRatio || {}}
        />

        <PricingToolbar
          searchInput={searchInput}
          onSearchChange={setSearchInput}
          sortBy={sortBy}
          onSortChange={setSortBy}
          tokenUnit={tokenUnit}
          onTokenUnitChange={setTokenUnit}
          showRechargePrice={showRechargePrice}
          onRechargePriceChange={setShowRechargePrice}
          quotaTypeFilter={quotaTypeFilter}
          endpointTypeFilter={endpointTypeFilter}
          vendorFilter={vendorFilter}
          groupFilter={groupFilter}
          tagFilter={tagFilter}
          onQuotaTypeChange={setQuotaTypeFilter}
          onEndpointTypeChange={setEndpointTypeFilter}
          onVendorChange={setVendorFilter}
          onGroupChange={setGroupFilter}
          onTagChange={setTagFilter}
          vendors={vendors || []}
          groups={availableGroups}
          groupRatios={groupRatio}
          tags={availableTags}
          models={models || []}
          hasActiveFilters={hasActiveFilters}
          activeFilterCount={activeFilterCount}
          onClearFilters={clearFilters}
        />

        <main className='mt-6'>
          {filteredModels.length === 0 ? (
            <EmptyState
              searchQuery={searchInput}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={handleClearAll}
            />
          ) : (
            <GroupTree
              models={filteredModels}
              autoGroups={autoGroups || []}
              groupRatio={groupRatio || {}}
              usableGroup={usableGroup || {}}
              onModelClick={handleModelClick}
              tokenUnit={tokenUnit}
              showRechargePrice={showRechargePrice}
              priceRate={priceRate}
              usdExchangeRate={usdExchangeRate}
            />
          )}
        </main>

        {selectedModel && (
          <ModelDetailsDrawer
            open={Boolean(selectedModel)}
            onOpenChange={(open) => {
              if (!open) setSelectedModelName(null)
            }}
            model={selectedModel}
            groupRatio={groupRatio || {}}
            usableGroup={usableGroup || {}}
            endpointMap={
              (endpointMap as Record<string, { path?: string; method?: string }>) ||
              {}
            }
            autoGroups={autoGroups || []}
            priceRate={priceRate ?? 1}
            usdExchangeRate={usdExchangeRate ?? 1}
            tokenUnit={tokenUnit}
            showRechargePrice={showRechargePrice}
          />
        )}
      </PageTransition>
    </PublicLayout>
  )
}
