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
import { Tag as TagIcon } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  BILLING_PRICING_VARS,
  MATCH_GTE,
  MATCH_LT,
  MATCH_RANGE,
  SOURCE_TIME,
  parseTiersFromExpr,
  requestRuleGroupsFromTrace,
  splitBillingExprAndRequestRules,
  tryParseRequestRuleExpr,
  type ParsedTaskTier,
  type ParsedTier,
  type RequestCondition,
  type RequestRuleGroup,
  type RequestRuleTrace,
  type TimeCondition,
} from '../lib/billing-expr'
import { isBreakdownTierMatched } from '../lib/breakdown-tier-match'
import {
  TIME_FUNC_PRIORITY,
  formatConditionText,
  formatTierDnfText,
  formatRangeText,
  timeFuncPrefix,
  weekdayRangeText,
} from '../lib/condition-format'
import {
  formatTaskUsageUnitPrice,
  type DynamicPriceLabelKind,
  type DynamicPriceOptions,
} from '../lib/dynamic-price'
import { getTaskPricingDisplayTiers } from '../lib/task-matrix-display'
import {
  taskPriceLabel,
  taskPricingConditions,
} from '../lib/task-price-display'
import type { BillingUsageSchema, BillingUsageUnit } from '../types'

type DynamicPricingBreakdownProps = {
  billingExpr: string | null | undefined
  /**
   * Label of the tier that fired for the current request. When provided,
   * the corresponding row is highlighted and tagged as "Matched". Used by
   * the usage-log details dialog to show which tier the engine selected.
   */
  matchedTierLabel?: string | null
  /** Request-rule traces emitted by the settlement run. */
  requestRules?: RequestRuleTrace[] | null
  /**
   * Hide cache-pricing columns regardless of the per-tier values. The log
   * details dialog passes this when the actual request did not consume any
   * cache tokens, so users only see pricing rows that were relevant to the
   * call they are inspecting. Defaults to false (show all configured prices).
   */
  hideCacheColumns?: boolean
  /**
   * Dense rendering for the usage-log details dialog: drops the colored
   * icon header and uses the dialog's small text sizes. Defaults to false.
   */
  compact?: boolean
  usageSchema?: BillingUsageSchema
  taskPriceOptions?: Pick<
    DynamicPriceOptions,
    'showRechargePrice' | 'priceRate' | 'usdExchangeRate'
  >
  /**
   * Settlement usage facts from the consume log. Used to highlight the
   * expanded matrix display row when the engine label no longer matches
   * any synthesized combination label.
   */
  usageFacts?: Record<string, string | number>
}

type BreakdownTier = ParsedTier | ParsedTaskTier

type BreakdownPriceField = {
  id: string
  label: string
  labelKind: DynamicPriceLabelKind
  unit: BillingUsageUnit | 'request' | 'token'
  value: (tier: BreakdownTier) => number
}

function breakdownPriceFieldLabel(
  field: BreakdownPriceField,
  t: (key: string) => string
): ReactNode {
  if (field.labelKind === 'schema') {
    return <span className='break-words whitespace-normal'>{field.label}</span>
  }
  return t(field.label)
}

// Sort key for conditions inside a rule card: time-of-day first (small -> large),
// then weekdays Monday -> Sunday, then day/month, and request conditions last.
function conditionSortKey(
  cond: RequestCondition,
  originalIndex: number
): number {
  if (cond.source !== SOURCE_TIME) return 100_000 + originalIndex
  const base = (TIME_FUNC_PRIORITY[cond.timeFunc] ?? 5) * 10_000
  const value =
    cond.mode === MATCH_RANGE ? Number(cond.rangeStart) : Number(cond.value)
  let numeric = Number.isFinite(value) ? value : 0
  if (cond.timeFunc === 'weekday') numeric = numeric === 0 ? 6 : numeric - 1
  return base + Math.min(9999, Math.max(0, Math.round(numeric)))
}

type ConditionChip = { text: string; sortKey: number }

// Natural-language text for one AND-clause: `>= X`/`< Y` windows on the same
// hour/weekday func + timezone merge into one range chip, the remaining
// conditions render via `formatConditionText`, all ordered and joined by ` · `.
function buildBranchText(
  conditions: RequestCondition[],
  t: (key: string) => string
): string {
  const chips: ConditionChip[] = []
  const chipOccurrences = new Map<string, number>()

  const pushChip = (text: string, sortKey: number) => {
    const occurrence = chipOccurrences.get(text) || 0
    chipOccurrences.set(text, occurrence + 1)
    chips.push({ text, sortKey })
  }

  // Merge `>= X` and `< Y` conditions on the same time func + timezone into a
  // single window chip (e.g. `hour >= 12 && hour < 18` -> `每天 12:00~18:00`,
  // `weekday >= 1 && weekday < 6` -> `每周一~周五`). Each pair keeps its own &&
  // semantics, so disjoint windows stay separate instead of folding into one
  // broad range.
  const gtesByKey = new Map<string, { index: number; cond: TimeCondition }[]>()
  const ltsByKey = new Map<string, { index: number; cond: TimeCondition }[]>()
  conditions.forEach((c, index) => {
    if (c.source !== SOURCE_TIME) return
    if (c.timeFunc !== 'hour' && c.timeFunc !== 'weekday') return
    if (c.mode !== MATCH_GTE && c.mode !== MATCH_LT) return
    const key = `${c.timeFunc}:${c.timezone || 'UTC'}`
    const list = c.mode === MATCH_GTE ? gtesByKey : ltsByKey
    const arr = list.get(key) || []
    arr.push({ index, cond: c })
    list.set(key, arr)
  })
  const merged = new Set<number>()
  for (const [key, gtes] of gtesByKey) {
    const lts = ltsByKey.get(key)
    if (!lts || lts.length === 0) continue
    const sortedGtes = [...gtes].sort(
      (a, b) => Number(a.cond.value) - Number(b.cond.value)
    )
    const sortedLts = [...lts].sort(
      (a, b) => Number(a.cond.value) - Number(b.cond.value)
    )
    let ltCursor = 0
    for (const { index: gteIndex, cond: gte } of sortedGtes) {
      const gteVal = Number(gte.value)
      while (
        ltCursor < sortedLts.length &&
        Number(sortedLts[ltCursor].cond.value) <= gteVal
      ) {
        ltCursor += 1
      }
      if (ltCursor >= sortedLts.length) break
      const ltEntry = sortedLts[ltCursor]
      const ltVal = Number(ltEntry.cond.value)
      if (!Number.isFinite(gteVal) || !Number.isFinite(ltVal)) continue
      const chipText =
        gte.timeFunc === 'weekday'
          ? weekdayRangeText(gte.value, ltEntry.cond.value, t)
          : `${timeFuncPrefix(gte.timeFunc, t)} ${formatRangeText(
              gte.value,
              ltEntry.cond.value,
              gte.timeFunc
            )}`
      pushChip(chipText, conditionSortKey(gte, 0))
      merged.add(gteIndex)
      merged.add(ltEntry.index)
      ltCursor += 1
    }
  }

  conditions.forEach((c, index) => {
    if (merged.has(index)) return
    pushChip(formatConditionText(c, t), conditionSortKey(c, index))
  })

  chips.sort((a, b) => a.sortKey - b.sortKey)
  return chips.map((chip) => chip.text).join(' · ')
}

// Natural-language text for a rule group's DNF: each OR branch renders via
// `buildBranchText`; branches are joined by a localized OR word.
function buildGroupChips(
  group: RequestRuleGroup,
  t: (key: string) => string
): string {
  const branchTexts = (group.conditions || [])
    .map((branch) => buildBranchText(branch.conditions || [], t))
    .filter(Boolean)
  if (branchTexts.length === 0) return ''
  if (branchTexts.length === 1) return branchTexts[0]
  return branchTexts.join(` ${t('OR')} `)
}

function nextOccurrenceKey(
  baseKey: string,
  occurrences: Map<string, number>
): string {
  const occurrence = occurrences.get(baseKey) || 0
  occurrences.set(baseKey, occurrence + 1)
  return `${baseKey}:${occurrence}`
}

function isTaskBreakdownTier(tier: BreakdownTier): tier is ParsedTaskTier {
  return 'unitPrices' in tier
}

// Non-task tiers keep the fork's DNF condition formatter; task tiers resolve
// their conditions against the usage schema.
function formatBreakdownConditionSummary(
  tier: BreakdownTier,
  t: (key: string) => string,
  schema: BillingUsageSchema | undefined,
  language: string,
  tierCount: number
): string {
  if (!isTaskBreakdownTier(tier)) {
    return formatTierDnfText(tier.conditions, t)
  }
  return (
    taskPricingConditions(tier.conditions, schema, language, t) ||
    t(tierCount > 1 ? 'Other cases' : 'All requests')
  )
}

function formatBreakdownPrice(
  value: number,
  field: BreakdownPriceField,
  symbol: string,
  rate: number,
  t: (key: string) => string,
  taskPriceOptions: DynamicPricingBreakdownProps['taskPriceOptions']
): string {
  const amount =
    field.labelKind === 'schema' || field.unit === 'request'
      ? formatTaskUsageUnitPrice(value, { tokenUnit: 'M', ...taskPriceOptions })
      : `${symbol}${(value * rate).toFixed(4)}`
  if (field.unit === 'second') return `${amount}/${t('s')}`
  if (field.unit === 'count') return `${amount}/${t('unit')}`
  if (field.unit === 'credit') return `${amount}/${t('credit')}`
  if (field.unit === 'token' && field.labelKind === 'schema') {
    return `${amount}/${t('1M token')}`
  }
  if (field.unit === 'request') return `${amount}/${t('request')}`
  return amount
}

export function DynamicPricingBreakdown({
  billingExpr,
  matchedTierLabel,
  requestRules,
  hideCacheColumns = false,
  compact = false,
  usageSchema,
  taskPriceOptions,
  usageFacts,
}: DynamicPricingBreakdownProps) {
  const { t, i18n } = useTranslation()
  const expr = billingExpr || ''
  const currency = useSystemConfigStore((s) => s.config.currency)

  const { symbol, rate } = useMemo(() => {
    if (currency.quotaDisplayType === 'CNY') {
      return { symbol: '¥', rate: currency.usdExchangeRate || 7 }
    }
    if (currency.quotaDisplayType === 'CUSTOM') {
      return {
        symbol: currency.customCurrencySymbol || '¤',
        rate: currency.customCurrencyExchangeRate || 1,
      }
    }
    return { symbol: '$', rate: 1 }
  }, [currency])

  const { tiers, ruleGroups } = useMemo(() => {
    const split = splitBillingExprAndRequestRules(expr)
    const parsedTiers = usageSchema
      ? getTaskPricingDisplayTiers(split.billingExpr, usageSchema)
      : parseTiersFromExpr(split.billingExpr)
    const parsedRules =
      requestRules != null
        ? requestRuleGroupsFromTrace(requestRules)
        : tryParseRequestRuleExpr(split.requestRuleExpr || '')
    return {
      tiers: parsedTiers,
      ruleGroups: parsedRules || [],
    }
  }, [expr, usageSchema, requestRules])

  const hasTiers = tiers.length > 0
  const hasRules = ruleGroups.length > 0
  // Distinct timezones used by the request rules, in order of first appearance.
  // Shown once in the section header; individual conditions never repeat it.
  const sectionTimezones = useMemo(() => {
    const tzs: string[] = []
    const seen = new Set<string>()
    for (const group of ruleGroups) {
      for (const branch of group.conditions || []) {
        for (const cond of branch.conditions || []) {
          if (cond.source === SOURCE_TIME) {
            const tz = cond.timezone || 'UTC'
            if (!seen.has(tz)) {
              seen.add(tz)
              tzs.push(tz)
            }
          }
        }
      }
    }
    return tzs
  }, [ruleGroups])

  if (!expr) return null

  if (!hasTiers) {
    return (
      <section className={cn('min-w-0', !compact && 'py-4')}>
        {!compact && (
          <div className='mb-3 flex items-center gap-2'>
            <span className='inline-flex size-6 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-500/20 dark:text-amber-300'>
              <TagIcon className='size-3.5' />
            </span>
            <div>
              <div className='text-foreground text-base font-medium'>
                {t('Special billing expression')}
              </div>
              <div className='text-muted-foreground text-xs'>
                {t('Unable to parse structured pricing')}
              </div>
            </div>
          </div>
        )}
        <div className='text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase'>
          {t('Raw expression')}
        </div>
        <code className='text-muted-foreground block text-xs break-all'>
          {expr}
        </code>
      </section>
    )
  }

  const visiblePriceFields: BreakdownPriceField[] = (() => {
    if (!hasTiers) return []
    if (usageSchema) {
      const fields: BreakdownPriceField[] = Object.entries(usageSchema)
        .filter(
          ([field, definition]) =>
            definition.type === 'number' &&
            Boolean(definition.unit) &&
            tiers.some(
              (tier) =>
                isTaskBreakdownTier(tier) &&
                Number(tier.unitPrices[field] || 0) > 0
            )
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([field, definition]) => ({
          id: field,
          label: taskPriceLabel(definition.description, field, i18n.language),
          labelKind: 'schema' as const,
          unit: definition.unit as BillingUsageUnit,
          value: (tier: BreakdownTier) =>
            isTaskBreakdownTier(tier) ? Number(tier.unitPrices[field] || 0) : 0,
        }))
      if (
        tiers.some((tier) => isTaskBreakdownTier(tier) && tier.constant > 0)
      ) {
        fields.push({
          id: 'constant',
          label: 'Additional charge',
          labelKind: 'i18n',
          unit: 'request',
          value: (tier: BreakdownTier) =>
            isTaskBreakdownTier(tier) ? tier.constant : 0,
        })
      }
      return fields
    }
    return BILLING_PRICING_VARS.filter((variable) => {
      if (hideCacheColumns && variable.group === 'cache') return false
      return tiers.some(
        (tier) =>
          !isTaskBreakdownTier(tier) &&
          Number(tier[variable.field as string as keyof ParsedTier] || 0) > 0
      )
    }).map((variable, index) => ({
      id: variable.field ?? `price-${index}`,
      label: variable.shortLabel,
      labelKind: 'i18n' as const,
      unit: 'token',
      value: (tier: BreakdownTier) =>
        isTaskBreakdownTier(tier)
          ? 0
          : Number(tier[variable.field as string as keyof ParsedTier] || 0),
    }))
  })()
  const mobileTierKeyOccurrences = new Map<string, number>()
  const requestRuleKeyOccurrences = new Map<string, number>()

  return (
    <section className={cn('min-w-0', !compact && 'py-3 sm:py-4')}>
      {!compact && !usageSchema && (
        <div className='mb-3 flex items-start gap-2 sm:mb-4'>
          <span className='mt-0.5 inline-flex size-6 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-500/20 dark:text-amber-300'>
            <TagIcon className='size-3.5' />
          </span>
          <div>
            <div className='text-foreground text-base font-medium'>
              {t('Dynamic Pricing')}
            </div>
            <div className='text-muted-foreground text-xs'>
              {t('Prices vary by usage tier and request conditions')}
            </div>
          </div>
        </div>
      )}

      {hasTiers && (
        <div className={cn(compact ? cn(hasRules && 'mb-2') : 'mb-3 sm:mb-4')}>
          {!usageSchema && (
            <div
              className={
                compact
                  ? 'text-muted-foreground mb-1.5 text-xs font-medium'
                  : 'text-foreground mb-2 text-sm font-semibold'
              }
            >
              {t('Tiered price table')}
            </div>
          )}
          <div className='space-y-1.5 sm:hidden'>
            {tiers.map((tier) => {
              const condSummary = formatBreakdownConditionSummary(
                tier,
                t,
                usageSchema,
                i18n.language,
                tiers.length
              )
              const isMatched = isBreakdownTierMatched(
                tier,
                tiers,
                matchedTierLabel,
                usageFacts
              )
              const rowKey = nextOccurrenceKey(
                JSON.stringify(tier),
                mobileTierKeyOccurrences
              )
              return (
                <div
                  key={`tier-mobile-${rowKey}`}
                  className={cn(
                    'rounded-md border p-2',
                    isMatched && 'border-emerald-500/40 bg-emerald-500/10'
                  )}
                >
                  <div className='mb-1.5 flex flex-wrap items-center gap-1.5'>
                    {!usageSchema && (
                      <Badge
                        variant='secondary'
                        className='bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                      >
                        {tier.label || t('Default')}
                      </Badge>
                    )}
                    {isMatched && (
                      <Badge
                        variant='secondary'
                        className='bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                      >
                        {t('Matched')}
                      </Badge>
                    )}
                  </div>
                  {condSummary && (
                    <div className='text-muted-foreground mb-1.5 text-xs'>
                      {condSummary}
                    </div>
                  )}
                  <div
                    className={cn(
                      'grid gap-x-3 gap-y-1.5',
                      visiblePriceFields.length > 1 && 'grid-cols-2'
                    )}
                  >
                    {visiblePriceFields.map((field) => {
                      const value = field.value(tier)
                      return (
                        <div key={field.id} className='min-w-0'>
                          <div className='text-muted-foreground text-xs font-medium break-words whitespace-normal'>
                            {breakdownPriceFieldLabel(field, t)}
                          </div>
                          <div
                            className={cn(
                              'break-words font-mono',
                              compact ? 'text-xs' : 'text-sm font-semibold'
                            )}
                          >
                            {value > 0
                              ? formatBreakdownPrice(
                                  value,
                                  field,
                                  symbol,
                                  rate,
                                  t,
                                  taskPriceOptions
                                )
                              : '-'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <StaticDataTable
            className='hidden rounded-none border-0 sm:block'
            tableClassName={
              compact
                ? '[&_td]:text-xs [&_td_*]:text-xs [&_th]:text-xs [&_th_*]:text-xs'
                : 'text-sm'
            }
            headerRowClassName='hover:bg-transparent'
            data={tiers}
            getRowKey={(_tier, index) => `tier-${index}`}
            getRowClassName={(tier) => {
              const isMatched = isBreakdownTierMatched(
                tier,
                tiers,
                matchedTierLabel,
                usageFacts
              )
              return cn(
                isMatched &&
                  'bg-emerald-50/70 hover:bg-emerald-50/70 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/10'
              )
            }}
            columns={[
              {
                id: 'tier',
                header: usageSchema ? t('Applicable conditions') : t('Tier'),
                className: cn(
                  'text-muted-foreground py-2 font-medium',
                  compact && 'h-8'
                ),
                cellClassName: cn(
                  'align-top whitespace-normal break-words',
                  compact ? 'py-2' : 'py-2.5'
                ),
                cell: (tier) => {
                  const condSummary = formatBreakdownConditionSummary(
                    tier,
                    t,
                    usageSchema,
                    i18n.language,
                    tiers.length
                  )
                  const isMatched = isBreakdownTierMatched(
                    tier,
                    tiers,
                    matchedTierLabel,
                    usageFacts
                  )
                  return (
                    <>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        {!usageSchema && (
                          <Badge
                            variant='secondary'
                            className='bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                          >
                            {tier.label || t('Default')}
                          </Badge>
                        )}
                        {isMatched && (
                          <Badge
                            variant='secondary'
                            className='bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                          >
                            {t('Matched')}
                          </Badge>
                        )}
                      </div>
                      {condSummary && (
                        <div className='text-muted-foreground mt-1 text-xs'>
                          {condSummary}
                        </div>
                      )}
                    </>
                  )
                },
              },
              ...visiblePriceFields.map((field) => ({
                id: field.id,
                header: breakdownPriceFieldLabel(field, t),
                className: cn(
                  'text-muted-foreground py-2 text-right font-medium',
                  compact && 'h-8'
                ),
                cellClassName: cn(
                  'text-right align-top font-mono',
                  compact ? 'py-2' : 'py-2.5'
                ),
                cell: (tier: BreakdownTier) => {
                  const value = field.value(tier)
                  return value > 0 ? (
                    <span className={cn(!compact && 'font-semibold')}>
                      {formatBreakdownPrice(
                        value,
                        field,
                        symbol,
                        rate,
                        t,
                        taskPriceOptions
                      )}
                    </span>
                  ) : (
                    '-'
                  )
                },
              })),
            ]}
          />
        </div>
      )}

      {hasRules && (
        <div>
          <div
            className={
              compact
                ? 'text-muted-foreground mb-1.5 text-xs font-medium'
                : 'text-foreground mb-2 text-sm font-semibold'
            }
          >
            {t('Conditional multipliers')}
          </div>
          {sectionTimezones.length > 0 && (
            <div className='text-muted-foreground mb-2 text-xs'>
              {t('Effective timezone')}: {sectionTimezones.join(' · ')}
            </div>
          )}
          <ul className='space-y-1.5'>
            {ruleGroups.map((group) => {
              const isMatched = group.matched === true
              const rowKey = nextOccurrenceKey(
                `${group.conditionText || JSON.stringify(group.conditions)}:${group.multiplier}`,
                requestRuleKeyOccurrences
              )
              const chipsText = buildGroupChips(group, t)
              return (
                <li
                  key={`group-${rowKey}`}
                  className={cn(
                    'rounded-lg border p-2.5',
                    isMatched
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-border/60 bg-card/60'
                  )}
                >
                  <div className='flex items-center justify-between gap-3'>
                    {chipsText ? (
                      <span
                        className={cn(
                          'text-muted-foreground min-w-0',
                          compact ? 'text-xs' : 'text-sm'
                        )}
                      >
                        {chipsText}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'text-foreground break-all',
                          compact ? 'text-xs' : 'text-sm'
                        )}
                      >
                        {group.conditionText || ''}
                      </span>
                    )}
                    <Badge
                      variant='secondary'
                      className={cn(
                        'shrink-0 bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
                        isMatched &&
                          'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                      )}
                    >
                      {group.multiplier}x{isMatched && ` · ${t('Matched')}`}
                    </Badge>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
