// @muw-owned
/**
 * Round-trip property tests for the billing expression model.
 *
 * The visual editor is a lossless front-end over the expression string, and the
 * only realistic way to prove that (rather than trusting a handful of hand-picked
 * cases) is a deterministic seeded corpus: generate every shape the editor can
 * produce — tier counts, DNF branch counts, variables, prices, request-rule
 * sources/modes, tricky string literals — then assert the invariants the UI
 * depends on:
 *
 *   1. generate → parse restores the exact same visual config.
 *   2. build → parse restores the exact same request rule groups.
 *   3. combine → split restores both halves byte-for-byte (whitespace aside),
 *      and both halves still parse — i.e. switching visual↔raw never loses data.
 *   4. Expressions with features the visual model can't represent (max/min,
 *      nested ternaries, `!`) are refused, so the editor stays in raw mode.
 *
 * The seed is fixed, so a failure reproduces deterministically.
 */
import { describe, expect, it } from 'vitest'

import {
  MATCH_CONTAINS,
  MATCH_EQ,
  MATCH_EXISTS,
  MATCH_GT,
  MATCH_GTE,
  MATCH_LT,
  MATCH_LTE,
  MATCH_RANGE,
  RANGE_OP_AND,
  RANGE_OP_OR,
  buildRequestRuleExpr,
  combineBillingExpr,
  splitBillingExprAndRequestRules,
  tryParseRequestRuleExpr,
  type RequestCondition,
  type RequestDnf,
  type RequestRuleGroup,
  type TierCondition,
  type TierConditionDnf,
} from './billing-expr'
import {
  generateExprFromVisualConfig,
  normalizeVisualConfig,
  normalizeVisualTier,
  tryParseVisualConfig,
  type VisualConfig,
  type VisualTier,
} from './tier-expr'

const stripWs = (s: string) => s.replace(/\s+/g, '')

// Deterministic PRNG (mulberry32): identical corpus on every run.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

// ---------------------------------------------------------------------------
// Tier config generator
// ---------------------------------------------------------------------------

const TIER_VARS = [
  'p',
  'c',
  'len',
  'cr',
  'cc',
  'cc1h',
  'img',
  'img_o',
  'ai',
  'ao',
] as const
const TIER_OPS = ['<', '<=', '>', '>='] as const
const TIER_VALUES = [0, 1, 5, 100, 200000, 32000, -1, 0.5, 1_000_000]
const PRICE_POOL = [0, 0.5, 3, 15, 22.5]
const EXTRA_PRICE_FIELDS = [
  'cache_read_unit_cost',
  'cache_create_unit_cost',
  'cache_create_1h_unit_cost',
  'image_unit_cost',
  'image_output_unit_cost',
  'audio_input_unit_cost',
  'audio_output_unit_cost',
] as const

function randTierDnf(rng: () => number): TierConditionDnf {
  const branches = 1 + Math.floor(rng() * 3) // 1..3 OR branches
  const dnf: TierConditionDnf = []
  for (let b = 0; b < branches; b += 1) {
    const atoms = 1 + Math.floor(rng() * 3) // 1..3 ANDed conditions
    dnf.push({
      conditions: Array.from({ length: atoms }, () => {
        const atom: TierCondition = {
          var: pick(rng, TIER_VARS),
          op: pick(rng, TIER_OPS),
          value: pick(rng, TIER_VALUES),
        }
        return atom
      }),
    })
  }
  return dnf
}

function randTier(
  rng: () => number,
  label: string,
  isFallback: boolean
): VisualTier {
  const tier: Record<string, unknown> = {
    label,
    isFallback,
    input_unit_cost: pick(rng, PRICE_POOL),
    output_unit_cost: pick(rng, PRICE_POOL),
  }
  if (!isFallback) tier.conditions = randTierDnf(rng)
  for (const field of EXTRA_PRICE_FIELDS) {
    if (rng() < 0.3) tier[field] = pick(rng, [0.5, 1, 2, 3])
  }
  return normalizeVisualTier(tier)
}

// Mirrors what the editor produces: N conditional tiers (each with a non-empty
// DNF, the validator forbids empty) followed by exactly one fallback tier. A
// multi-tier config can end with the canonical unlabelled zero-cost fallback
// (which serializes to `p * 0 + c * 0`).
function randVisualConfig(rng: () => number): VisualConfig {
  const nonFallback = Math.floor(rng() * 4) // 0..3
  const tiers: VisualTier[] = []
  for (let i = 0; i < nonFallback; i += 1) {
    tiers.push(randTier(rng, rng() < 0.2 ? 'tier)a' : `tier_${i + 1}`, false))
  }
  if (nonFallback > 0 && rng() < 0.5) {
    tiers.push(normalizeVisualTier({ label: '', isFallback: true }))
  } else {
    tiers.push(randTier(rng, rng() < 0.2 ? 'base)' : 'base', true))
  }
  return normalizeVisualConfig({ tiers })
}

// ---------------------------------------------------------------------------
// Request rule generator
// ---------------------------------------------------------------------------

const PARAM_PATHS = [
  'a',
  'b',
  'service_tier',
  'user_role',
  'model',
  'user)role',
  'a(b',
]
const HEADER_NAMES = ['X-User', 'X-Tier', 'X-Region', 'X-)', 'X-(']
// String literals that contain the parser's own operators — the whole point of
// the quote-aware token splitting — plus whitespace/paren-edge values.
const STRING_VALUES = [
  'x',
  'true',
  'false',
  'x && y',
  'x || y',
  'x ? y',
  'x : 1',
  'x * y',
  '含中文',
  'foo ? 2 : 1)',
  'a"b',
  '(x)',
  '))',
  ' " ',
  'a\\b',
  'x, y)',
  'a || b && c ? d : e',
]
const NUMERIC_VALUES = ['3', '-2.5', '0', '1e3', '5']
const TIMEZONES = ['Asia/Shanghai', 'UTC'] as const
const TIME_FUNCS = ['hour', 'minute', 'weekday', 'month', 'day'] as const
const MULTIPLIERS = ['0.5', '1', '1.5', '2', '2.5', '3'] as const

function randRequestCondition(rng: () => number): RequestCondition {
  const kind = Math.floor(rng() * 10)
  switch (kind) {
    case 0:
      return {
        source: 'param',
        path: pick(rng, PARAM_PATHS),
        mode: MATCH_EQ,
        value: pick(rng, STRING_VALUES),
        valueKind: 'string',
      }
    case 1:
      return {
        source: 'param',
        path: pick(rng, PARAM_PATHS),
        mode: MATCH_EQ,
        value: pick(rng, NUMERIC_VALUES),
        valueKind: 'number',
      }
    case 2:
      return {
        source: 'param',
        path: pick(rng, PARAM_PATHS),
        mode: MATCH_EQ,
        value: pick(rng, ['true', 'false']),
        valueKind: 'boolean',
      }
    case 3:
      return {
        source: 'param',
        path: pick(rng, PARAM_PATHS),
        mode: pick(rng, [MATCH_GT, MATCH_GTE, MATCH_LT, MATCH_LTE]),
        value: pick(rng, NUMERIC_VALUES),
      }
    case 4:
      return {
        source: 'param',
        path: pick(rng, PARAM_PATHS),
        mode: MATCH_CONTAINS,
        value: pick(rng, STRING_VALUES),
      }
    case 5:
      return {
        source: 'param',
        path: pick(rng, PARAM_PATHS),
        mode: MATCH_EXISTS,
        value: '',
      }
    case 6:
      return {
        source: 'header',
        path: pick(rng, HEADER_NAMES),
        mode: MATCH_EQ,
        value: pick(rng, STRING_VALUES),
        valueKind: 'string',
      }
    case 7:
      return {
        source: 'header',
        path: pick(rng, HEADER_NAMES),
        mode: MATCH_EXISTS,
        value: '',
      }
    case 8:
      return {
        source: 'header',
        path: pick(rng, HEADER_NAMES),
        mode: MATCH_CONTAINS,
        value: pick(rng, STRING_VALUES),
      }
    default: {
      const timeFunc = pick(rng, TIME_FUNCS)
      const timezone = pick(rng, TIMEZONES)
      const mode = pick(rng, [MATCH_EQ, MATCH_GTE, MATCH_LT, MATCH_RANGE])
      // Domain-valid values per time function: the builder rejects out-of-range
      // literals (e.g. day 0, month 0), so a corpus outside the domain would no
      // longer round-trip.
      const domain: Record<
        string,
        { ranges: Array<[number, number]>; values: string[] }
      > = {
        hour: {
          ranges: [
            [18, 6],
            [21, 9],
            [23, 0],
            [2, 5],
            [9, 12],
          ],
          values: ['8', '0', '18', '23', '7'],
        },
        minute: {
          ranges: [
            [30, 10],
            [50, 15],
            [59, 0],
            [10, 30],
          ],
          values: ['30', '0', '45', '59', '7'],
        },
        weekday: {
          ranges: [
            [5, 1],
            [6, 0],
            [1, 6],
          ],
          values: ['1', '0', '5', '6', '3'],
        },
        month: {
          ranges: [
            [11, 3],
            [12, 1],
            [3, 11],
          ],
          values: ['1', '6', '12', '3', '9'],
        },
        day: {
          ranges: [
            [25, 5],
            [28, 2],
            [5, 25],
          ],
          values: ['1', '15', '31', '9', '23'],
        },
      }
      if (mode === MATCH_RANGE) {
        const [start, end] = pick(rng, domain[timeFunc].ranges)
        return {
          source: 'time',
          timeFunc,
          timezone,
          mode,
          value: '',
          rangeStart: String(start),
          rangeEnd: String(end),
          // The builder derives the operator from the bounds (upstream #6934):
          // same-day windows serialize with `&&`, overnight windows with `||`.
          rangeOp: start > end ? RANGE_OP_OR : RANGE_OP_AND,
        }
      }
      return {
        source: 'time',
        timeFunc,
        timezone,
        mode,
        value: pick(rng, domain[timeFunc].values),
        rangeStart: '',
        rangeEnd: '',
      }
    }
  }
}

function randRequestDnf(rng: () => number): RequestDnf {
  const branches = 1 + Math.floor(rng() * 3)
  return Array.from({ length: branches }, () => ({
    conditions: Array.from({ length: 1 + Math.floor(rng() * 3) }, () =>
      randRequestCondition(rng)
    ),
  }))
}

function randRuleGroups(rng: () => number): RequestRuleGroup[] {
  const count = Math.floor(rng() * 3) // 0..2 groups
  return Array.from({ length: count }, () => ({
    conditions: randRequestDnf(rng),
    multiplier: pick(rng, MULTIPLIERS),
  }))
}

// ---------------------------------------------------------------------------
// Round-trip invariants
// ---------------------------------------------------------------------------

describe('round-trip properties (seeded corpus)', () => {
  it('every editor-producible tier config survives generate → parse', () => {
    const rng = mulberry32(0xc0ffee)
    for (let i = 0; i < 200; i += 1) {
      const config = randVisualConfig(rng)
      const expr = generateExprFromVisualConfig(config)
      const back = tryParseVisualConfig(expr)
      expect(back, `case ${i}: ${expr}`).not.toBeNull()
      expect(back, `case ${i}: ${expr}`).toEqual(config)
    }
  })

  it('every request rule set survives build → parse', () => {
    const rng = mulberry32(0xbeef)
    for (let i = 0; i < 200; i += 1) {
      const groups = randRuleGroups(rng)
      const expr = buildRequestRuleExpr(groups)
      const back = tryParseRequestRuleExpr(expr)
      expect(back, `case ${i}: ${expr}`).toEqual(groups)
    }
  })

  it('combined expr splits back to identical halves (mode-switch contract)', () => {
    const rng = mulberry32(0xfeed)
    for (let i = 0; i < 200; i += 1) {
      const tierExpr = generateExprFromVisualConfig(randVisualConfig(rng))
      const ruleExpr = buildRequestRuleExpr(randRuleGroups(rng))
      const combined = combineBillingExpr(tierExpr, ruleExpr)
      const { billingExpr, requestRuleExpr } =
        splitBillingExprAndRequestRules(combined)
      expect(stripWs(billingExpr), `case ${i}: ${combined}`).toBe(
        stripWs(tierExpr)
      )
      expect(stripWs(requestRuleExpr), `case ${i}: ${combined}`).toBe(
        stripWs(ruleExpr)
      )
      // Raw → visual must be allowed for everything the editor itself produces.
      expect(tryParseVisualConfig(billingExpr), `case ${i}`).not.toBeNull()
      expect(
        tryParseRequestRuleExpr(requestRuleExpr),
        `case ${i}`
      ).not.toBeNull()
    }
  })

  it('refuses unrepresentable tier expressions (stays raw, nothing dropped)', () => {
    const unrepresentable = [
      // Nested ternary chain.
      'len <= 128000 ? tier("a", p * 1) : (len <= 1000000 ? tier("b", p * 2) : tier("c", p * 3))',
      // max()/min(): the non-linear term would be dropped by the tier body
      // parser, so the strict round-trip check refuses it.
      'tier("a", max(p * 1, c * 2) + p * 2 + c * 10)',
      'len < 100 ? tier("a", min(p * 5, c * 5) + p * 2) : p * 0 + c * 0',
      // `!` negation is not representable in the visual model.
      '!(len < 100) ? tier("a", p * 1) : tier("b", p * 1)',
      'len < 100 && !(c > 5) ? tier("a", p * 1) : p * 0 + c * 0',
    ]
    for (const expr of unrepresentable) {
      expect(tryParseVisualConfig(expr), expr).toBeNull()
    }
  })

  it('refuses request-rule expressions that reference tier variables', () => {
    // A rule factor whose condition uses `len` (a tier variable) is not a
    // request condition; the whole expression must be refused, not partially
    // dropped.
    expect(tryParseRequestRuleExpr('(len < 5 ? 2 : 1)')).toBeNull()
    expect(
      tryParseRequestRuleExpr(
        '(param("a") == "x" ? 2 : 1) * (len > 10 ? 3 : 1)'
      )
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Hand-picked edge cases that the corpus might not hit in one seed
// ---------------------------------------------------------------------------

describe('hand-picked round-trip edges', () => {
  it('keeps a RANGE window ANDed with a param condition', () => {
    const groups: RequestRuleGroup[] = [
      {
        conditions: [
          {
            conditions: [
              {
                source: 'param',
                path: 'a',
                mode: MATCH_EQ,
                value: 'true',
                valueKind: 'string',
              },
              {
                source: 'time',
                timeFunc: 'hour',
                timezone: 'Asia/Shanghai',
                mode: MATCH_RANGE,
                value: '',
                rangeStart: '18',
                rangeEnd: '6',
                rangeOp: RANGE_OP_OR,
              },
            ],
          },
        ],
        multiplier: '2',
      },
    ]
    const expr = buildRequestRuleExpr(groups)
    expect(expr).toBe(
      '(param("a") == "true" && (hour("Asia/Shanghai") >= 18 || hour("Asia/Shanghai") < 6) ? 2 : 1)'
    )
    expect(tryParseRequestRuleExpr(expr)).toEqual(groups)
  })

  it('preserves a string EQ literal named like a boolean', () => {
    const groups: RequestRuleGroup[] = [
      {
        conditions: [
          {
            conditions: [
              {
                source: 'param',
                path: 'flag',
                mode: MATCH_EQ,
                value: 'true',
                valueKind: 'string',
              },
            ],
          },
        ],
        multiplier: '1.5',
      },
    ]
    const expr = buildRequestRuleExpr(groups)
    expect(stripWs(expr)).toContain('param("flag")=="true"')
    expect(tryParseRequestRuleExpr(expr)).toEqual(groups)
  })

  it('keeps a 2-branch tier DNF exact through generate → parse', () => {
    const config = normalizeVisualConfig({
      tiers: [
        normalizeVisualTier({
          label: 'standard',
          isFallback: false,
          conditions: [
            {
              conditions: [
                { var: 'len', op: '<', value: 200000 },
                { var: 'c', op: '<', value: 200 },
              ],
            },
            { conditions: [{ var: 'p', op: '>', value: 1000 }] },
          ],
          input_unit_cost: 3,
          output_unit_cost: 15,
        }),
        normalizeVisualTier({ label: '', isFallback: true }),
      ],
    })
    const expr = generateExprFromVisualConfig(config)
    expect(stripWs(expr)).toBe(
      '(len<200000&&c<200)||(p>1000)?tier("standard",p*3+c*15):p*0+c*0'
    )
    expect(tryParseVisualConfig(expr)).toEqual(config)
  })

  it('survives a zero-priced but labelled fallback tier', () => {
    const config = normalizeVisualConfig({
      tiers: [
        normalizeVisualTier({
          label: 'free',
          isFallback: true,
          input_unit_cost: 0,
          output_unit_cost: 0,
        }),
      ],
    })
    const expr = generateExprFromVisualConfig(config)
    expect(stripWs(expr)).toBe('tier("free",p*0+c*0)')
    expect(tryParseVisualConfig(expr)).toEqual(config)
  })

  it('survives a value containing a closing paren (regression: paren-balance)', () => {
    // The value `foo ? 2 : 1)` ends with `)` inside the string. hasFullOuterParens
    // must not treat it as closing an outer group, or the branch fails to unwrap
    // and the whole rule is refused.
    const groups: RequestRuleGroup[] = [
      {
        conditions: [
          {
            conditions: [
              {
                source: 'header',
                path: 'X-Tier',
                mode: MATCH_EXISTS,
                value: '',
              },
              {
                source: 'param',
                path: 'user_role',
                mode: MATCH_EQ,
                value: 'foo ? 2 : 1)',
                valueKind: 'string',
              },
            ],
          },
          {
            conditions: [
              { source: 'param', path: 'model', mode: MATCH_GT, value: '1e3' },
            ],
          },
        ],
        multiplier: '0.5',
      },
    ]
    const expr = buildRequestRuleExpr(groups)
    const back = tryParseRequestRuleExpr(expr)
    expect(back, expr).toEqual(groups)
  })

  it('survives a parenthesized atom whose value contains || (regression: atom unwrap)', () => {
    // buildRequestDnfExpr wraps an atom whose serialized form contains `||` when
    // ANDing it (e.g. `(has(header("X"), "x || y"))`); the parser must unwrap the
    // atom before matching, or the whole rule is refused.
    const groups: RequestRuleGroup[] = [
      {
        conditions: [
          {
            conditions: [
              {
                source: 'param',
                path: 'user_role',
                mode: MATCH_EXISTS,
                value: '',
              },
              {
                source: 'header',
                path: 'X-Region',
                mode: MATCH_CONTAINS,
                value: 'x || y',
              },
            ],
          },
          {
            conditions: [
              {
                source: 'param',
                path: 'model',
                mode: MATCH_EQ,
                value: '5',
                valueKind: 'number',
              },
            ],
          },
        ],
        multiplier: '1.5',
      },
    ]
    const expr = buildRequestRuleExpr(groups)
    const back = tryParseRequestRuleExpr(expr)
    expect(back, expr).toEqual(groups)
  })

  it('preserves leading/trailing whitespace in string values (regression: value trim)', () => {
    // A single-space value must serialize to `== " "` and round-trip, not be
    // trimmed into an empty string.
    const groups: RequestRuleGroup[] = [
      {
        conditions: [
          {
            conditions: [
              {
                source: 'param',
                path: 'user_role',
                mode: MATCH_EQ,
                value: ' ',
                valueKind: 'string',
              },
            ],
          },
        ],
        multiplier: '2',
      },
    ]
    const expr = buildRequestRuleExpr(groups)
    // Assert on the un-stripped string — stripWs would eat the space we care about.
    expect(expr).toContain('user_role") == " "')
    expect(tryParseRequestRuleExpr(expr)).toEqual(groups)

    // A value that itself contains a quote also round-trips (escaped as `\"`).
    const quoted: RequestRuleGroup[] = [
      {
        conditions: [
          {
            conditions: [
              {
                source: 'param',
                path: 'user_role',
                mode: MATCH_EQ,
                value: ' " ',
                valueKind: 'string',
              },
            ],
          },
        ],
        multiplier: '2',
      },
    ]
    expect(tryParseRequestRuleExpr(buildRequestRuleExpr(quoted))).toEqual(
      quoted
    )
  })

  it('round-trips parens inside header/param paths', () => {
    const groups: RequestRuleGroup[] = [
      {
        conditions: [
          {
            conditions: [
              {
                source: 'header',
                path: 'X-)',
                mode: MATCH_EQ,
                value: 'v',
                valueKind: 'string',
              },
              {
                source: 'param',
                path: 'a(b',
                mode: MATCH_EXISTS,
                value: '',
              },
            ],
          },
        ],
        multiplier: '1',
      },
    ]
    const expr = buildRequestRuleExpr(groups)
    expect(tryParseRequestRuleExpr(expr)).toEqual(groups)
  })
})
