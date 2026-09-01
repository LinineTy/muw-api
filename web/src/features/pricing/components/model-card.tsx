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
import { memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
} from '../lib/dynamic-price'
import { parseTags } from '../lib/filters'
import { isTokenBasedModel } from '../lib/model-helpers'
import { formatFixedPrice, formatGroupPrice } from '../lib/price'
import type { PricingModel, TokenUnit } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'

export interface ModelCardProps {
  model: PricingModel
  /** Group this card is rendered under — prices reflect this group's ratio. */
  group?: string
  /** Active group filter — falls back to the model's best group price. */
  selectedGroup?: string
  onClick: () => void
  tokenUnit?: TokenUnit
  showRechargePrice?: boolean
  priceRate?: number
  usdExchangeRate?: number
}

/**
 * Three-layer model card for the grouped pricing tree:
 * 1. vendor icon + full model name (wraps, never truncates)
 * 2. one-line effective price for the current group
 * 3. billing badge + capability tags + non-default endpoints
 *
 * The whole card is clickable and opens the details drawer.
 */
export const ModelCard = memo(function ModelCard(props: ModelCardProps) {
  const { t } = useTranslation()
  const tokenUnit = props.tokenUnit ?? ('M' as TokenUnit)
  const priceRate = props.priceRate ?? 1
  const usdExchangeRate = props.usdExchangeRate ?? 1
  const showRechargePrice = props.showRechargePrice ?? false
  const model = props.model
  const group = props.group
  const selectedGroup = props.selectedGroup
  // Flat grid mode: explicit group > active group filter > the model's best (lowest-ratio) group.
  const effectiveGroup =
    group ??
    (selectedGroup &&
    (model.enable_groups || []).includes(selectedGroup)
      ? selectedGroup
      : (model.enable_groups || [])
          .filter((g) => typeof model.group_ratio?.[g] === 'number')
          .sort((a, b) => model.group_ratio[a] - model.group_ratio[b])[0]) ??
    ''
  const isTokenBased = isTokenBasedModel(model)
  const isDynamicPricing =
    model.billing_mode === 'tiered_expr' && Boolean(model.billing_expr)

  const modelIconKey = model.icon || model.vendor_icon
  const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 16) : null
  const initial = model.model_name?.charAt(0).toUpperCase() || '?'

  const tags = parseTags(model.tags)
  const endpoints = (model.supported_endpoint_types || []).filter(
    (e) => e !== 'openai'
  )
  const bottomItems = [...tags.slice(0, 3), ...endpoints.slice(0, 2)]
  const hiddenCount =
    Math.max(tags.length - 3, 0) + Math.max(endpoints.length - 2, 0)

  const priceOptions = {
    tokenUnit,
    showRechargePrice,
    priceRate,
    usdExchangeRate,
  } as const

  let priceSummary: ReactNode
  const dynamicSummary = isDynamicPricing
    ? getDynamicPricingSummary(model, {
        ...priceOptions,
        groupRatioMultiplier: getDynamicDisplayGroupRatio(model, effectiveGroup),
      })
    : null
  if (dynamicSummary?.isSpecialExpression) {
    priceSummary = (
      <span className='text-amber-700 dark:text-amber-300'>
        {t('Special billing expression')}
      </span>
    )
  } else if (dynamicSummary && dynamicSummary.primaryEntries.length > 0) {
    priceSummary = (
      <>
        {dynamicSummary.primaryEntries.map((entry) => (
          <span
            key={entry.key}
            className='text-muted-foreground whitespace-nowrap'
          >
            {t(entry.shortLabel)}{' '}
            <span className='text-foreground font-mono font-semibold'>
              {entry.formatted}
            </span>
          </span>
        ))}
      </>
    )
  } else if (dynamicSummary) {
    priceSummary = (
      <span className='text-muted-foreground'>{t('Dynamic Pricing')}</span>
    )
  } else if (isTokenBased) {
    priceSummary = (
      <>
        <span className='text-muted-foreground whitespace-nowrap'>
          {t('Input')}{' '}
          <span className='text-foreground font-mono font-semibold'>
            {formatGroupPrice(
              model,
              effectiveGroup,
              'input',
              tokenUnit,
              showRechargePrice,
              priceRate,
              usdExchangeRate,
              model.group_ratio || {}
            )}
          </span>
        </span>
        <span className='text-muted-foreground/40'>·</span>
        <span className='text-muted-foreground whitespace-nowrap'>
          {t('Output')}{' '}
          <span className='text-foreground font-mono font-semibold'>
            {formatGroupPrice(
              model,
              effectiveGroup,
              'output',
              tokenUnit,
              showRechargePrice,
              priceRate,
              usdExchangeRate,
              model.group_ratio || {}
            )}
          </span>
        </span>
      </>
    )
  } else {
    priceSummary = (
      <span className='whitespace-nowrap'>
        <span className='text-foreground font-mono font-semibold'>
          {formatFixedPrice(
            model,
            effectiveGroup,
            showRechargePrice,
            priceRate,
            usdExchangeRate,
            model.group_ratio || {}
          )}
        </span>{' '}
        <span className='text-muted-foreground'>/ {t('request')}</span>
      </span>
    )
  }

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onClick()
        }
      }}
      className={cn(
        'hover:border-primary/40 focus-visible:ring-ring/40 flex cursor-pointer flex-col gap-1.5 rounded-xl border bg-card p-3.5 transition-all',
        'hover:shadow-md focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      {/* Layer 1: icon + full model name */}
      <div className='flex min-w-0 items-center gap-2'>
        <div className='bg-muted/40 flex size-6 shrink-0 items-center justify-center rounded-md'>
          {modelIcon || (
            <span className='text-muted-foreground text-xs font-bold'>
              {initial}
            </span>
          )}
        </div>
        <h3 className='text-foreground min-w-0 flex-1 font-mono text-[13.5px] leading-tight font-semibold break-all'>
          {model.model_name}
        </h3>
      </div>

      {/* Layer 2: one-line effective price for this group */}
      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]'>
        {priceSummary}
        {isTokenBased && (
          <span className='text-muted-foreground/60 text-[11px]'>
            /{tokenUnit === 'K' ? '1K' : '1M'}
          </span>
        )}
      </div>

      {/* Layer 3: billing badge + capability tags + endpoints */}
      <div className='flex min-w-0 flex-wrap items-center gap-1'>
        <ModelBillingModeBadge model={model} />
        {bottomItems.map((item) => (
          <span
            key={item}
            className='bg-muted/60 text-muted-foreground rounded-full px-1.5 py-px text-[10px] leading-4'
          >
            {item}
          </span>
        ))}
        {hiddenCount > 0 && (
          <span className='text-muted-foreground/60 text-[10px]'>
            +{hiddenCount}
          </span>
        )}
      </div>
    </div>
  )
})
