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
 * The grammar is intentionally narrow: we only support the shapes that the
 * server emits (tiered pricing + request-rule conditional multipliers), so
 * the regular expressions are exact rather than tolerant of arbitrary
 * expression syntax.
 */

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

/** Vars valid in tier conditions (all billing variables). */
export const BILLING_CONDITION_VARS: string[] = BILLING_VARS.map((v) => v.key)

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
}

export type RequestCondition = TimeCondition | ParamHeaderCondition

// A condition set is a DNF: an OR of AND-clauses ("branches"). `[]` means the
// empty DNF (always true) — only valid on the fallback tier.
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

export type TierConditionVar =
  | 'p'
  | 'c'
  | 'len'
  | 'cr'
  | 'cc'
  | 'cc1h'
  | 'img'
  | 'img_o'
  | 'ai'
  | 'ao'
export type TierCompareOp = '<' | '<=' | '>' | '>='
export type TierCondition = {
  var: TierConditionVar
  op: TierCompareOp
  value: number
}
export type TierConditionDnf = Dnf<TierCondition>

export type ParsedTier = {
  label: string
  conditions: TierConditionDnf
  /** The last bare tier in the chain; every other tier is conditional. */
  isFallback: boolean
  [field: string]: unknown
}

// ---------------------------------------------------------------------------
// Tier parser
// ---------------------------------------------------------------------------

function stripExprVersion(exprStr: string): { version: number; body: string } {
  if (!exprStr) return { version: 1, body: '' }
  const m = exprStr.match(/^v(\d+):([\s\S]*)$/)
  if (m) return { version: Number(m[1]), body: m[2] }
  return { version: 1, body: exprStr }
}

function parseTierBody(bodyStr: string): Record<string, number> {
  const coeffs: Record<string, number> = {}
  // Split on top-level ` + ` and accept only clean `var * number` terms, so a
  // hand-written body with e.g. `max(p * 1, c * 2)` ignores the non-linear term
  // instead of letting its first occurrence win.
  for (const term of splitTopLevelToken(bodyStr, ' + ')) {
    const m = term.match(
      /^(p|c|len|cr|cc|cc1h|img|img_o|ai|ao)\s*\*\s*([\d.eE+-]+)$/
    )
    if (m && !(m[1] in coeffs)) coeffs[m[1]] = Number(m[2])
  }
  const tier: Record<string, number> = {}
  for (const [varName, field] of Object.entries(BILLING_VAR_KEY_TO_FIELD)) {
    tier[field] = coeffs[varName] || 0
  }
  return tier
}

// Match `tier("label", body)` with balanced parens so a body containing a
// function call (e.g. `max(p * 1, c * 2)`) is captured whole instead of being
// cut at the first `)`. Returns null when the string is not exactly one tier
// call (including trailing content).
function matchTierCall(expr: string): { label: string; body: string } | null {
  const m = expr.match(/^tier\("([^"]*)",\s*/)
  if (!m) return null
  const rest = expr.slice(m[0].length)
  let depth = 0
  let inString = false
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest[i]
    if (c === '"' && !isEscaped(rest, i)) inString = !inString
    if (!inString) {
      if (c === '(') depth += 1
      else if (c === ')') {
        if (depth === 0) {
          if (rest.slice(i + 1).trim() !== '') return null
          return { label: m[1], body: rest.slice(0, i).trim() }
        }
        depth -= 1
      }
    }
  }
  return null
}

// The implicit zero-cost fallback `p * 0 + c * 0` emitted for a lone
// conditional tier (`cond ? tier(...) : p * 0 + c * 0`).
function isZeroFallbackExpr(seg: string): boolean {
  return /^p\s*\*\s*0\s*\+\s*c\s*\*\s*0(?:\s*\+\s*[a-z0-9_]+\s*\*\s*0)*$/.test(
    seg.trim()
  )
}

function tryParseTierConditionAtom(str: string): TierCondition | null {
  const m = str
    .trim()
    .match(
      /^(p|c|len|cr|cc|cc1h|img|img_o|ai|ao)\s*(<|<=|>|>=)\s*([\d.eE+-]+)$/
    )
  if (!m) return null
  return {
    var: m[1] as TierConditionVar,
    op: m[2] as TierCompareOp,
    value: Number(m[3]),
  }
}

/**
 * Parse a tier-condition string into a DNF of AND-clauses. `''`/empty parses to
 * `[]` (always true) — valid only on the fallback tier.
 */
export function parseDnfTierConditions(
  conditionStr: string
): TierConditionDnf | null {
  const trimmed = (conditionStr || '').trim()
  if (!trimmed) return []
  const branches = splitTopLevelOr(trimmed)
  const dnf: TierConditionDnf = []
  for (const branch of branches) {
    const atoms = splitTopLevelAnd(unwrapOuterParens(branch))
    if (atoms.length === 0) return null
    const clause: TierCondition[] = []
    for (const atom of atoms) {
      const parsed = tryParseTierConditionAtom(atom)
      if (!parsed) return null
      clause.push(parsed)
    }
    dnf.push({ conditions: clause })
  }
  return dnf
}

/**
 * Parse a flat tier chain `cond0 ? tier(...) : cond1 ? tier(...) : tier(...)`.
 * The last bare segment (a tier call or the implicit `p * 0 + c * 0`) is the
 * fallback. Returns null for nested ternaries or segments that don't fit the
 * flat shape, so the caller can keep such expressions in raw mode instead of
 * dropping content.
 */
export function parseTierChain(body: string): ParsedTier[] | null {
  const segments = splitTopLevelColon(body)
  if (segments.length === 0) return null
  const tiers: ParsedTier[] = []
  for (const segment of segments) {
    const seg = unwrapOuterParens(segment)
    // A remaining top-level ` : ` means a nested ternary — outside the flat
    // visual model. Refuse the whole chain rather than drop content.
    if (splitTopLevelColon(seg).length > 1) return null
    const questionParts = splitTopLevelQuestion(seg)
    let condStr: string
    let bodyStr: string
    if (questionParts.length === 1) {
      condStr = ''
      bodyStr = questionParts[0]
    } else if (questionParts.length === 2) {
      condStr = questionParts[0]
      bodyStr = questionParts[1]
    } else {
      return null
    }
    const conditions = parseDnfTierConditions(condStr)
    if (!conditions) return null
    let tier: ParsedTier
    if (questionParts.length === 1 && isZeroFallbackExpr(bodyStr)) {
      tier = parseTierBody('') as ParsedTier
      tier.label = ''
    } else {
      const call = matchTierCall(bodyStr)
      if (!call) return null
      tier = parseTierBody(call.body) as ParsedTier
      tier.label = call.label
    }
    tier.conditions = conditions
    tier.isFallback = false
    tiers.push(tier)
  }
  if (tiers.length > 0) tiers[tiers.length - 1].isFallback = true
  return tiers
}

export function parseTiersFromExpr(exprStr: string): ParsedTier[] {
  if (!exprStr) return []
  try {
    const { body } = stripExprVersion(exprStr)
    return parseTierChain(body) || []
  } catch {
    return []
  }
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
  const parts: string[] = []
  let start = 0
  let depth = 0
  let inString = false
  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index]
    if (char === '"' && !isEscaped(expr, index)) inString = !inString
    if (!inString) {
      if (char === '(') depth += 1
      if (char === ')') depth -= 1
      if (depth === 0 && expr.slice(index, index + 3) === ' * ') {
        parts.push(expr.slice(start, index).trim())
        start = index + 3
        index += 2
      }
    }
  }
  parts.push(expr.slice(start).trim())
  return parts.filter(Boolean)
}

// Split `expr` on `token` (e.g. `' && '`, `' || '`, `' : '`, `' ? '`) at depth 0,
// ignoring content inside parentheses and quoted string literals.
function splitTopLevelToken(expr: string, token: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let inString = false
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i]
    if (c === '"' && !isEscaped(expr, i)) inString = !inString
    if (!inString) {
      if (c === '(') depth += 1
      if (c === ')') depth -= 1
      if (depth === 0 && expr.startsWith(token, i)) {
        parts.push(expr.slice(start, i).trim())
        start = i + token.length
        i += token.length - 1
      }
    }
  }
  parts.push(expr.slice(start).trim())
  return parts.filter(Boolean)
}

function splitTopLevelAnd(expr: string): string[] {
  return splitTopLevelToken(expr, ' && ')
}

function splitTopLevelOr(expr: string): string[] {
  return splitTopLevelToken(expr, ' || ')
}

function splitTopLevelColon(expr: string): string[] {
  return splitTopLevelToken(expr, ' : ')
}

function splitTopLevelQuestion(expr: string): string[] {
  return splitTopLevelToken(expr, ' ? ')
}

// A `"` delimits a string only when preceded by an even number of backslashes
// (odd count means the quote is escaped, e.g. `"a\"b"`).
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function parseExprLiteral(
  raw: string
): { value: string; kind: 'string' | 'number' | 'boolean' } | null {
  const text = raw.trim()
  if (text === 'true' || text === 'false') return { value: text, kind: 'boolean' }
  if (NUMERIC_LITERAL_REGEX.test(text)) return { value: text, kind: 'number' }
  try {
    const parsed = JSON.parse(text) as string
    return { value: String(parsed), kind: 'string' }
  } catch {
    return null
  }
}

function tryParseTimeCondition(expr: string): RequestCondition | null {
  let m = expr.match(
    /^(hour|minute|weekday|month|day)\("([^"]+)"\) >= ([\d.eE+-]+) \|\| \1\("\2"\) < ([\d.eE+-]+)$/
  )
  if (m) {
    return {
      source: 'time',
      timeFunc: m[1] as TimeFunc,
      timezone: m[2],
      mode: MATCH_RANGE,
      value: '',
      rangeStart: m[3],
      rangeEnd: m[4],
    }
  }
  m = expr.match(
    /^\((hour|minute|weekday|month|day)\("([^"]+)"\) >= ([\d.eE+-]+) \|\| \1\("\2"\) < ([\d.eE+-]+)\)$/
  )
  if (m) {
    return {
      source: 'time',
      timeFunc: m[1] as TimeFunc,
      timezone: m[2],
      mode: MATCH_RANGE,
      value: '',
      rangeStart: m[3],
      rangeEnd: m[4],
    }
  }
  m = expr.match(
    /^(hour|minute|weekday|month|day)\("([^"]+)"\) (==|>=|<) ([\d.eE+-]+)$/
  )
  if (m) {
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

// The editor emits a param numeric comparison or substring check as one
// condition guarded by a nil check: `param("X") != nil && param("X") >= 5` and
// `param("X") != nil && has(param("X"), "v")`. After `splitTopLevelAnd` the
// guard and the assertion land in separate `&&` parts; stitch them back into a
// single condition when the unparseable part asserts on the same path as the
// preceding exists guard.
function tryMergeParamAssertion(
  conditions: RequestCondition[],
  part: string
): ParamHeaderCondition | null {
  const prev = conditions[conditions.length - 1]
  if (!prev || prev.source !== 'param' || prev.mode !== MATCH_EXISTS) {
    return null
  }
  let m = part.match(/^has\(param\("([^"]+)"\), ((?:"(?:[^"\\]|\\.)*"))\)$/)
  if (m && m[1] === prev.path) {
    return {
      source: 'param',
      path: m[1],
      mode: MATCH_CONTAINS,
      value: JSON.parse(m[2]) as string,
    }
  }
  m = part.match(/^param\("([^"]+)"\) (>|>=|<|<=) ([\d.eE+-]+)$/)
  if (m && m[1] === prev.path) {
    const opMap: Record<string, string> = {
      '>': MATCH_GT,
      '>=': MATCH_GTE,
      '<': MATCH_LT,
      '<=': MATCH_LTE,
    }
    return { source: 'param', path: m[1], mode: opMap[m[2]], value: m[3] }
  }
  return null
}

/**
 * Parse a request-condition string into a DNF of AND-clauses. A whole-string
 * single condition (including an overnight RANGE, which contains `||` but is one
 * window, not an OR) is tried first; otherwise top-level `||` splits into OR
 * branches. Any unparseable atom fails the whole group (all-or-nothing) so
 * nothing is silently dropped.
 */
export function parseDnfRequestConditions(
  conditionStr: string
): RequestDnf | null {
  const trimmed = (conditionStr || '').trim()
  if (!trimmed) return null

  // RANGE-first: the RANGE regexes are tried before any DNF `||` split.
  const whole = tryParseRequestCondition(trimmed)
  if (whole) return [{ conditions: [whole] }]

  const branches = splitTopLevelOr(trimmed)
  const dnf: RequestDnf = []
  for (const branch of branches) {
    const andParts = splitTopLevelAnd(unwrapOuterParens(branch))
    if (andParts.length === 0) return null
    const clause: RequestCondition[] = []
    for (const part of andParts) {
      // The serializer wraps any atom whose value contains `||` in parens when
      // ANDing it with others (e.g. `(has(param("a"), "x || y"))`); unwrap the
      // atom before matching so the parens are grouping, not part of the token.
      const trimmedPart = unwrapOuterParens(part).trim()
      const condition = tryParseRequestCondition(trimmedPart)
      if (condition) {
        clause.push(condition)
        continue
      }
      const merged = tryMergeParamAssertion(clause, trimmedPart)
      if (!merged) return null
      // Replace the exists guard with the folded single condition.
      clause[clause.length - 1] = merged
    }
    dnf.push({ conditions: clause })
  }
  return dnf
}

function tryParseRuleGroupFactor(part: string): RequestRuleGroup | null {
  const m = part.match(/^\((.+) \? ([\d.eE+-]+) : 1\)$/s)
  if (!m) return null

  const conditions = parseDnfRequestConditions(m[1])
  if (!conditions) return null
  return { conditions, multiplier: m[2] }
}

export function requestRuleGroupsFromTrace(
  requestRules: RequestRuleTrace[]
): RequestRuleGroup[] {
  return requestRules.map((rule) => {
    const conditionText = rule.cond.trim()
    return {
      conditions: parseDnfRequestConditions(conditionText) || [],
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

// Full-wrap detection must be quote-aware: a `)` inside a string literal (e.g.
// a param value `"foo ? 2 : 1)"`) would otherwise close the outer paren early,
// so unwrapOuterParens would refuse to unwrap a branch that IS fully wrapped.
function hasFullOuterParens(expr: string): boolean {
  if (!expr.startsWith('(') || !expr.endsWith(')')) return false
  let depth = 0
  let inString = false
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i]
    if (c === '"' && !isEscaped(expr, i)) inString = !inString
    if (!inString) {
      if (c === '(') depth += 1
      if (c === ')') depth -= 1
      if (depth === 0 && i < expr.length - 1) return false
    }
  }
  return depth === 0
}

function unwrapOuterParens(expr: string): string {
  let current = (expr || '').trim()
  while (hasFullOuterParens(current)) {
    current = current.slice(1, -1).trim()
  }
  return current
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
    if (parsed && parsed.length > 0) {
      ruleParts.push(part)
    } else {
      baseParts.push(part)
    }
  })

  if (ruleParts.length === 0 || baseParts.length !== 1) {
    return { billingExpr: trimmed, requestRuleExpr: '' }
  }

  return {
    billingExpr: unwrapOuterParens(baseParts[0]),
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
    valueKind: phCond?.valueKind,
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
  const raw = String(value ?? '')
  // String-kind values are exact: preserve leading/trailing whitespace (a value
  // of `" foo "` must round-trip, not silently become `"foo"`). Numeric/boolean
  // kinds may trim.
  if (mode === MATCH_CONTAINS) return JSON.stringify(raw)
  if (valueKind === 'string') return JSON.stringify(raw)
  if (valueKind === 'boolean') {
    // A user-edited value that is no longer a boolean literal falls back to a
    // string comparison rather than silently serializing as `false`.
    const text = raw.trim()
    return text === 'true' || text === 'false' ? text : JSON.stringify(raw)
  }
  const text = raw.trim()
  if (NUMERIC_LITERAL_REGEX.test(text)) return text
  return JSON.stringify(raw)
}

function buildTimeConditionExpr(cond: TimeCondition): string {
  const normalized = normalizeCondition(cond) as TimeCondition
  const { timeFunc, timezone, mode } = normalized
  const tz = JSON.stringify(timezone)
  const fn = `${timeFunc}(${tz})`

  if (mode === MATCH_RANGE) {
    const s = normalized.rangeStart.trim()
    const e = normalized.rangeEnd.trim()
    if (!NUMERIC_LITERAL_REGEX.test(s) || !NUMERIC_LITERAL_REGEX.test(e)) {
      return ''
    }
    return `${fn} >= ${s} || ${fn} < ${e}`
  }
  const v = normalized.value.trim()
  if (!NUMERIC_LITERAL_REGEX.test(v)) return ''
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
      return `${sourceExpr} == ${buildExprLiteral(
        normalized.mode,
        normalized.value,
        normalized.valueKind
      )}`
  }
}

/**
 * Serialize a tier-condition DNF. `[]` → `''`; one AND-clause emits its atoms
 * without parens (byte-identical to the legacy flat form, so no-OR tiers
 * round-trip unchanged); 2+ clauses emit `(c1 && c2) || (c3)`.
 */
export function buildTierDnfExpr(
  dnf: TierConditionDnf | null | undefined
): string {
  const clauses = (dnf || [])
    .map((clause) =>
      (clause.conditions || [])
        .map((c) => `${c.var} ${c.op} ${c.value}`)
        .join(' && ')
    )
    .filter(Boolean)
  if (clauses.length === 0) return ''
  if (clauses.length === 1) return clauses[0]
  return clauses.map((c) => `(${c})`).join(' || ')
}

/**
 * Serialize a request-condition DNF. Within a clause a RANGE atom (`||` inside)
 * keeps its parens when ANDed with others; 2+ clauses emit `(A) || (B)`.
 */
export function buildRequestDnfExpr(
  dnf: RequestDnf | null | undefined
): string {
  const clauses = (dnf || [])
    .map((clause) => {
      const condExprs = (clause.conditions || [])
        .map(buildRequestConditionExpr)
        .filter(Boolean)
      if (condExprs.length === 0) return ''
      return condExprs.length === 1
        ? condExprs[0]
        : condExprs.map((e) => (e.includes(' || ') ? `(${e})` : e)).join(' && ')
    })
    .filter(Boolean)
  if (clauses.length === 0) return ''
  if (clauses.length === 1) return clauses[0]
  return clauses.map((c) => `(${c})`).join(' || ')
}

function buildRuleGroupFactor(group: RequestRuleGroup): string {
  const multiplier = (group.multiplier || '').trim()
  if (!NUMERIC_LITERAL_REGEX.test(multiplier)) return ''
  const condExpr = buildRequestDnfExpr(group.conditions)
  if (!condExpr) return ''
  return `(${condExpr} ? ${multiplier} : 1)`
}

export function buildRequestRuleExpr(groups: RequestRuleGroup[]): string {
  return (groups || []).map(buildRuleGroupFactor).filter(Boolean).join(' * ')
}
