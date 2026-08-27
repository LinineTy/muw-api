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
import {
  BILLING_VARS,
  MATCH_CONTAINS,
  MATCH_EQ,
  MATCH_EXISTS,
  MATCH_GTE,
  MATCH_GT,
  MATCH_LT,
  MATCH_LTE,
  MATCH_RANGE,
  SOURCE_TIME,
  type Dnf,
  type RequestCondition,
  type RequestDnf,
  type TierCondition,
  type TimeCondition,
  type TimeFunc,
} from './billing-expr'

export type TranslateFn = (key: string) => string

const TIME_FUNC_LABELS: Record<string, string> = {
  hour: 'Hour',
  minute: 'Minute',
  weekday: 'Weekday',
  month: 'Month',
  day: 'Day',
}

export const TIME_FUNC_PRIORITY: Record<string, number> = {
  hour: 0,
  minute: 1,
  weekday: 2,
  day: 3,
  month: 4,
}

// Valid integer ranges returned by the backend time functions
// (`pkg/billingexpr/run.go`): hour 0-23, minute 0-59, weekday 0-6
// (Sunday=0, per time.Weekday), month 1-12, day 1-31. Values outside these
// ranges make a comparison never (or trivially always) match.
export const TIME_FUNC_DOMAINS: Record<TimeFunc, { min: number; max: number }> =
  {
    hour: { min: 0, max: 23 },
    minute: { min: 0, max: 59 },
    weekday: { min: 0, max: 6 },
    month: { min: 1, max: 12 },
    day: { min: 1, max: 31 },
  }

export function formatRangeText(
  start: string,
  end: string,
  timeFunc: string
): string {
  const pad = timeFunc === 'hour' ? ':00' : ''
  return `${start}${pad}~${end}${pad}`
}

// Backend weekday values follow time.Weekday: 0=Sunday .. 6=Saturday. The day
// names are translated as bare day labels and composed by `Weekday range`, so
// the zh range "每周一~周五" doesn't repeat the 周 prefix.
const WEEKDAY_LABEL_KEYS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
}

/**
 * Day-name text for a weekday window. `start`/`end` come from the same weekly
 * cycle (0=Sunday), so a wrap `>= 5 && < 1` covers Fri(5), Sat(6), Sun(0) and
 * renders as 周五~周日. Falls back to raw numbers for out-of-domain input.
 */
export function weekdayRangeText(
  start: string,
  end: string,
  t: TranslateFn
): string {
  const s = Number(start)
  const e = Number(end)
  if (
    !Number.isInteger(s) ||
    !Number.isInteger(e) ||
    s < 0 ||
    s > 6 ||
    e < 0 ||
    e > 6
  ) {
    return formatRangeText(start, end, 'weekday')
  }
  const last = (((e - 1) % 7) + 7) % 7
  return t('Weekday range {{start}} to {{end}}')
    .replaceAll('{{start}}', t(WEEKDAY_LABEL_KEYS[s]))
    .replaceAll('{{end}}', t(WEEKDAY_LABEL_KEYS[last]))
}

export function timeFuncPrefix(timeFunc: string, t: TranslateFn): string {
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

function timeUnitSuffix(timeFunc: string, t: TranslateFn): string {
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

function hourRangeText(start: string, end: string, t: TranslateFn): string {
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

// A RANGE condition compiles to `fn(tz) >= start || fn(tz) < end` (OR). When
// `start <= end` every value satisfies one side, so the window is a tautology;
// render the two comparisons honestly instead of implying a contiguous range.
function tautologyRangeText(
  prefix: string,
  start: string,
  end: string,
  pad: string
): string {
  return `${prefix} ≥ ${start}${pad} · ${prefix} < ${end}${pad}`
}

function hourConditionText(cond: TimeCondition, t: TranslateFn): string {
  const prefix = t('Every day')
  if (cond.mode === MATCH_RANGE) {
    const startVal = Number(cond.rangeStart)
    const endVal = Number(cond.rangeEnd)
    if (
      Number.isFinite(startVal) &&
      Number.isFinite(endVal) &&
      startVal <= endVal
    ) {
      return tautologyRangeText(prefix, cond.rangeStart, cond.rangeEnd, ':00')
    }
    return `${prefix} ${hourRangeText(cond.rangeStart, cond.rangeEnd, t)}`
  }
  if (cond.mode === MATCH_EQ) return `${prefix} ${cond.value}:00`
  const op = cond.mode === MATCH_GTE ? '≥' : '<'
  return `${prefix} ${op} ${cond.value}:00`
}

function weekdayConditionText(cond: TimeCondition, t: TranslateFn): string {
  if (cond.mode === MATCH_EQ) {
    const day = Number(cond.value)
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      return t(`Every week on day ${day}`)
    }
    return `${t('Every week')} ${cond.value}`
  }
  const prefix = t('Every week')
  if (cond.mode === MATCH_RANGE) {
    const startVal = Number(cond.rangeStart)
    const endVal = Number(cond.rangeEnd)
    if (
      Number.isFinite(startVal) &&
      Number.isFinite(endVal) &&
      startVal <= endVal
    ) {
      return tautologyRangeText(prefix, cond.rangeStart, cond.rangeEnd, '')
    }
    return weekdayRangeText(cond.rangeStart, cond.rangeEnd, t)
  }
  const op = cond.mode === MATCH_GTE ? '≥' : '<'
  return `${prefix} ${op} ${cond.value}`
}

function recurringTimeConditionText(
  cond: TimeCondition,
  t: TranslateFn
): string {
  const prefix = timeFuncPrefix(cond.timeFunc, t)
  const unit = timeUnitSuffix(cond.timeFunc, t)
  if (cond.mode === MATCH_RANGE) {
    const startVal = Number(cond.rangeStart)
    const endVal = Number(cond.rangeEnd)
    if (
      Number.isFinite(startVal) &&
      Number.isFinite(endVal) &&
      startVal <= endVal
    ) {
      return tautologyRangeText(prefix, cond.rangeStart, cond.rangeEnd, unit)
    }
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

// Human-readable natural-language text for a single request condition, e.g.
// `每天 12:00~18:00`, `每周五`, `请求头 x 包含 "y"`. Shared by the model-square
// display and the pricing editor's live preview.
export function formatConditionText(
  cond: RequestCondition,
  t: TranslateFn
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

export function formatTokenHint(value: string | number): string {
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

const TIER_VAR_LABELS: Record<string, string> = Object.fromEntries(
  BILLING_VARS.map((v) => [v.key, v.shortLabel])
)
const TIER_OP_LABELS: Record<string, string> = {
  '<': '<',
  '<=': '≤',
  '>': '>',
  '>=': '≥',
}

export function formatTierConditionText(
  cond: TierCondition,
  t: TranslateFn
): string {
  const varLabel = t(TIER_VAR_LABELS[cond.var] || cond.var)
  const hint = formatTokenHint(cond.value)
  return `${varLabel} ${TIER_OP_LABELS[cond.op] || cond.op} ${hint || cond.value}`
}

/**
 * Natural-language text for a DNF condition set: atoms within a clause joined
 * by `clauseSeparator`, clauses (OR branches) joined by a localized OR word.
 */
export function formatDnfConditionText<T>(
  dnf: Dnf<T> | null | undefined,
  t: TranslateFn,
  opts: {
    atomText: (atom: T) => string
    clauseSeparator: string
  }
): string {
  if (!dnf || dnf.length === 0) return ''
  const branches = dnf
    .map((clause) =>
      (clause.conditions || [])
        .map(opts.atomText)
        .filter(Boolean)
        .join(opts.clauseSeparator)
    )
    .filter(Boolean)
  if (branches.length <= 1) return branches[0] || ''
  return branches.join(` ${t('OR')} `)
}

/** DNF formatter for request-rule conditions (chips use ` · ` within a clause). */
export function formatRequestDnfText(
  dnf: RequestDnf | null | undefined,
  t: TranslateFn
): string {
  return formatDnfConditionText(dnf, t, {
    atomText: (cond) => formatConditionText(cond, t),
    clauseSeparator: ' · ',
  })
}

/** DNF formatter for tier conditions (expression-style ` && ` within a clause). */
export function formatTierDnfText(
  dnf: Dnf<TierCondition> | null | undefined,
  t: TranslateFn
): string {
  return formatDnfConditionText(dnf, t, {
    atomText: (cond) => formatTierConditionText(cond, t),
    clauseSeparator: ' && ',
  })
}

export type ConditionIssue = {
  severity: 'error' | 'warning'
  /** i18n key of the message (English source string). */
  key: string
  params?: Record<string, string | number>
  /** Which OR branch the issue belongs to; undefined = group-level. */
  branchIndex?: number
  /** Index of the offending condition within the branch; undefined = branch-level. */
  conditionIndex?: number
}

const TIME_FUNC_DOMAIN_LABEL_KEYS: Record<TimeFunc, string> = {
  hour: 'Hour of day',
  minute: 'Minute',
  weekday: 'Weekday',
  month: 'Month number',
  day: 'Day of month',
}

/**
 * Static analysis of one request-rule group's DNF against the backend evaluator
 * semantics (`pkg/billingexpr/`). Per-atom domain checks run on every condition;
 * AND-conflict runs within each OR branch. A self-contradictory branch gets a
 * branch-level warning, and when every branch is dead the whole group is flagged.
 * Detects: out-of-domain values (weekday == 7 etc.), RANGE windows that are
 * actually tautologies (`start <= end`, because RANGE compiles to
 * `>= start || < end`), mutually exclusive conditions within the same
 * timeFunc+timezone, and incomplete conditions the serializer silently drops.
 */
function checkOneRequestCondition(
  cond: RequestCondition,
  t: TranslateFn,
  branchIndex: number,
  conditionIndex: number
): ConditionIssue[] {
  const issues: ConditionIssue[] = []
  if (cond.source !== SOURCE_TIME) {
    if (!cond.path || cond.path.trim() === '') {
      issues.push({
        severity: 'warning',
        key: 'This condition is incomplete and will be ignored when saved',
        branchIndex,
        conditionIndex,
      })
    }
    return issues
  }
  const domain = TIME_FUNC_DOMAINS[cond.timeFunc]
  if (!domain) return issues
  const label = t(TIME_FUNC_DOMAIN_LABEL_KEYS[cond.timeFunc] || cond.timeFunc)
  const rangeParams = { label, min: domain.min, max: domain.max }

  if (cond.mode === MATCH_RANGE) {
    const startVal = Number(cond.rangeStart)
    const endVal = Number(cond.rangeEnd)
    if (
      cond.rangeStart.trim() === '' ||
      cond.rangeEnd.trim() === '' ||
      !Number.isFinite(startVal) ||
      !Number.isFinite(endVal)
    ) {
      issues.push({
        severity: 'warning',
        key: 'This condition is incomplete and will be ignored when saved',
        branchIndex,
        conditionIndex,
      })
      return issues
    }
    if (startVal <= endVal) {
      issues.push({
        severity: 'error',
        key: 'The overnight range requires start > end. For a normal window, use a ≥ and a < condition instead.',
        branchIndex,
        conditionIndex,
      })
    } else if (startVal > domain.max && endVal <= domain.min) {
      issues.push({
        severity: 'error',
        key: '{{label}} must be between {{min}} and {{max}}',
        params: rangeParams,
        branchIndex,
        conditionIndex,
      })
    }
    return issues
  }

  if (cond.value.trim() === '') {
    issues.push({
      severity: 'warning',
      key: 'This condition is incomplete and will be ignored when saved',
      branchIndex,
      conditionIndex,
    })
    return issues
  }
  const v = Number(cond.value)
  if (!Number.isFinite(v)) {
    issues.push({
      severity: 'warning',
      key: 'This condition is incomplete and will be ignored when saved',
      branchIndex,
      conditionIndex,
    })
    return issues
  }
  if (cond.mode === MATCH_EQ) {
    if (!Number.isInteger(v)) {
      // Backend time functions return an int, so `hour(tz) == 5.5` can never
      // match. The domain check below only bounds the value, not its integrality.
      issues.push({
        severity: 'error',
        key: '{{label}} must be a whole number between {{min}} and {{max}}',
        params: rangeParams,
        branchIndex,
        conditionIndex,
      })
    } else if (v < domain.min || v > domain.max) {
      issues.push({
        severity: 'error',
        key: '{{label}} must be between {{min}} and {{max}}',
        params: rangeParams,
        branchIndex,
        conditionIndex,
      })
    }
  } else if (cond.mode === MATCH_GTE) {
    if (v > domain.max) {
      issues.push({
        severity: 'error',
        key: '{{label}} must be between {{min}} and {{max}}',
        params: rangeParams,
        branchIndex,
        conditionIndex,
      })
    } else if (v <= domain.min) {
      issues.push({
        severity: 'warning',
        key: 'This condition always matches',
        branchIndex,
        conditionIndex,
      })
    }
  } else if (cond.mode === MATCH_LT) {
    if (v <= domain.min) {
      issues.push({
        severity: 'error',
        key: '{{label}} must be between {{min}} and {{max}}',
        params: rangeParams,
        branchIndex,
        conditionIndex,
      })
    } else if (v > domain.max) {
      issues.push({
        severity: 'warning',
        key: 'This condition always matches',
        branchIndex,
        conditionIndex,
      })
    }
  }
  return issues
}

// AND-conflict analysis within one OR branch: any equality condition outside the
// effective [max-gte, min-lt) window — or two different equality values, or an
// empty window itself — means that branch can never match.
function checkBranchAndConflict(
  conditions: RequestCondition[],
  branchIndex: number
): ConditionIssue[] {
  const issues: ConditionIssue[] = []
  const byFuncTz = new Map<
    string,
    { eq: Set<number>; gteMax: number; ltMin: number }
  >()
  conditions.forEach((cond) => {
    if (cond.source !== SOURCE_TIME) return
    if (cond.mode === MATCH_RANGE) return
    const v = Number(cond.value)
    if (!Number.isFinite(v)) return
    const key = `${cond.timeFunc}:${cond.timezone || 'UTC'}`
    const entry = byFuncTz.get(key) || {
      eq: new Set(),
      gteMax: -Infinity,
      ltMin: Infinity,
    }
    if (cond.mode === MATCH_EQ) entry.eq.add(v)
    else if (cond.mode === MATCH_GTE) entry.gteMax = Math.max(entry.gteMax, v)
    else if (cond.mode === MATCH_LT) entry.ltMin = Math.min(entry.ltMin, v)
    byFuncTz.set(key, entry)
  })
  for (const entry of byFuncTz.values()) {
    if (entry.eq.size > 1) {
      issues.push({
        severity: 'error',
        key: 'Conflicting conditions in this rule make it never match',
        branchIndex,
      })
      continue
    }
    let never = false
    if (
      Number.isFinite(entry.gteMax) &&
      Number.isFinite(entry.ltMin) &&
      entry.gteMax >= entry.ltMin
    ) {
      never = true
    }
    if (!never && entry.eq.size === 1) {
      const eqVal = [...entry.eq][0]
      if (Number.isFinite(entry.gteMax) && eqVal < entry.gteMax) {
        never = true
      }
      if (!never && Number.isFinite(entry.ltMin) && eqVal >= entry.ltMin) {
        never = true
      }
    }
    if (never) {
      issues.push({
        severity: 'error',
        key: 'Conflicting conditions in this rule make it never match',
        branchIndex,
      })
    }
  }
  return issues
}

export function checkRequestDnfIssues(
  dnf: RequestDnf | null | undefined,
  t: TranslateFn
): ConditionIssue[] {
  const issues: ConditionIssue[] = []
  const branches = dnf || []
  let anyBranchAlive = false
  branches.forEach((branch, branchIndex) => {
    branch.conditions.forEach((cond, conditionIndex) => {
      issues.push(...checkOneRequestCondition(cond, t, branchIndex, conditionIndex))
    })
    const conflicts = checkBranchAndConflict(branch.conditions, branchIndex)
    if (conflicts.length > 0) {
      issues.push(...conflicts)
    } else {
      anyBranchAlive = true
    }
  })
  if (branches.length > 0 && !anyBranchAlive) {
    issues.push({
      severity: 'error',
      key: 'Conflicting conditions in this rule make it never match',
    })
  }
  return issues
}
