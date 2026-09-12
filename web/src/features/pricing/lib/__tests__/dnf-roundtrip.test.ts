// @muw-owned
import { describe, expect, test } from 'vitest'

import {
  MATCH_CONTAINS,
  MATCH_EQ,
  MATCH_EXISTS,
  MATCH_GTE,
  MATCH_GT,
  MATCH_LT,
  MATCH_LTE,
  MATCH_RANGE,
  RANGE_OP_AND,
  RANGE_OP_OR,
  buildRequestRuleExpr,
  parseTiersFromExpr,
  tryParseRequestRuleExpr,
  type RequestCondition,
  type RequestRuleGroup,
  type TimeCondition,
  type TimeFunc,
} from '../billing-expr'

// ---------------------------------------------------------------------------
// Deterministic PRNG so a failing seed can be re-run verbatim.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]
}

const TIME_FUNCS: readonly TimeFunc[] = ['hour', 'minute', 'weekday', 'month', 'day']
const TIME_DOMAINS: Record<TimeFunc, [number, number]> = {
  hour: [0, 23],
  minute: [0, 59],
  weekday: [0, 6],
  month: [1, 12],
  day: [1, 31],
}

function randomTimeCondition(rng: () => number): TimeCondition {
  const timeFunc = pick(rng, TIME_FUNCS)
  const [min, max] = TIME_DOMAINS[timeFunc]
  const bound = () => String(min + Math.floor(rng() * (max - min + 1)))
  const base = {
    source: 'time' as const,
    timeFunc,
    timezone: pick(rng, ['Asia/Shanghai', 'UTC']),
  }
  switch (pick(rng, ['eq', 'gte', 'lt', 'range', 'range'] as const)) {
    case 'eq':
      return {
        ...base,
        mode: MATCH_EQ,
        value: bound(),
        rangeStart: '',
        rangeEnd: '',
      }
    case 'gte':
      return {
        ...base,
        mode: MATCH_GTE,
        value: bound(),
        rangeStart: '',
        rangeEnd: '',
      }
    case 'lt':
      return {
        ...base,
        mode: MATCH_LT,
        value: bound(),
        rangeStart: '',
        rangeEnd: '',
      }
    default: {
      // Ranges are emitted as the canonical `start > end` (overnight, `||`) or
      // `start <= end` (within-day, `&&`) spelling, so the built expression
      // never contains a degenerate window the parser would reject.
      const start = min + Math.floor(rng() * (max - min + 1))
      const end = min + Math.floor(rng() * (max - min + 1))
      return {
        ...base,
        mode: MATCH_RANGE,
        value: '',
        rangeStart: String(start),
        rangeEnd: String(end),
        rangeOp: start > end ? RANGE_OP_OR : RANGE_OP_AND,
      }
    }
  }
}

function randomCondition(rng: () => number): RequestCondition {
  switch (pick(rng, ['param', 'header', 'time', 'time'] as const)) {
    case 'time':
      return randomTimeCondition(rng)
    case 'header': {
      const path = pick(rng, ['x-region', 'anthropic-beta', 'x-tier'])
      switch (pick(rng, ['eq', 'contains', 'exists'] as const)) {
        case 'exists':
          return { source: 'header', path, mode: MATCH_EXISTS, value: '' }
        case 'contains':
          return {
            source: 'header',
            path,
            mode: MATCH_CONTAINS,
            value: pick(rng, ['fast-mode', 'cn', 'beta']),
          }
        default:
          return {
            source: 'header',
            path,
            mode: MATCH_EQ,
            value: pick(rng, ['fast', 'true', 'cn']),
            valueKind: 'string',
          }
      }
    }
    default: {
      const path = pick(rng, ['service_tier', 'model', 'channel'])
      switch (pick(rng, ['eq', 'number', 'exists', 'contains'] as const)) {
        case 'exists':
          return { source: 'param', path, mode: MATCH_EXISTS, value: '' }
        case 'contains':
          return {
            source: 'param',
            path,
            mode: MATCH_CONTAINS,
            value: pick(rng, ['fast', 'pro', 'turbo']),
          }
        case 'number':
          return {
            source: 'param',
            path,
            mode: pick(rng, [MATCH_GT, MATCH_GTE, MATCH_LT, MATCH_LTE]),
            value: String(pick(rng, [0, 1, 3, 10])),
          }
        default:
          return {
            source: 'param',
            path,
            mode: MATCH_EQ,
            value: pick(rng, ['fast', 'flex', 'priority', '1']),
            valueKind: 'string',
          }
      }
    }
  }
}

/** A DNF group: 1-3 OR branches, each an AND-clause of 1-3 conditions. */
function randomRuleGroup(rng: () => number): RequestRuleGroup {
  const branchCount = 1 + Math.floor(rng() * 3)
  const conditions = []
  for (let branch = 0; branch < branchCount; branch += 1) {
    const atomCount = 1 + Math.floor(rng() * 3)
    const branchConditions = []
    for (let atom = 0; atom < atomCount; atom += 1) {
      branchConditions.push(randomCondition(rng))
    }
    conditions.push({ conditions: branchConditions })
  }
  return {
    conditions,
    multiplier: String(pick(rng, ['0.5', '1', '2', '6'])),
  }
}

describe('request-rule DNF round-trip', () => {
  test('build → parse → build is idempotent across 300 random DNF groups', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = mulberry32(seed)
      const groups = [randomRuleGroup(rng)]

      const expr = buildRequestRuleExpr(groups)
      expect(expr, `seed ${seed} produced no expression`).not.toBe('')

      const parsed = tryParseRequestRuleExpr(expr)
      expect(parsed, `seed ${seed} failed to parse: ${expr}`).not.toBeNull()

      // Idempotent: a second pass must reproduce the same text, otherwise the
      // editor would rewrite the stored expression every time it is opened.
      expect(buildRequestRuleExpr(parsed ?? []), `seed ${seed}: ${expr}`).toBe(
        expr
      )
    }
  })

  test('build → parse preserves the OR branch count (no branch collapsed)', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = mulberry32(seed)
      const group = randomRuleGroup(rng)
      const expr = buildRequestRuleExpr([group])
      const parsed = tryParseRequestRuleExpr(expr)
      expect(parsed).not.toBeNull()

      // Branch count is the invariant that matters: the parser may recombine
      // adjacent atoms (a pair of time bounds becomes one MATCH_RANGE, a
      // nil-guard rejoins its comparison), but an OR branch must never merge
      // into another branch's AND-clause.
      const before = group.conditions.length
      const after = (parsed ?? [])[0].conditions.length
      expect(after, `seed ${seed}: ${expr}`).toEqual(before)
      for (const branch of (parsed ?? [])[0].conditions) {
        expect(branch.conditions.length, `seed ${seed}: ${expr}`).toBeGreaterThan(
          0
        )
      }
    }
  })

  test('an overnight MATCH_RANGE keeps its `||` spelling on rebuild', () => {
    const expr =
      '(hour("Asia/Shanghai") >= 21 || hour("Asia/Shanghai") < 6 ? 2 : 1)'
    const parsed = tryParseRequestRuleExpr(expr)
    const condition = parsed?.[0].conditions[0].conditions[0] as TimeCondition
    expect(condition.rangeOp).toBe(RANGE_OP_OR)
    expect(buildRequestRuleExpr(parsed ?? [])).toBe(expr)
  })

  test('a within-day MATCH_RANGE keeps its `&&` spelling on rebuild', () => {
    const expr =
      '(hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 ? 2 : 1)'
    const parsed = tryParseRequestRuleExpr(expr)
    const condition = parsed?.[0].conditions[0].conditions[0] as TimeCondition
    expect(condition.rangeOp).toBe(RANGE_OP_AND)
    expect(buildRequestRuleExpr(parsed ?? [])).toBe(expr)
  })

  test('string literals survive the round-trip instead of decaying to booleans/numbers', () => {
    for (const source of [
      '(param("a") == "true" ? 2 : 1)',
      '(param("a") == "1" ? 2 : 1)',
      '(header("x") == "false" ? 2 : 1)',
    ]) {
      expect(buildRequestRuleExpr(tryParseRequestRuleExpr(source) ?? [])).toBe(
        source
      )
    }
    for (const source of [
      '(param("a") == 1 ? 2 : 1)',
      '(param("a") == true ? 2 : 1)',
    ]) {
      expect(buildRequestRuleExpr(tryParseRequestRuleExpr(source) ?? [])).toBe(
        source
      )
    }
  })
})

describe('tier-condition DNF parsing', () => {
  test('an OR of AND-clauses becomes one branch per clause', () => {
    const tiers = parseTiersFromExpr(
      '((len < 32000 && c > 100) || p > 1000) ? tier("s", p * 5) : tier("l", p * 6)'
    )
    expect(tiers).toHaveLength(2)
    expect(tiers[0].conditions).toEqual([
      {
        conditions: [
          { var: 'len', op: '<', value: 32000 },
          { var: 'c', op: '>', value: 100 },
        ],
      },
      { conditions: [{ var: 'p', op: '>', value: 1000 }] },
    ])
    // The fallback tier carries the empty DNF (always true).
    expect(tiers[1].conditions).toEqual([])
  })

  test('a plain && chain stays a single branch', () => {
    const tiers = parseTiersFromExpr(
      'len <= 272000 ? tier("standard", p * 2.5) : tier("long", p * 5)'
    )
    expect(tiers[0].conditions).toEqual([
      { conditions: [{ var: 'len', op: '<=', value: 272000 }] },
    ])
  })

  test('a nested OR under AND is refused instead of being silently flattened', () => {
    // `a && (b || c)` is not canonical DNF. Keeping the raw expression is the
    // only safe answer: flattening would change which requests match.
    expect(
      parseTiersFromExpr(
        '(len < 32000 && (c > 100 || p > 1000)) ? tier("s", p * 5) : tier("l", p * 6)'
      )
    ).toEqual([])
  })
})

describe('MATCH_RANGE bounds that cannot come from the editor', () => {
  test('an out-of-domain range stays unparsed so it cannot be rebuilt wrong', () => {
    expect(
      tryParseRequestRuleExpr(
        '(hour("Asia/Shanghai") >= 25 && hour("Asia/Shanghai") < 30 ? 2 : 1)'
      )
    ).toBeNull()
  })
})
