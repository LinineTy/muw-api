// @muw-owned
import { describe, expect, it } from 'vitest'

import {
  MATCH_RANGE,
  buildRequestRuleExpr,
  buildTierDnfExpr,
  combineBillingExpr,
  createEmptyRuleGroup,
  parseDnfRequestConditions,
  parseDnfTierConditions,
  parseTierChain,
  parseTiersFromExpr,
  requestRuleGroupsFromTrace,
  splitBillingExprAndRequestRules,
  tryParseRequestRuleExpr,
  type RequestRuleGroup,
} from './billing-expr'

const stripWs = (s: string) => s.replace(/\s+/g, '')

describe('parseDnfTierConditions', () => {
  it('treats an empty string as always-true', () => {
    expect(parseDnfTierConditions('')).toEqual([])
  })

  it('parses a flat AND clause', () => {
    expect(parseDnfTierConditions('len < 32000 && c < 200')).toEqual([
      {
        conditions: [
          { var: 'len', op: '<', value: 32000 },
          { var: 'c', op: '<', value: 200 },
        ],
      },
    ])
  })

  it('parses an OR of AND-clauses', () => {
    expect(
      parseDnfTierConditions('(p < 32000 && c < 200) || (len > 100000)')
    ).toEqual([
      {
        conditions: [
          { var: 'p', op: '<', value: 32000 },
          { var: 'c', op: '<', value: 200 },
        ],
      },
      { conditions: [{ var: 'len', op: '>', value: 100000 }] },
    ])
  })

  it('serializes a flat clause without parens (byte-identical to legacy)', () => {
    expect(
      buildTierDnfExpr(parseDnfTierConditions('len < 32000 && c < 200'))
    ).toBe('len < 32000 && c < 200')
  })

  it('serializes multi-clause DNF with parens', () => {
    expect(
      buildTierDnfExpr(
        parseDnfTierConditions('(p < 32000 && c < 200) || (len > 100000)')
      )
    ).toBe('(p < 32000 && c < 200) || (len > 100000)')
  })
})

describe('parseTierChain', () => {
  it('parses labels, conditions and fallback position', () => {
    const chain = parseTierChain(
      'len <= 200000 ? tier("standard", p * 3 + c * 15) : tier("long_context", p * 6 + c * 22.5)'
    )
    expect(chain?.map((t) => t.label)).toEqual(['standard', 'long_context'])
    expect(chain?.map((t) => t.isFallback)).toEqual([false, true])
    expect(chain?.[0].conditions).toEqual([
      { conditions: [{ var: 'len', op: '<=', value: 200000 }] },
    ])
  })

  it('recognizes the implicit zero fallback of a lone conditional tier', () => {
    const chain = parseTierChain(
      'len > 100000 ? tier("a", p * 1 + c * 2) : p * 0 + c * 0'
    )
    expect(chain?.length).toBe(2)
    expect(chain?.[1].label).toBe('')
    expect(chain?.[1].isFallback).toBe(true)
  })

  it('returns null for nested ternaries instead of dropping content', () => {
    expect(
      parseTierChain(
        'len <= 128000 ? tier("a", p * 1) : (len <= 1000000 ? tier("b", p * 2) : tier("c", p * 3))'
      )
    ).toBeNull()
  })
})

describe('parseTiersFromExpr', () => {
  it('parses a flat pricing tier', () => {
    const tiers = parseTiersFromExpr('tier("base", p * 2 + c * 4)')
    expect(tiers.map((t) => t.label)).toEqual(['base'])
    expect(tiers[0].inputPrice).toBe(2)
    expect(tiers[0].outputPrice).toBe(4)
    expect(tiers[0].isFallback).toBe(true)
  })

  it('ignores non-linear max() terms instead of mispricing', () => {
    const tiers = parseTiersFromExpr(
      'tier("base", max(p * 5, c * 5) + p * 2.5 + c * 15)'
    )
    expect(tiers[0]?.inputPrice).toBe(2.5)
    expect(tiers[0]?.outputPrice).toBe(15)
  })
})

describe('parseDnfRequestConditions', () => {
  it('treats an overnight RANGE as a single window, not an OR', () => {
    const dnf = parseDnfRequestConditions(
      'hour("Asia/Shanghai") >= 12 || hour("Asia/Shanghai") < 18'
    )
    expect(dnf?.length).toBe(1)
    expect(dnf?.[0].conditions[0].mode).toBe(MATCH_RANGE)
  })

  it('treats parenthesized same-tz comparisons as a 2-branch DNF', () => {
    const dnf = parseDnfRequestConditions(
      '(hour("tz") >= 12) || (hour("tz") < 18)'
    )
    expect(dnf?.length).toBe(2)
  })

  it('parses multiple ANDed eq conditions into one clause', () => {
    const dnf = parseDnfRequestConditions(
      'param("a") == "x" && param("b") == "y"'
    )
    expect(dnf?.length).toBe(1)
    expect(dnf?.[0].conditions).toHaveLength(2)
  })

  it('folds a nil-guard numeric comparison into one condition', () => {
    expect(
      parseDnfRequestConditions('param("x") != nil && param("x") >= 5')
    ).toEqual([
      {
        conditions: [{ source: 'param', path: 'x', mode: 'gte', value: '5' }],
      },
    ])
  })

  it('parses DNF branches with nil-guard merges', () => {
    const dnf = parseDnfRequestConditions(
      '(param("a") != nil && param("a") >= 5) || (has(header("h"), "v"))'
    )
    expect(dnf?.length).toBe(2)
    expect(dnf?.[0].conditions).toEqual([
      { source: 'param', path: 'a', mode: 'gte', value: '5' },
    ])
  })

  it('keeps a RANGE parenthesized inside an AND clause', () => {
    const dnf = parseDnfRequestConditions(
      '(hour("tz") >= 12 || hour("tz") < 18) && param("x") != nil'
    )
    expect(dnf?.length).toBe(1)
    expect(dnf?.[0].conditions.map((c) => c.source)).toEqual(['time', 'param'])
    expect(dnf?.[0].conditions[0].mode).toBe(MATCH_RANGE)
  })
})

describe('request rule round-trip', () => {
  it('builds and re-parses a DNF rule group', () => {
    const dnf = parseDnfRequestConditions(
      '(param("a") == "x") || (param("b") == "y")'
    )
    const group: RequestRuleGroup = {
      conditions: dnf ?? [],
      multiplier: '2',
    }
    const expr = buildRequestRuleExpr([group])
    expect(expr).toBe('((param("a") == "x") || (param("b") == "y") ? 2 : 1)')
    const parsed = tryParseRequestRuleExpr(expr)
    expect(parsed?.[0].conditions).toEqual(group.conditions)
    expect(parsed?.[0].multiplier).toBe('2')
  })

  it.each([
    '(param("a") == "true" ? 2 : 1)',
    '(param("a") == true ? 2 : 1)',
    '(param("a") == -3.5 ? 2 : 1)',
    '(param("a") == "x && y" ? 2 : 1)',
    '(param("a") == "x ? y" ? 2 : 1)',
  ])('round-trips the EQ literal kind exactly: %s', (rule) => {
    const back = tryParseRequestRuleExpr(rule)
    expect(back?.[0].conditions).not.toBeUndefined()
    const again = buildRequestRuleExpr(back ?? [])
    expect(again.replace(/\s+/g, '')).toBe(rule.replace(/\s+/g, ''))
  })

  it('splits a combined expression back into tiers + rules', () => {
    const full = combineBillingExpr(
      'tier("base", p * 5 + c * 25)',
      '((param("a") == "x") || (param("b") == "y") ? 2 : 1)'
    )
    const { billingExpr, requestRuleExpr } =
      splitBillingExprAndRequestRules(full)
    expect(billingExpr).toBe('tier("base", p * 5 + c * 25)')
    expect(stripWs(requestRuleExpr)).toContain('param("a")=="x"')
  })

  it('parses trace conds with DNF and RANGE', () => {
    const groups = requestRuleGroupsFromTrace([
      {
        cond: 'param("a") == "x" || param("b") == "y"',
        multiplier: 2,
        matched: true,
      },
      {
        cond: 'hour("tz") >= 12 && hour("tz") < 18',
        multiplier: 2,
        matched: false,
      },
    ])
    expect(groups[0].conditions).toHaveLength(2)
    // Within-day `&&` pairs are a RANGE (the builder emits `&&` for start <= end).
    expect(groups[1].conditions[0].conditions[0].mode).toBe(MATCH_RANGE)
  })
})

describe('createEmptyRuleGroup', () => {
  it('returns a single AND-clause with one empty condition', () => {
    const group = createEmptyRuleGroup()
    expect(group.conditions).toHaveLength(1)
    expect(group.conditions[0].conditions).toHaveLength(1)
    expect(group.conditions[0].conditions[0].source).toBe('param')
  })
})
