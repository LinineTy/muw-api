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
/**
 * Billing expression parsing utilities.
 *
 * Parses the dynamic billing expression format so that the pricing breakdown
 * UI can be rendered from the same backend expressions.
 *
 * Display adapters intentionally accept fewer shapes than the shared
 * simulator. Existing ordered-tier, task-unit and request-rule contracts
 * stay intact; executable custom expressions do not imply fixed unit prices.
 */

import type { BillingUsageSchema } from '../types'
import {
  readTokenTierChain,
  readTaskTierChain,
  readTimeTokenPricing,
  type TokenTier,
} from './billing-expression/display'
import { compileBillingExpression } from './billing-expression/parser'
import {
  splitExpressionAtTopLevel,
  unwrapExpressionParens,
} from './billing-expression/structure'

// ---------------------------------------------------------------------------
// Variable registry
// ---------------------------------------------------------------------------

export type BillingVar = {
  key: string
  field: string | null
  tierField: string | null
  label: string
  shortLabel: string
  side: 'input' | 'output' | 'condition'
  isBase?: boolean
  isConditionOnly?: boolean
  group?: string
}

export const BILLING_VARS: BillingVar[] = [
  {
    key: 'p',
    field: 'inputPrice',
    tierField: 'input_unit_cost',
    label: 'Input price',
    shortLabel: 'Input',
    side: 'input',
    isBase: true,
  },
  {
    key: 'c',
    field: 'outputPrice',
    tierField: 'output_unit_cost',
    label: 'Completion price',
    shortLabel: 'Output',
    side: 'output',
    isBase: true,
  },
  {
    key: 'len',
    field: null,
    tierField: null,
    label: 'Input length',
    shortLabel: 'Length',
    side: 'condition',
    isConditionOnly: true,
  },
  {
    key: 'cr',
    field: 'cacheReadPrice',
    tierField: 'cache_read_unit_cost',
    label: 'Cache read price',
    shortLabel: 'Cache Read',
    side: 'input',
    group: 'cache',
  },
  {
    key: 'cc',
    field: 'cacheCreatePrice',
    tierField: 'cache_create_unit_cost',
    label: 'Cache create price',
    shortLabel: 'Cache Write',
    side: 'input',
    group: 'cache',
  },
  {
    key: 'img_cr',
    field: 'imageCachePrice',
    tierField: 'image_cache_unit_cost',
    label: 'Image cache input price',
    shortLabel: 'Image Cache',
    side: 'input',
    group: 'cache',
  },
  {
    key: 'cc1h',
    field: 'cacheCreate1hPrice',
    tierField: 'cache_create_1h_unit_cost',
    label: 'Cache create (1h) price',
    shortLabel: 'Cache Write (1h)',
    side: 'input',
    group: 'cache',
  },
  {
    key: 'img',
    field: 'imagePrice',
    tierField: 'image_unit_cost',
    label: 'Image input price',
    shortLabel: 'Image In',
    side: 'input',
    group: 'media',
  },
  {
    key: 'img_o',
    field: 'imageOutputPrice',
    tierField: 'image_output_unit_cost',
    label: 'Image output price',
    shortLabel: 'Image Out',
    side: 'output',
    group: 'media',
  },
  {
    key: 'ai',
    field: 'audioInputPrice',
    tierField: 'audio_input_unit_cost',
    label: 'Audio input price',
    shortLabel: 'Audio In',
    side: 'input',
    group: 'media',
  },
  {
    key: 'ao',
    field: 'audioOutputPrice',
    tierField: 'audio_output_unit_cost',
    label: 'Audio output price',
    shortLabel: 'Audio Out',
    side: 'output',
    group: 'media',
  },
]

/** Vars that have real price fields (excludes condition-only vars like `len`) */
export const BILLING_PRICING_VARS: BillingVar[] = BILLING_VARS.filter(
  (v) => !v.isConditionOnly
)

/** Vars valid in tier conditions (`p`, `c`, `len`) */
export const BILLING_CONDITION_VARS: string[] = BILLING_VARS.filter(
  (v) => v.isBase || v.isConditionOnly
).map((v) => v.key)

const BILLING_VAR_KEY_TO_FIELD = Object.fromEntries(
  BILLING_PRICING_VARS.map((v) => [v.key, v.field as string])
) as Record<string, string>

export const BILLING_EXTRA_VARS: BillingVar[] = BILLING_VARS.filter(
  (v) => !v.isBase && !v.isConditionOnly
)

export const BILLING_CACHE_VAR_MAP = BILLING_EXTRA_VARS.map((v) => ({
  field: v.tierField as string,
  exprVar: v.key,
}))

// ---------------------------------------------------------------------------
// Request rule constants
// ---------------------------------------------------------------------------

export const SOURCE_PARAM = 'param'
export const SOURCE_HEADER = 'header'
export const SOURCE_TIME = 'time'

export const MATCH_EQ = 'eq'
export const MATCH_CONTAINS = 'contains'
export const MATCH_GT = 'gt'
export const MATCH_GTE = 'gte'
export const MATCH_LT = 'lt'
export const MATCH_LTE = 'lte'
export const MATCH_EXISTS = 'exists'
export const MATCH_RANGE = 'range'

/**
 * Source operator of a parsed MATCH_RANGE. The expression language has two
 * range spellings: a within-day window serializes as `fn >= s && fn < e`
 * ('and'), an overnight window as `fn >= s || fn < e` ('or'). The op is not
 * serialized — the builder re-derives it from the bounds — but the display and
 * the validator need it to tell a real window from the degenerate spellings
 * (`||` with start <= end matches every value, `&&` with start >= end can never
 * match).
 */
export const RANGE_OP_AND = 'and'
export const RANGE_OP_OR = 'or'
export type RangeOp = typeof RANGE_OP_AND | typeof RANGE_OP_OR

export const TIME_FUNCS = ['hour', 'minute', 'weekday', 'month', 'day'] as const
export type TimeFunc = (typeof TIME_FUNCS)[number]

export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: 'Asia/Shanghai', label: 'UTC+8 Shanghai (Asia/Shanghai)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'UTC-5 New York (America/New_York)' },
  {
    value: 'America/Los_Angeles',
    label: 'UTC-8 Los Angeles (America/Los_Angeles)',
  },
  { value: 'America/Chicago', label: 'UTC-6 Chicago (America/Chicago)' },
  { value: 'Europe/London', label: 'UTC+0 London (Europe/London)' },
  { value: 'Europe/Berlin', label: 'UTC+1 Berlin (Europe/Berlin)' },
  { value: 'Asia/Tokyo', label: 'UTC+9 Tokyo (Asia/Tokyo)' },
  { value: 'Asia/Singapore', label: 'UTC+8 Singapore (Asia/Singapore)' },
  { value: 'Asia/Seoul', label: 'UTC+9 Seoul (Asia/Seoul)' },
  { value: 'Australia/Sydney', label: 'UTC+10 Sydney (Australia/Sydney)' },
]

const NUMERIC_LITERAL_REGEX = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

export type ParamHeaderCondition = {
  source: 'param' | 'header'
  path: string
  mode: string
  value: string
  /** Literal kind of an EQ value, so `param("x") == "true"` (string) round-trips
   * as a string instead of collapsing into the boolean `== true`. */
  valueKind?: 'string' | 'number' | 'boolean'
}

export type TimeCondition = {
  source: 'time'
  timeFunc: TimeFunc
  timezone: string
  mode: string
  value: string
  rangeStart: string
  rangeEnd: string
  /** Source operator of a parsed MATCH_RANGE (see `RANGE_OP_AND` /
   * `RANGE_OP_OR`); undefined for a range authored in the editor, whose
   * operator the builder derives from the bounds. */
  rangeOp?: RangeOp
}

export type RequestCondition = TimeCondition | ParamHeaderCondition

/**
 * A condition set is a DNF: an OR of AND-clauses ("branches"). `[]` means the
 * empty DNF (always true) — only valid on the fallback tier.
 */
export type AndClause<T> = { conditions: T[] }
export type Dnf<T> = AndClause<T>[]

export type RequestRuleGroup = {
  conditions: Dnf<RequestCondition>
  multiplier: string
  conditionText?: string
  matched?: boolean
}

export type RequestDnf = Dnf<RequestCondition>

export type RequestRuleTrace = {
  cond: string
  multiplier: number
  matched: boolean
}

export type TierCondition = {
  var: 'p' | 'c' | 'len'
  op: '<' | '<=' | '>' | '>='
  value: number
}

export type TierConditionDnf = Dnf<TierCondition>

export type ParsedTier = {
  billingUnit?: 'token' | 'request'
  fixedPrice?: number
  conditionText?: string
  label: string
  conditions: TierConditionDnf
  [field: string]: unknown
}

export type TaskTierCondition = {
  field: string
  value: string
}

export type ParsedTaskTier = {
  conditionText?: string
  label: string
  conditions: TaskTierCondition[]
  constant: number
  unitPrices: Record<string, number>
}

// ---------------------------------------------------------------------------
// Tier parser
// ---------------------------------------------------------------------------

function mapTokenTier(
  tier: TokenTier & { conditionText?: string }
): ParsedTier {
  return {
    label: tier.label,
    ...(tier.imageCount ? { imageCount: true } : {}),
    conditions: tier.conditions,
    ...(tier.billingUnit === 'request'
      ? { billingUnit: tier.billingUnit, fixedPrice: tier.fixedPrice }
      : {}),
    ...(tier.conditionText ? { conditionText: tier.conditionText } : {}),
    ...Object.fromEntries(
      Object.entries(tier.prices).map(([key, price]) => [
        BILLING_VAR_KEY_TO_FIELD[key],
        price,
      ])
    ),
  }
}

export function parseTiersFromExpr(exprStr: string): ParsedTier[] {
  if (!exprStr) return []
  const compiled = compileBillingExpression(exprStr)
  if (compiled.status !== 'ready') return []
  const canonical = readTokenTierChain(compiled.ast)
  if (canonical) return canonical.map(mapTokenTier)
  return readTimeTokenPricing(exprStr)?.tiers.map(mapTokenTier) ?? []
}

/** Current-time selection is exclusively for summaries; detail and log callers retain all rows. */
export function getCurrentTimePricingTiers(
  exprStr: string,
  now: Date
): ParsedTier[] | null {
  return (
    readTimeTokenPricing(exprStr, now)?.currentTiers.map(mapTokenTier) ?? null
  )
}

export function parseTaskTiersFromExpr(
  exprStr: string,
  schema: BillingUsageSchema | null | undefined,
  includeBooleanConditions = false
): ParsedTaskTier[] {
  if (!exprStr || !schema || Object.keys(schema).length === 0) return []
  const { billingExpr } = splitBillingExprAndRequestRules(exprStr)
  const compiled = compileBillingExpression(billingExpr)
  if (compiled.status !== 'ready') return []
  return readTaskTierChain(compiled.ast, schema, includeBooleanConditions) ?? []
}

export function normalizeTierLabel(label: string | undefined): string {
  if (!label) return ''
  return label
    .replaceAll(/<[=＝]?|≤|＜[=＝]?/g, '<')
    .replaceAll(/>[=＝]?|≥|＞[=＝]?/g, '>')
    .replaceAll(/\s+/g, '')
    .toLowerCase()
}

// ---------------------------------------------------------------------------
// Request rule parser
// ---------------------------------------------------------------------------

function splitTopLevelMultiply(expr: string): string[] {
  return splitExpressionAtTopLevel(expr, '*')
}

function splitTopLevelAnd(expr: string): string[] {
  return splitExpressionAtTopLevel(expr, '&&')
}

function splitTopLevelOr(expr: string): string[] {
  return splitExpressionAtTopLevel(expr, '||')
}

type ExprLiteral = { value: string; kind: 'string' | 'number' | 'boolean' }

function parseExprLiteral(raw: string): ExprLiteral | null {
  const text = raw.trim()
  if (text === 'true' || text === 'false') {
    return { value: text, kind: 'boolean' }
  }
  if (NUMERIC_LITERAL_REGEX.test(text)) return { value: text, kind: 'number' }
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed === 'string') return { value: parsed, kind: 'string' }
    if (typeof parsed === 'number') {
      return { value: String(parsed), kind: 'number' }
    }
    if (typeof parsed === 'boolean') {
      return { value: String(parsed), kind: 'boolean' }
    }
    return null
  } catch {
    return null
  }
}

// Time function value domains. Values outside these ranges are invalid for
// the corresponding time function (e.g. hour() is 0-23) and would otherwise
// produce always-true conditions like hour >= -1 || hour < -5.
const TIME_FUNC_RANGES: Record<TimeFunc, [number, number]> = {
  hour: [0, 23],
  minute: [0, 59],
  weekday: [0, 6],
  month: [1, 12],
  day: [1, 31],
}

function isTimeValueInRange(timeFunc: TimeFunc, text: string): boolean {
  if (!NUMERIC_LITERAL_REGEX.test(text)) return false
  const value = Number(text)
  if (!Number.isInteger(value)) return false
  const [min, max] = TIME_FUNC_RANGES[timeFunc]
  return value >= min && value <= max
}

function tryParseTimeCondition(expr: string): RequestCondition | null {
  // The bound operator is captured rather than merely matched: `&&`
  // (within-day) and `||` (overnight) both serialize a MATCH_RANGE, and losing
  // which one was written would leave the display and the degenerate-range
  // validator blind to the difference.
  let m = expr.match(
    /^(hour|minute|weekday|month|day)\("([^"]+)"\) >= ([\d.eE+-]+) (&&|\|\|) \1\("\2"\) < ([\d.eE+-]+)$/
  )
  if (!m) {
    m = expr.match(
      /^\((hour|minute|weekday|month|day)\("([^"]+)"\) >= ([\d.eE+-]+) (&&|\|\|) \1\("\2"\) < ([\d.eE+-]+)\)$/
    )
  }
  if (m) {
    // Reject invalid bounds at parse time too: an unparseable rule keeps the
    // editor in raw mode, while a leniently parsed one would be silently
    // dropped when the visual editor rebuilds the expression.
    if (
      !isTimeValueInRange(m[1] as TimeFunc, m[3]) ||
      !isTimeValueInRange(m[1] as TimeFunc, m[5])
    ) {
      return null
    }
    return {
      source: 'time',
      timeFunc: m[1] as TimeFunc,
      timezone: m[2],
      mode: MATCH_RANGE,
      value: '',
      rangeStart: m[3],
      rangeEnd: m[5],
      rangeOp: m[4] === '&&' ? RANGE_OP_AND : RANGE_OP_OR,
    }
  }
  m = expr.match(
    /^(hour|minute|weekday|month|day)\("([^"]+)"\) (==|>=|<) ([\d.eE+-]+)$/
  )
  if (m) {
    if (!isTimeValueInRange(m[1] as TimeFunc, m[4])) return null
    const opMap: Record<string, string> = {
      '==': MATCH_EQ,
      '>=': MATCH_GTE,
      '<': MATCH_LT,
    }
    return {
      source: 'time',
      timeFunc: m[1] as TimeFunc,
      timezone: m[2],
      mode: opMap[m[3]] || MATCH_EQ,
      value: m[4],
      rangeStart: '',
      rangeEnd: '',
    }
  }
  return null
}

function tryParseRequestCondition(expr: string): RequestCondition | null {
  const tc = tryParseTimeCondition(expr)
  if (tc) return tc

  let m = expr.match(/^header\("([^"]+)"\) != ""$/)
  if (m) return { source: 'header', path: m[1], mode: MATCH_EXISTS, value: '' }

  m = expr.match(/^param\("([^"]+)"\) != nil$/)
  if (m) return { source: 'param', path: m[1], mode: MATCH_EXISTS, value: '' }

  m = expr.match(/^has\(header\("([^"]+)"\), ((?:"(?:[^"\\]|\\.)*"))\)$/)
  if (m) {
    return {
      source: 'header',
      path: m[1],
      mode: MATCH_CONTAINS,
      value: JSON.parse(m[2]) as string,
    }
  }

  m = expr.match(
    /^param\("([^"]+)"\) != nil && has\(param\("([^"]+)"\), ((?:"(?:[^"\\]|\\.)*"))\)$/
  )
  if (m && m[1] === m[2]) {
    return {
      source: 'param',
      path: m[1],
      mode: MATCH_CONTAINS,
      value: JSON.parse(m[3]) as string,
    }
  }

  m = expr.match(
    /^param\("([^"]+)"\) != nil && param\("([^"]+)"\) (>|>=|<|<=) ([\d.eE+-]+)$/
  )
  if (m && m[1] === m[2]) {
    const opMap: Record<string, string> = {
      '>': MATCH_GT,
      '>=': MATCH_GTE,
      '<': MATCH_LT,
      '<=': MATCH_LTE,
    }
    return { source: 'param', path: m[1], mode: opMap[m[3]], value: m[4] }
  }

  m = expr.match(/^(param|header)\("([^"]+)"\) == (.+)$/)
  if (m) {
    const parsedValue = parseExprLiteral(m[3])
    if (parsedValue === null) return null
    return {
      source: m[1] as 'param' | 'header',
      path: m[2],
      mode: MATCH_EQ,
      value: parsedValue.value,
      valueKind: parsedValue.kind,
    }
  }

  return null
}

function tryParseTimeRangePair(
  lower: string,
  upper: string
): RequestCondition | null {
  const a = tryParseTimeCondition(lower)
  const b = tryParseTimeCondition(upper)
  if (!a || !b || a.source !== 'time' || b.source !== 'time') return null
  const ta = a as TimeCondition
  const tb = b as TimeCondition
  if (ta.timeFunc !== tb.timeFunc || ta.timezone !== tb.timezone) return null
  if (ta.mode !== MATCH_GTE || tb.mode !== MATCH_LT) return null
  return {
    source: 'time',
    timeFunc: ta.timeFunc,
    timezone: ta.timezone,
    mode: MATCH_RANGE,
    value: '',
    rangeStart: ta.value,
    rangeEnd: tb.value,
    rangeOp: RANGE_OP_AND,
  }
}

/** One AND-clause of a request-rule condition set. */
function tryParseRequestClause(
  conditionStr: string
): RequestCondition[] | null {
  // A branch may arrive parenthesized (`(a && b) || (c)`, which is exactly what
  // the builder emits for a multi-branch group); unwrap before splitting so a
  // wrapped branch is not mistaken for an unknown condition shape.
  const trimmed = unwrapExpressionParens(conditionStr)
  // A single time range like hour(tz) >= 9 && hour(tz) < 12 must stay one
  // MATCH_RANGE condition instead of being split into two scalar conditions.
  const wholeTimeCond = tryParseTimeCondition(trimmed)
  if (wholeTimeCond) return [wholeTimeCond]
  // A param CONTAINS is emitted as `param("x") != nil && has(param("x"), "y")`
  // — one condition that spans an `&&`, so the whole clause is tried before the
  // AND split would tear the nil-guard away from its has().
  const wholeCondition = tryParseRequestCondition(trimmed)
  if (wholeCondition) return [wholeCondition]

  const andParts = splitTopLevelAnd(trimmed).map((part) =>
    unwrapExpressionParens(part)
  )
  const conditions: RequestCondition[] = []
  for (let i = 0; i < andParts.length; i += 1) {
    const part = andParts[i]
    // Adjacent matching time bounds (fn >= X && fn < Y) form one range; merge
    // them so the visual editor keeps a single MATCH_RANGE row even when
    // other conditions follow in the same group.
    const next = i + 1 < andParts.length ? andParts[i + 1] : ''
    const merged = next ? tryParseCompoundPair(part, next) : null
    if (merged) {
      conditions.push(merged)
      i += 1
      continue
    }
    const condition = tryParseRequestCondition(part)
    if (!condition) return null
    conditions.push(condition)
  }
  return conditions.length > 0 ? conditions : null
}

/**
 * Parse a request-rule condition set into a DNF. `a && b || c` reads as
 * `(a && b) || c`: branches split on top-level `||` first, so an OR is never
 * silently collapsed into the AND-clause of another branch.
 */
/**
 * `param("x") != nil && has(param("x"), "y")` is one CONTAINS condition that
 * spans an `&&`. Recombine the pair after the AND split so the nil-guard is
 * not dropped (a bare `has(param(...))` would match on absent params too).
 */
function tryParseParamContainsPair(
  lower: string,
  upper: string
): RequestCondition | null {
  const guard = lower.match(/^param\("([^"]+)"\) != nil$/)
  if (!guard) return null
  const contains = upper.match(
    /^has\(param\("([^"]+)"\), ("(?:[^"\\]|\\.)*")\)$/
  )
  if (!contains || contains[1] !== guard[1]) return null
  return {
    source: 'param',
    path: guard[1],
    mode: MATCH_CONTAINS,
    value: JSON.parse(contains[2]) as string,
  }
}

/**
 * `param("x") != nil && param("x") >= N` is one numeric comparison that spans
 * an `&&`. Recombine the pair after the AND split so the nil-guard survives.
 */
function tryParseParamComparisonPair(
  lower: string,
  upper: string
): RequestCondition | null {
  const guard = lower.match(/^param\("([^"]+)"\) != nil$/)
  if (!guard) return null
  const comparison = upper.match(
    /^param\("([^"]+)"\) (>|>=|<|<=) ([\d.eE+-]+)$/
  )
  if (!comparison || comparison[1] !== guard[1]) return null
  const opMap: Record<string, string> = {
    '>': MATCH_GT,
    '>=': MATCH_GTE,
    '<': MATCH_LT,
    '<=': MATCH_LTE,
  }
  return {
    source: 'param',
    path: guard[1],
    mode: opMap[comparison[2]],
    value: comparison[3],
  }
}

/**
 * Recombine a condition the builder writes as two AND-ed atoms, from the
 * fragments the AND split produced.
 */
function tryParseCompoundPair(
  lower: string,
  upper: string
): RequestCondition | null {
  return (
    tryParseTimeRangePair(lower, upper) ??
    tryParseParamContainsPair(lower, upper) ??
    tryParseParamComparisonPair(lower, upper)
  )
}

function tryParseRequestConditions(conditionStr: string): RequestDnf | null {
  // An overnight window (hour(tz) >= 22 || hour(tz) < 6) is one MATCH_RANGE
  // condition carrying its source operator, not two OR branches.
  const wholeTimeCond = tryParseTimeCondition(conditionStr.trim())
  if (wholeTimeCond) return [{ conditions: [wholeTimeCond] }]

  const branches = splitTopLevelOr(conditionStr)
  const dnf: RequestDnf = []
  for (const branch of branches) {
    const conditions = tryParseRequestClause(branch)
    if (!conditions) return null
    dnf.push({ conditions })
  }
  return dnf.length > 0 ? dnf : null
}

function tryParseRuleGroupFactor(part: string): RequestRuleGroup | null {
  const m = part.match(/^\((.+) \? ([\d.eE+-]+) : 1\)$/s)
  if (!m) return null

  const conditions = tryParseRequestConditions(m[1])
  if (!conditions) return null
  return { conditions, multiplier: m[2] }
}

export function requestRuleGroupsFromTrace(
  requestRules: RequestRuleTrace[]
): RequestRuleGroup[] {
  return requestRules.map((rule) => {
    const conditionText = rule.cond.trim()
    return {
      conditions: tryParseRequestConditions(conditionText) || [],
      multiplier: String(rule.multiplier),
      conditionText,
      matched: rule.matched,
    }
  })
}

export function tryParseRequestRuleExpr(
  expr: string
): RequestRuleGroup[] | null {
  const trimmed = (expr || '').trim()
  if (!trimmed) return []

  const parts = splitTopLevelMultiply(trimmed)
  const groups: RequestRuleGroup[] = []
  for (const part of parts) {
    const group = tryParseRuleGroupFactor(part)
    if (!group) return null
    groups.push(group)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Combine / split billing expr and request rules
// ---------------------------------------------------------------------------

function unwrapOuterParens(expr: string): string {
  return unwrapExpressionParens(expr)
}

export function splitBillingExprAndRequestRules(expr: string): {
  billingExpr: string
  requestRuleExpr: string
} {
  const trimmed = (expr || '').trim()
  if (!trimmed) return { billingExpr: '', requestRuleExpr: '' }

  const parts = splitTopLevelMultiply(trimmed)
  if (parts.length <= 1) return { billingExpr: trimmed, requestRuleExpr: '' }

  const ruleParts: string[] = []
  const baseParts: string[] = []

  parts.forEach((part) => {
    const parsed = tryParseRequestRuleExpr(part)
    const compiled = compileBillingExpression(part)
    const traced =
      compiled.status === 'ready' &&
      compiled.requestRules.some((rule) => rule.node === compiled.ast)
    if ((parsed && parsed.length > 0) || traced) {
      ruleParts.push(part)
    } else {
      baseParts.push(part)
    }
  })

  const quantityParts = baseParts.filter(
    (part) => unwrapOuterParens(part) === 'image_count'
  )
  if (ruleParts.length === 0 || baseParts.length - quantityParts.length !== 1) {
    return { billingExpr: trimmed, requestRuleExpr: '' }
  }

  return {
    billingExpr: baseParts.map(unwrapOuterParens).join(' * '),
    requestRuleExpr: ruleParts.join(' * '),
  }
}

export function combineBillingExpr(
  baseExpr: string,
  requestRuleExpr: string
): string {
  const base = (baseExpr || '').trim()
  const rules = (requestRuleExpr || '').trim()
  if (!base) return ''
  if (!rules) return base
  return `(${base}) * ${rules}`
}

// ---------------------------------------------------------------------------
// Editor: empty constructors
// ---------------------------------------------------------------------------

export function createEmptyCondition(): ParamHeaderCondition {
  return { source: 'param', path: '', mode: MATCH_EQ, value: '' }
}

export function createEmptyTimeCondition(): TimeCondition {
  return {
    source: 'time',
    timeFunc: 'hour',
    timezone: 'Asia/Shanghai',
    mode: MATCH_GTE,
    value: '',
    rangeStart: '',
    rangeEnd: '',
  }
}

/**
 * Wrap a flat list of conditions as a single AND-clause DNF. Authoring sites
 * (presets, defaults) use it to keep the common single-branch case terse.
 */
export function andClause<T>(...conditions: T[]): Dnf<T> {
  return [{ conditions }]
}

export function createEmptyRuleGroup(): RequestRuleGroup {
  return {
    conditions: [{ conditions: [createEmptyCondition()] }],
    multiplier: '',
  }
}

export function createEmptyTimeRuleGroup(): RequestRuleGroup {
  return {
    conditions: [{ conditions: [createEmptyTimeCondition()] }],
    multiplier: '',
  }
}

// ---------------------------------------------------------------------------
// Editor: match option helpers
// ---------------------------------------------------------------------------

export type MatchOption = { value: string; labelKey: string }

export function getRequestRuleMatchOptions(source: string): MatchOption[] {
  if (source === SOURCE_TIME) {
    return [
      { value: MATCH_EQ, labelKey: 'Equals' },
      { value: MATCH_GTE, labelKey: 'Greater than or equal' },
      { value: MATCH_LT, labelKey: 'Less than' },
      { value: MATCH_RANGE, labelKey: 'Overnight range' },
    ]
  }
  const base: MatchOption[] = [
    { value: MATCH_EQ, labelKey: 'Equals' },
    { value: MATCH_CONTAINS, labelKey: 'Contains' },
    { value: MATCH_EXISTS, labelKey: 'Exists' },
  ]
  if (source === SOURCE_HEADER) return base
  return [
    ...base,
    { value: MATCH_GT, labelKey: 'Greater than' },
    { value: MATCH_GTE, labelKey: 'Greater than or equal' },
    { value: MATCH_LT, labelKey: 'Less than' },
    { value: MATCH_LTE, labelKey: 'Less than or equal' },
  ]
}

// ---------------------------------------------------------------------------
// Editor: normalize a single condition
// ---------------------------------------------------------------------------

function isTimeFunc(value: unknown): value is TimeFunc {
  return typeof value === 'string' && TIME_FUNCS.includes(value as TimeFunc)
}

function isRangeOp(value: unknown): value is RangeOp {
  return value === RANGE_OP_AND || value === RANGE_OP_OR
}

function isValueKind(
  value: unknown
): value is 'string' | 'number' | 'boolean' {
  return value === 'string' || value === 'number' || value === 'boolean'
}

export function normalizeCondition(
  cond: Partial<RequestCondition> | null | undefined
): RequestCondition {
  let source: RequestCondition['source'] = 'param'
  if (cond?.source === 'time') {
    source = 'time'
  } else if (cond?.source === 'header') {
    source = 'header'
  }

  if (source === 'time') {
    const timeCond = cond as Partial<TimeCondition> | null | undefined
    const timeFunc: TimeFunc = isTimeFunc(timeCond?.timeFunc)
      ? timeCond.timeFunc
      : 'hour'
    const options = getRequestRuleMatchOptions(SOURCE_TIME)
    const mode = options.some((item) => item.value === timeCond?.mode)
      ? (timeCond?.mode as string)
      : MATCH_GTE
    return {
      source: 'time',
      timeFunc,
      timezone: timeCond?.timezone || 'Asia/Shanghai',
      mode,
      value: timeCond?.value == null ? '' : String(timeCond.value),
      rangeStart:
        timeCond?.rangeStart == null ? '' : String(timeCond.rangeStart),
      rangeEnd: timeCond?.rangeEnd == null ? '' : String(timeCond.rangeEnd),
      // Keep the parsed source operator: dropping it here would make the
      // builder fall back to the bounds heuristic and flip an overnight
      // `||` window into a never-matching `&&` on save.
      ...(mode === MATCH_RANGE && isRangeOp(timeCond?.rangeOp)
        ? { rangeOp: timeCond.rangeOp }
        : {}),
    }
  }

  const phCond = cond as Partial<ParamHeaderCondition> | null | undefined
  const options = getRequestRuleMatchOptions(source)
  const mode = options.some((item) => item.value === phCond?.mode)
    ? (phCond?.mode as string)
    : MATCH_EQ
  return {
    source,
    path: phCond?.path || '',
    mode,
    value: phCond?.value == null ? '' : String(phCond.value),
    ...(isValueKind(phCond?.valueKind) ? { valueKind: phCond.valueKind } : {}),
  }
}

// ---------------------------------------------------------------------------
// Editor: build expression strings
// ---------------------------------------------------------------------------

function buildExprLiteral(
  mode: string,
  value: string,
  valueKind?: 'string' | 'number' | 'boolean'
): string {
  const text = String(value || '').trim()
  if (mode === MATCH_CONTAINS) return JSON.stringify(text)
  // A parsed condition remembers the literal kind it was written with, so
  // `param("x") == "true"` (a string) must not round-trip into `== true`.
  if (valueKind === 'string') return JSON.stringify(text)
  if (valueKind === 'boolean') {
    return text === 'true' || text === 'false' ? text : JSON.stringify(text)
  }
  if (valueKind === 'number') {
    return NUMERIC_LITERAL_REGEX.test(text) ? text : JSON.stringify(text)
  }
  if (text === 'true' || text === 'false') return text
  if (NUMERIC_LITERAL_REGEX.test(text)) return text
  return JSON.stringify(text)
}

function buildTimeConditionExpr(cond: TimeCondition): string {
  const normalized = normalizeCondition(cond) as TimeCondition
  const { timeFunc, timezone, mode } = normalized
  const tz = JSON.stringify(timezone)
  const fn = `${timeFunc}(${tz})`

  if (mode === MATCH_RANGE) {
    const s = normalized.rangeStart.trim()
    const e = normalized.rangeEnd.trim()
    if (!isTimeValueInRange(timeFunc, s) || !isTimeValueInRange(timeFunc, e)) {
      return ''
    }
    // The source operator wins when the range came from a parsed expression:
    // rewriting `fn >= 9 || fn < 12` as `&&` would silently change its meaning.
    // Ranges authored in the editor carry no `rangeOp`, so the bounds decide —
    // start > end is an overnight window (21-6), start <= end a within-day one.
    const overnight =
      normalized.rangeOp === undefined
        ? Number(s) > Number(e)
        : normalized.rangeOp === RANGE_OP_OR
    return overnight
      ? `${fn} >= ${s} || ${fn} < ${e}`
      : `${fn} >= ${s} && ${fn} < ${e}`
  }
  const v = normalized.value.trim()
  if (!isTimeValueInRange(timeFunc, v)) return ''
  const opMap: Record<string, string> = {
    [MATCH_EQ]: '==',
    [MATCH_GTE]: '>=',
    [MATCH_LT]: '<',
  }
  return `${fn} ${opMap[mode] || '=='} ${v}`
}

function buildRequestConditionExpr(cond: RequestCondition): string {
  if (cond.source === 'time') return buildTimeConditionExpr(cond)
  const normalized = normalizeCondition(cond) as ParamHeaderCondition
  const path = normalized.path.trim()
  if (!path) return ''

  const sourceExpr =
    normalized.source === 'header'
      ? `header(${JSON.stringify(path)})`
      : `param(${JSON.stringify(path)})`

  switch (normalized.mode) {
    case MATCH_EXISTS:
      return normalized.source === 'header'
        ? `${sourceExpr} != ""`
        : `${sourceExpr} != nil`
    case MATCH_CONTAINS:
      return normalized.source === 'header'
        ? `has(${sourceExpr}, ${buildExprLiteral(normalized.mode, normalized.value)})`
        : `${sourceExpr} != nil && has(${sourceExpr}, ${buildExprLiteral(normalized.mode, normalized.value)})`
    case MATCH_GT:
    case MATCH_GTE:
    case MATCH_LT:
    case MATCH_LTE: {
      const opMap: Record<string, string> = {
        [MATCH_GT]: '>',
        [MATCH_GTE]: '>=',
        [MATCH_LT]: '<',
        [MATCH_LTE]: '<=',
      }
      const numText = String(normalized.value).trim()
      if (!NUMERIC_LITERAL_REGEX.test(numText)) return ''
      return `${sourceExpr} != nil && ${sourceExpr} ${opMap[normalized.mode]} ${numText}`
    }
    case MATCH_EQ:
    default:
      return `${sourceExpr} == ${buildExprLiteral(normalized.mode, normalized.value, normalized.valueKind)}`
  }
}

function buildRuleGroupFactor(group: RequestRuleGroup): string {
  const multiplier = (group.multiplier || '').trim()
  if (!NUMERIC_LITERAL_REGEX.test(multiplier)) return ''
  // Each branch is an AND-clause; the branches themselves are OR-ed. A clause
  // that is empty contributes nothing and drops the whole group (the previous
  // flat model treated a missing condition the same way).
  const branches = (group.conditions || [])
    .map((clause) => {
      const parts = (clause.conditions || [])
        .map(buildRequestConditionExpr)
        .filter(Boolean)
      if (parts.length === 0) return ''
      if (parts.length === 1) return parts[0]
      return parts
        .map((expr) => (expr.includes(' || ') ? `(${expr})` : expr))
        .join(' && ')
    })
    .filter(Boolean)
  if (branches.length === 0) return ''

  const combined =
    branches.length === 1
      ? branches[0]
      : branches.map((branch) => `(${branch})`).join(' || ')
  return `(${combined} ? ${multiplier} : 1)`
}

export function buildRequestRuleExpr(groups: RequestRuleGroup[]): string {
  return (groups || []).map(buildRuleGroupFactor).filter(Boolean).join(' * ')
}
