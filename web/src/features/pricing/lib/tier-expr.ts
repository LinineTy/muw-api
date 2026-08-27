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
  BILLING_CACHE_VAR_MAP,
  BILLING_PRICING_VARS,
  buildTierDnfExpr,
  parseTierChain,
  type AndClause,
  type ParsedTier,
  type TierCondition,
  type TierConditionDnf,
} from './billing-expr'

export const CACHE_MODE_TIMED = 'timed'
export const CACHE_MODE_GENERIC = 'generic'
export type CacheMode = typeof CACHE_MODE_TIMED | typeof CACHE_MODE_GENERIC

export type VisualTier = {
  label: string
  conditions: TierConditionDnf
  /** The tier emitted last (bare) as the else-branch of the chain. */
  isFallback: boolean
  input_unit_cost: number
  output_unit_cost: number
  cache_mode: CacheMode
  cache_read_unit_cost?: number
  cache_create_unit_cost?: number
  cache_create_1h_unit_cost?: number
  image_unit_cost?: number
  image_output_unit_cost?: number
  audio_input_unit_cost?: number
  audio_output_unit_cost?: number
  [field: string]: unknown
}

export type VisualConfig = {
  tiers: VisualTier[]
}

export function getTierCacheMode(
  tier: Partial<VisualTier> | null | undefined
): CacheMode {
  if (tier?.cache_mode === CACHE_MODE_TIMED) return CACHE_MODE_TIMED
  if (tier?.cache_mode === CACHE_MODE_GENERIC) return CACHE_MODE_GENERIC
  return Number(tier?.cache_create_1h_unit_cost) > 0
    ? CACHE_MODE_TIMED
    : CACHE_MODE_GENERIC
}

// Legacy visual configs stored `conditions` as a flat atom array; the DNF model
// wraps them in a single AND-clause.
function isDnfConditions(value: unknown): value is TierConditionDnf {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    Array.isArray((value[0] as AndClause<TierCondition> | undefined)?.conditions)
  )
}

export function normalizeVisualTier(
  tier: Partial<VisualTier> = {}
): VisualTier {
  const rawConditions = Array.isArray(tier.conditions) ? tier.conditions : []
  let conditions: TierConditionDnf
  if (isDnfConditions(rawConditions)) {
    conditions = rawConditions
  } else if ((rawConditions as TierCondition[]).length > 0) {
    conditions = [{ conditions: rawConditions as TierCondition[] }]
  } else {
    conditions = []
  }
  return {
    ...tier,
    label: tier.label ?? '',
    conditions,
    isFallback: tier.isFallback === true,
    input_unit_cost: Number(tier.input_unit_cost) || 0,
    output_unit_cost: Number(tier.output_unit_cost) || 0,
    cache_mode: getTierCacheMode(tier),
    cache_read_unit_cost: Number(tier.cache_read_unit_cost) || 0,
    cache_create_unit_cost: Number(tier.cache_create_unit_cost) || 0,
    cache_create_1h_unit_cost: Number(tier.cache_create_1h_unit_cost) || 0,
    image_unit_cost: Number(tier.image_unit_cost) || 0,
    image_output_unit_cost: Number(tier.image_output_unit_cost) || 0,
    audio_input_unit_cost: Number(tier.audio_input_unit_cost) || 0,
    audio_output_unit_cost: Number(tier.audio_output_unit_cost) || 0,
  }
}

export function createDefaultVisualConfig(): VisualConfig {
  return {
    tiers: [
      normalizeVisualTier({
        conditions: [],
        input_unit_cost: 0,
        output_unit_cost: 0,
        label: 'base',
        cache_mode: CACHE_MODE_GENERIC,
        isFallback: true,
      }),
    ],
  }
}

export function normalizeVisualConfig(
  config: VisualConfig | null | undefined
): VisualConfig {
  if (!config || !Array.isArray(config.tiers) || config.tiers.length === 0) {
    return createDefaultVisualConfig()
  }
  const tiers = config.tiers.map((tier) => normalizeVisualTier(tier))
  // Exactly one fallback: honor an explicit marker, else the last tier. Duplicate
  // markers keep the last one.
  const markedIndexes = tiers
    .map((tier, index) => (tier.isFallback ? index : -1))
    .filter((index) => index >= 0)
  if (markedIndexes.length === 1) return { ...config, tiers }
  if (markedIndexes.length > 1) {
    const last = markedIndexes[markedIndexes.length - 1]
    return {
      ...config,
      tiers: tiers.map((tier, index) =>
        index === last ? tier : { ...tier, isFallback: false }
      ),
    }
  }
  return {
    ...config,
    tiers: tiers.map((tier, index) =>
      index === tiers.length - 1 ? { ...tier, isFallback: true } : tier
    ),
  }
}

function buildTierBodyExpr(tier: VisualTier): string {
  const parts: string[] = []
  const ic = Number(tier.input_unit_cost) || 0
  const oc = Number(tier.output_unit_cost) || 0
  parts.push(`p * ${ic}`)
  parts.push(`c * ${oc}`)
  for (const cv of BILLING_CACHE_VAR_MAP) {
    const v = Number((tier as Record<string, unknown>)[cv.field]) || 0
    if (v !== 0) parts.push(`${cv.exprVar} * ${v}`)
  }
  return parts.join(' + ')
}

function buildTierCall(tier: VisualTier): string {
  const label = tier.label || 'default'
  return `tier("${label}", ${buildTierBodyExpr(tier)})`
}

// A fallback tier with no label and every price at zero round-trips as the
// implicit `p * 0 + c * 0` leaf emitted for a lone conditional tier.
function isZeroFallbackTier(tier: VisualTier): boolean {
  if (tier.label) return false
  return BILLING_PRICING_VARS.every((v) => {
    if (!v.tierField) return true
    return Number(tier[v.tierField as keyof VisualTier] || 0) === 0
  })
}

export function generateExprFromVisualConfig(
  config: VisualConfig | null | undefined
): string {
  if (!config || !config.tiers || config.tiers.length === 0) {
    return 'p * 0 + c * 0'
  }
  const tiers = normalizeVisualConfig(config).tiers
  const fallbackIndex = tiers.findIndex((tier) => tier.isFallback)

  if (tiers.length === 1) {
    const tier = tiers[0]
    const cond = buildTierDnfExpr(tier.conditions)
    if (!cond) return buildTierCall(tier)
    return `${cond} ? ${buildTierCall(tier)} : p * 0 + c * 0`
  }

  // Non-fallback tiers emit in array order (`cond ? tier(...)`); the fallback
  // tier is always emitted last, bare. A non-fallback tier without conditions
  // degrades to a bare tier that shadows everything below — the editor validator
  // flags it explicitly instead of letting it drop silently.
  const parts: string[] = []
  for (let i = 0; i < tiers.length; i += 1) {
    if (i === fallbackIndex) continue
    const tier = tiers[i]
    const cond = buildTierDnfExpr(tier.conditions)
    parts.push(cond ? `${cond} ? ${buildTierCall(tier)}` : buildTierCall(tier))
  }
  const fallback = tiers[fallbackIndex]
  parts.push(
    isZeroFallbackTier(fallback) ? 'p * 0 + c * 0' : buildTierCall(fallback)
  )
  return parts.join(' : ')
}

export function tryParseVisualConfig(
  exprStr: string | null | undefined
): VisualConfig | null {
  if (!exprStr) return null
  try {
    let body = exprStr
    const versionMatch = body.match(/^v\d+:([\s\S]*)$/)
    if (versionMatch) body = versionMatch[1]

    const chain = parseTierChain(body)
    if (!chain || chain.length === 0) return null

    const tiers = chain.map((tier) => {
      const visual: Record<string, unknown> = {
        label: tier.label,
        conditions: tier.conditions,
        isFallback: tier.isFallback,
      }
      for (const v of BILLING_PRICING_VARS) {
        if (v.field && v.tierField) {
          visual[v.tierField] = Number(tier[v.field as keyof ParsedTier] || 0)
        }
      }
      return normalizeVisualTier(visual)
    })
    const config = normalizeVisualConfig({ tiers })

    // Strict round-trip: only accept expressions the visual model reproduces
    // byte-for-byte (modulo whitespace). Anything else stays in raw mode — never
    // a silent reset to a default config.
    const regenerated = generateExprFromVisualConfig(config)
    if (regenerated.replace(/\s+/g, '') !== body.replace(/\s+/g, '')) {
      return null
    }
    return config
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Local cost evaluator (for the estimator preview)
// ---------------------------------------------------------------------------

const ESTIMATOR_VARS = [
  { var: 'cr', stateKey: 'cacheReadTokens' },
  { var: 'cc', stateKey: 'cacheCreateTokens' },
  { var: 'cc1h', stateKey: 'cacheCreate1hTokens' },
  { var: 'img', stateKey: 'imageTokens' },
  { var: 'img_o', stateKey: 'imageOutputTokens' },
  { var: 'ai', stateKey: 'audioInputTokens' },
  { var: 'ao', stateKey: 'audioOutputTokens' },
] as const

export type ExtraTokenValues = Record<
  (typeof ESTIMATOR_VARS)[number]['stateKey'],
  number
>

export type EvalResult = {
  cost: number
  matchedTier: string
  error: string | null
}

export function evalExprLocally(
  exprStr: string,
  promptTokens: number,
  completionTokens: number,
  extraTokenValues: ExtraTokenValues
): EvalResult {
  try {
    if (!exprStr || !exprStr.trim()) {
      return { cost: 0, matchedTier: '', error: null }
    }
    let matchedTier = ''
    const tierFn = (name: string, value: number) => {
      matchedTier = name
      return value
    }
    const cacheReadTokens = extraTokenValues.cacheReadTokens || 0
    const cacheCreateTokens = extraTokenValues.cacheCreateTokens || 0
    const cacheCreate1hTokens = extraTokenValues.cacheCreate1hTokens || 0
    const len =
      promptTokens + cacheReadTokens + cacheCreateTokens + cacheCreate1hTokens
    const env: Record<string, unknown> = {
      p: promptTokens,
      c: completionTokens,
      len,
      tier: tierFn,
      max: Math.max,
      min: Math.min,
      abs: Math.abs,
      ceil: Math.ceil,
      floor: Math.floor,
    }
    for (const field of ESTIMATOR_VARS) {
      env[field.var] = extraTokenValues[field.stateKey] || 0
    }
    const fn = new Function(
      ...Object.keys(env),
      `"use strict"; return (${exprStr});`
    )
    const cost = Number(fn(...Object.values(env))) || 0
    return { cost, matchedTier, error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { cost: 0, matchedTier: '', error: message }
  }
}

export function exprUsesExtraVars(exprStr: string): boolean {
  if (!exprStr) return false
  const varNames = ESTIMATOR_VARS.map((f) => f.var).join('|')
  return new RegExp(`\\b(${varNames})\\b`).test(exprStr)
}

export const ESTIMATOR_EXTRA_FIELDS = ESTIMATOR_VARS
