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
import { describe, expect, it } from 'vitest'

import {
  createDefaultVisualConfig,
  generateExprFromVisualConfig,
  normalizeVisualConfig,
  normalizeVisualTier,
  tryParseVisualConfig,
} from './tier-expr'

const stripWs = (s: string) => s.replace(/\s+/g, '')

function roundTrips(expr: string): boolean {
  const config = tryParseVisualConfig(expr)
  if (!config) return false
  // The visual model does not carry the expression version prefix; parse and
  // regeneration both operate on the body after `v1:` is stripped.
  const body = expr.replace(/^v\d+:/, '')
  return stripWs(generateExprFromVisualConfig(config)) === stripWs(body)
}

describe('tryParseVisualConfig round-trip', () => {
  const legacyCases: Array<[string, string]> = [
    ['flat', 'tier("base", p * 2 + c * 4)'],
    [
      'multitier with cache',
      'len <= 200000 ? tier("standard", p * 3 + c * 15 + cr * 0.3 + cc * 3.75 + cc1h * 6) : tier("long_context", p * 6 + c * 22.5 + cr * 0.6 + cc * 7.5 + cc1h * 12)',
    ],
    [
      '3-tier preset',
      'len < 32000 && c < 200 ? tier("short_output", p * 0.8 + c * 2 + cr * 0.16) : len < 32000 && c >= 200 ? tier("long_output", p * 0.8 + c * 6 + cr * 0.16) : tier("mid_context", p * 1.2 + c * 8 + cr * 0.24)',
    ],
    ['lone conditional tier', 'len > 100000 ? tier("a", p * 1 + c * 2) : p * 0 + c * 0'],
    ['multimodal', 'tier("base", p * 0.43 + c * 3.06 + img * 0.78 + ai * 3.81 + ao * 15.11)'],
    ['version prefix', 'v1:tier("base", p * 2 + c * 4)'],
  ]

  it.each(legacyCases)('round-trips %s without changing the expression', (_name, expr) => {
    expect(roundTrips(expr)).toBe(true)
  })

  it('round-trips a DNF tier condition', () => {
    const expr =
      '(p < 32000 && c < 200) || (len > 100000) ? tier("a", p * 1 + c * 2) : tier("b", p * 3 + c * 4)'
    expect(roundTrips(expr)).toBe(true)
  })

  it('marks the last chain segment as the fallback', () => {
    const config = tryParseVisualConfig(
      'len <= 200000 ? tier("standard", p * 3 + c * 15) : tier("long_context", p * 6 + c * 22.5)'
    )
    expect(config?.tiers[0].isFallback).toBe(false)
    expect(config?.tiers[1].isFallback).toBe(true)
  })
})

describe('tryParseVisualConfig rejects unrepresentable input (never resets)', () => {
  it.each([
    ['max() price body', 'max(p * 2, c * 8) + tier("base", p * 1 + c * 2)'],
    [
      'nested ternary',
      'len <= 128000 ? tier("a", p * 1) : (len <= 1000000 ? tier("b", p * 2) : tier("c", p * 3))',
    ],
  ])('returns null for %s', (_name, expr) => {
    expect(tryParseVisualConfig(expr)).toBeNull()
  })
})

describe('generateExprFromVisualConfig', () => {
  it('emits the explicitly-marked fallback last', () => {
    const config = normalizeVisualConfig({
      tiers: [
        normalizeVisualTier({
          label: 'a',
          conditions: [{ conditions: [{ var: 'len', op: '<', value: 100000 }] }],
          isFallback: false,
          input_unit_cost: 1,
          output_unit_cost: 2,
        }),
        normalizeVisualTier({
          label: 'fb',
          conditions: [],
          isFallback: true,
          input_unit_cost: 3,
          output_unit_cost: 4,
        }),
      ],
    })
    expect(generateExprFromVisualConfig(config)).toBe(
      'len < 100000 ? tier("a", p * 1 + c * 2) : tier("fb", p * 3 + c * 4)'
    )
  })

  it('degrades a non-fallback tier without conditions to a bare tier (validator flags it)', () => {
    const config = normalizeVisualConfig({
      tiers: [
        normalizeVisualTier({
          label: 'x',
          conditions: [],
          isFallback: false,
          input_unit_cost: 5,
          output_unit_cost: 6,
        }),
        normalizeVisualTier({
          label: 'fb',
          conditions: [],
          isFallback: true,
          input_unit_cost: 7,
          output_unit_cost: 8,
        }),
      ],
    })
    expect(stripWs(generateExprFromVisualConfig(config))).toBe(
      stripWs('tier("x", p * 5 + c * 6) : tier("fb", p * 7 + c * 8)')
    )
  })

  it('normalizeVisualConfig keeps exactly one fallback, defaulting to the last tier', () => {
    const config = normalizeVisualConfig({
      tiers: [
        normalizeVisualTier({
          label: 'a',
          conditions: [{ conditions: [{ var: 'len', op: '<', value: 100000 }] }],
          input_unit_cost: 1,
          output_unit_cost: 2,
        }),
        normalizeVisualTier({
          label: 'b',
          conditions: [],
          input_unit_cost: 3,
          output_unit_cost: 4,
        }),
      ],
    })
    expect(config.tiers.map((t) => t.isFallback)).toEqual([false, true])
  })

  it('defaults the empty config to a single zero fallback tier', () => {
    const config = createDefaultVisualConfig()
    expect(config.tiers).toHaveLength(1)
    expect(config.tiers[0].isFallback).toBe(true)
    expect(config.tiers[0].conditions).toEqual([])
  })
})
