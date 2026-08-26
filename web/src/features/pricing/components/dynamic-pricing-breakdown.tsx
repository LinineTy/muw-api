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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  BILLING_PRICING_VARS,
  MATCH_CONTAINS,
  MATCH_EQ,
  MATCH_EXISTS,
  MATCH_GTE,
  MATCH_GT,
  MATCH_LT,
  MATCH_LTE,
  MATCH_RANGE,
  SOURCE_TIME,
  normalizeTierLabel,
  parseTiersFromExpr,
  requestRuleGroupsFromTrace,
  splitBillingExprAndRequestRules,
  tryParseRequestRuleExpr,
  type ParsedTier,
  type RequestCondition,
  type RequestRuleGroup,
  type RequestRuleTrace,
  type TierCondition,
  type TimeCondition,
} from '../lib/billing-expr'

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
}

const VAR_LABELS: Record<string, string> = {
  p: 'Input',
  c: 'Output',
  len: 'Length',
}
const OP_LABELS: Record<string, string> = {
  '<': '<',
  '<=': '≤',
  '>': '>',
  '>=': '≥',
}
const TIME_FUNC_LABELS: Record<string, string> = {
  hour: 'Hour',
  minute: 'Minute',
  weekday: 'Weekday',
  month: 'Month',
  day: 'Day',
}

function formatTokenHint(value: string | number): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  }
  return String(n)
}

function formatConditionSummary(
  conditions: TierCondition[],
  t: (key: string) => string
): string {
  return conditions
    .map((c) => {
      const varLabel = t(VAR_LABELS[c.var] || c.var)
      const hint = formatTokenHint(c.value)
      return `${varLabel} ${OP_LABELS[c.op] || c.op} ${hint || c.value}`
    })
    .filter(Boolean)
    .join(' && ')
}

function formatRangeText(start: string, end: string, timeFunc: string): string {
  const pad = timeFunc === 'hour' ? ':00' : ''
  return `${start}${pad}~${end}${pad}`
}

function timeFuncPrefix(timeFunc: string, t: (key: string) => string): string {
  switch (timeFunc) {
    case 'hour':
      return t('Every day')
    case 'minute':
      return t('Every hour')
    case 'weekday':
      return t('Every week')
    case 'day':
      return t('Every month')
    case 'month':
      return t('Every year')
    default:
      return t(TIME_FUNC_LABELS[timeFunc] || timeFunc)
  }
}

function timeUnitSuffix(timeFunc: string, t: (key: string) => string): string {
  switch (timeFunc) {
    case 'minute':
      return t('Minute unit')
    case 'day':
      return t('Day unit')
    case 'month':
      return t('Month unit')
    default:
      return ''
  }
}

function hourRangeText(
  start: string,
  end: string,
  t: (key: string) => string
): string {
  const startVal = Number(start)
  const endVal = Number(end)
  if (
    Number.isFinite(startVal) &&
    Number.isFinite(endVal) &&
    startVal > endVal
  ) {
    return `${start}:00~${t('Next day')} ${end}:00`
  }
  return formatRangeText(start, end, 'hour')
}

function hourConditionText(
  cond: TimeCondition,
  t: (key: string) => string
): string {
  const prefix = t('Every day')
  if (cond.mode === MATCH_RANGE) {
    return `${prefix} ${hourRangeText(cond.rangeStart, cond.rangeEnd, t)}`
  }
  if (cond.mode === MATCH_EQ) return `${prefix} ${cond.value}:00`
  const op = cond.mode === MATCH_GTE ? '≥' : '<'
  return `${prefix} ${op} ${cond.value}:00`
}

function weekdayConditionText(
  cond: TimeCondition,
  t: (key: string) => string
): string {
  if (cond.mode === MATCH_EQ) {
    const day = Number(cond.value)
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      return t(`Every week on day ${day}`)
    }
    return `${t('Every week')} ${cond.value}`
  }
  const prefix = t('Every week')
  if (cond.mode === MATCH_RANGE) {
    return `${prefix} ${formatRangeText(
      cond.rangeStart,
      cond.rangeEnd,
      cond.timeFunc
    )}`
  }
  const op = cond.mode === MATCH_GTE ? '≥' : '<'
  return `${prefix} ${op} ${cond.value}`
}

function recurringTimeConditionText(
  cond: TimeCondition,
  t: (key: string) => string
): string {
  const prefix = timeFuncPrefix(cond.timeFunc, t)
  const unit = timeUnitSuffix(cond.timeFunc, t)
  if (cond.mode === MATCH_RANGE) {
    return `${prefix} ${formatRangeText(
      cond.rangeStart,
      cond.rangeEnd,
      cond.timeFunc
    )}${unit}`
  }
  if (cond.mode === MATCH_EQ) return `${prefix} ${cond.value}${unit}`
  const op = cond.mode === MATCH_GTE ? '≥' : '<'
  return `${prefix} ${op} ${cond.value}${unit}`
}

function conditionChipText(
  cond: RequestCondition,
  t: (key: string) => string
): string {
  if (cond.source === SOURCE_TIME) {
    if (cond.timeFunc === 'hour') return hourConditionText(cond, t)
    if (cond.timeFunc === 'weekday') return weekdayConditionText(cond, t)
    return recurringTimeConditionText(cond, t)
  }
  const src = cond.source === 'header' ? t('Header') : t('Body param')
  const path = cond.path || ''
  if (cond.mode === MATCH_EXISTS) return `${src} ${path} ${t('Exists')}`
  if (cond.mode === MATCH_CONTAINS) {
    return `${src} ${path} ${t('Contains')} "${cond.value}"`
  }
  const opMap: Record<string, string> = {
    [MATCH_EQ]: '=',
    [MATCH_GT]: '>',
    [MATCH_GTE]: '≥',
    [MATCH_LT]: '<',
    [MATCH_LTE]: '≤',
  }
  return `${src} ${path} ${opMap[cond.mode] || '='} ${cond.value}`
}

const TIME_FUNC_PRIORITY: Record<string, number> = {
  hour: 0,
  minute: 1,
  weekday: 2,
  day: 3,
  month: 4,
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

type ConditionChip = { id: string; text: string; sortKey: number }

function buildGroupChips(
  group: RequestRuleGroup,
  t: (key: string) => string
): { chips: ConditionChip[] } {
  const conditions = group.conditions || []
  const chips: ConditionChip[] = []
  const chipOccurrences = new Map<string, number>()

  const pushChip = (text: string, sortKey: number) => {
    const occurrence = chipOccurrences.get(text) || 0
    chipOccurrences.set(text, occurrence + 1)
    chips.push({ id: `${text}:${occurrence}`, text, sortKey })
  }

  // Merge `>= X` and `< Y` conditions on the same hour func + timezone into
  // `X~Y` ranges (e.g. `>= 12 && < 18` -> `每天 12:00~18:00`). Each pair keeps
  // its own && semantics, so disjoint windows stay separate instead of folding
  // into one broad range.
  const gtesByKey = new Map<string, { index: number; cond: TimeCondition }[]>()
  const ltsByKey = new Map<string, { index: number; cond: TimeCondition }[]>()
  conditions.forEach((c, index) => {
    if (c.source !== SOURCE_TIME) return
    if (c.timeFunc !== 'hour') return
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
      const fn = timeFuncPrefix(gte.timeFunc, t)
      pushChip(
        `${fn} ${formatRangeText(gte.value, ltEntry.cond.value, gte.timeFunc)}`,
        conditionSortKey(gte, 0)
      )
      merged.add(gteIndex)
      merged.add(ltEntry.index)
      ltCursor += 1
    }
  }

  conditions.forEach((c, index) => {
    if (merged.has(index)) return
    pushChip(conditionChipText(c, t), conditionSortKey(c, index))
  })

  chips.sort((a, b) => a.sortKey - b.sortKey)

  return { chips }
}

function nextOccurrenceKey(
  baseKey: string,
  occurrences: Map<string, number>
): string {
  const occurrence = occurrences.get(baseKey) || 0
  occurrences.set(baseKey, occurrence + 1)
  return `${baseKey}:${occurrence}`
}

export function DynamicPricingBreakdown({
  billingExpr,
  matchedTierLabel,
  requestRules,
  hideCacheColumns = false,
  compact = false,
}: DynamicPricingBreakdownProps) {
  const { t } = useTranslation()
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
    const parsedTiers = parseTiersFromExpr(split.billingExpr)
    const parsedRules =
      requestRules != null
        ? requestRuleGroupsFromTrace(requestRules)
        : tryParseRequestRuleExpr(split.requestRuleExpr || '')
    return {
      tiers: parsedTiers,
      ruleGroups: parsedRules || [],
    }
  }, [expr, requestRules])

  const hasTiers = tiers.length > 0
  const hasRules = ruleGroups.length > 0
  // Distinct timezones used by the request rules, in order of first appearance.
  // Shown once in the section header; individual conditions never repeat it.
  const sectionTimezones = useMemo(() => {
    const tzs: string[] = []
    const seen = new Set<string>()
    for (const group of ruleGroups) {
      for (const cond of group.conditions || []) {
        if (cond.source === SOURCE_TIME) {
          const tz = cond.timezone || 'UTC'
          if (!seen.has(tz)) {
            seen.add(tz)
            tzs.push(tz)
          }
        }
      }
    }
    return tzs
  }, [ruleGroups])
  const normalizedMatchedTierLabel = normalizeTierLabel(
    matchedTierLabel ?? undefined
  )

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

  const visiblePriceFields = BILLING_PRICING_VARS.filter((v) => {
    if (!hasTiers) return false
    if (hideCacheColumns && v.group === 'cache') return false
    return tiers.some(
      (tier) => Number(tier[v.field as string as keyof ParsedTier] || 0) > 0
    )
  })
  const mobileTierKeyOccurrences = new Map<string, number>()
  const requestRuleKeyOccurrences = new Map<string, number>()

  return (
    <section className={cn('min-w-0', !compact && 'py-3 sm:py-4')}>
      {!compact && (
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
          <div
            className={
              compact
                ? 'text-muted-foreground mb-1.5 text-xs font-medium'
                : 'text-foreground mb-2 text-sm font-semibold'
            }
          >
            {t('Tiered price table')}
          </div>
          <div className='space-y-1.5 sm:hidden'>
            {tiers.map((tier) => {
              const condSummary = formatConditionSummary(tier.conditions, t)
              const isMatched =
                matchedTierLabel != null &&
                matchedTierLabel !== '' &&
                tier.label === matchedTierLabel
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
                    <Badge
                      variant='secondary'
                      className='bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                    >
                      {tier.label || t('Default')}
                    </Badge>
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
                  <div className='grid grid-cols-2 gap-x-3 gap-y-1.5'>
                    {visiblePriceFields.map((v) => {
                      const value = Number(
                        tier[v.field as string as keyof ParsedTier] || 0
                      )
                      return (
                        <div key={v.field} className='min-w-0'>
                          <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
                            {t(v.shortLabel)}
                          </div>
                          <div
                            className={cn(
                              'truncate font-mono',
                              compact ? 'text-xs' : 'text-sm font-semibold'
                            )}
                          >
                            {value > 0
                              ? `${symbol}${(value * rate).toFixed(4)}`
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
              const isMatched =
                normalizedMatchedTierLabel !== '' &&
                normalizeTierLabel(tier.label) === normalizedMatchedTierLabel
              return cn(
                isMatched &&
                  'bg-emerald-50/70 hover:bg-emerald-50/70 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/10'
              )
            }}
            columns={[
              {
                id: 'tier',
                header: t('Tier'),
                className: cn(
                  'text-muted-foreground py-2 font-medium',
                  compact && 'h-8'
                ),
                cellClassName: cn('align-top', compact ? 'py-2' : 'py-2.5'),
                cell: (tier) => {
                  const condSummary = formatConditionSummary(tier.conditions, t)
                  const isMatched =
                    normalizedMatchedTierLabel !== '' &&
                    normalizeTierLabel(tier.label) ===
                      normalizedMatchedTierLabel
                  return (
                    <>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <Badge
                          variant='secondary'
                          className='bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                        >
                          {tier.label || t('Default')}
                        </Badge>
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
              ...visiblePriceFields.map((v, index) => ({
                id: v.field ?? `price-${index}`,
                header: t(v.shortLabel),
                className: cn(
                  'text-muted-foreground py-2 text-right font-medium',
                  compact && 'h-8'
                ),
                cellClassName: cn(
                  'text-right align-top font-mono',
                  compact ? 'py-2' : 'py-2.5'
                ),
                cell: (tier: ParsedTier) => {
                  const value = Number(
                    tier[v.field as string as keyof ParsedTier] || 0
                  )
                  return value > 0 ? (
                    <span className={cn(!compact && 'font-semibold')}>
                      {`${symbol}${(value * rate).toFixed(4)}`}
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
              const { chips } = buildGroupChips(group, t)
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
                    {chips.length > 0 ? (
                      <span
                        className={cn(
                          'text-muted-foreground min-w-0',
                          compact ? 'text-xs' : 'text-sm'
                        )}
                      >
                        {chips.map((chip) => chip.text).join(' · ')}
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
