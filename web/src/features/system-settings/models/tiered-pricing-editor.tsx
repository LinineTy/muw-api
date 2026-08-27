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
import { AlertTriangle, ChevronDown, Copy, Plus, Trash2 } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { DraftNumberInput } from '@/components/ui/draft-number-input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  BILLING_EXTRA_VARS,
  BILLING_VARS,
  COMMON_TIMEZONES,
  MATCH_CONTAINS,
  MATCH_EQ,
  MATCH_EXISTS,
  MATCH_GT,
  MATCH_GTE,
  MATCH_LT,
  MATCH_LTE,
  MATCH_RANGE,
  SOURCE_HEADER,
  SOURCE_PARAM,
  SOURCE_TIME,
  TIME_FUNCS,
  buildRequestRuleExpr,
  buildTierDnfExpr,
  combineBillingExpr,
  createEmptyCondition,
  createEmptyRuleGroup,
  createEmptyTimeCondition,
  getRequestRuleMatchOptions,
  splitBillingExprAndRequestRules,
  tryParseRequestRuleExpr,
  type ParamHeaderCondition,
  type RequestCondition,
  type RequestDnf,
  type RequestRuleGroup,
  type TierCondition,
  type TierConditionDnf,
  type TierConditionVar,
  type TimeCondition,
  type TimeFunc,
} from '@/features/pricing/lib/billing-expr'
import {
  checkRequestDnfIssues,
  formatRequestDnfText,
  formatTierDnfText,
  formatTokenHint,
  type ConditionIssue,
} from '@/features/pricing/lib/condition-format'
import {
  CACHE_MODE_GENERIC,
  CACHE_MODE_TIMED,
  type CacheMode,
  type ExtraTokenValues,
  type VisualConfig,
  type VisualTier,
  createDefaultVisualConfig,
  evalExprLocally,
  exprUsesExtraVars,
  generateExprFromVisualConfig,
  getTierCacheMode,
  normalizeVisualConfig,
  normalizeVisualTier,
  tryParseVisualConfig,
} from '@/features/pricing/lib/tier-expr'
import { cn } from '@/lib/utils'
import { ConditionBuilder } from './condition-builder'

const PRICE_SUFFIX = '$/1M tokens'
const CACHE_PRICE_VARS = BILLING_EXTRA_VARS.filter(
  (variable) => variable.group === 'cache'
)
const MEDIA_PRICE_VARS = BILLING_EXTRA_VARS.filter(
  (variable) => variable.group === 'media'
)

const CONDITION_INPUT_OPTIONS: {
  value: TierConditionVar
  labelKey: string
}[] = BILLING_VARS.map((v) => ({
  value: v.key as TierConditionVar,
  labelKey: v.shortLabel,
}))
const OPS: TierCondition['op'][] = ['<', '<=', '>', '>=']
// 0 = Sunday .. 6 = Saturday, matching time.Weekday() in the backend engine.
const WEEKDAY_OPTIONS = [0, 1, 2, 3, 4, 5, 6]

type Preset = {
  key: string
  label: string
  expr: string
  requestRules?: RequestRuleGroup[]
}

type PresetGroup = {
  group: string
  presets: Preset[]
}

const PRESET_GROUPS: PresetGroup[] = [
  {
    group: 'Fixed price',
    presets: [
      { key: 'flat', label: 'Flat', expr: 'tier("base", p * 2 + c * 4)' },
      {
        key: 'claude-opus',
        label: 'Claude Opus 4.6',
        expr: 'tier("base", p * 5 + c * 25 + cr * 0.5 + cc * 6.25 + cc1h * 10)',
      },
      {
        key: 'gpt-5.4',
        label: 'GPT-5.4',
        expr: 'len <= 272000 ? tier("standard", p * 2.5 + c * 15 + cr * 0.25) : tier("long_context", p * 5 + c * 22.5 + cr * 0.5)',
      },
    ],
  },
  {
    group: 'Tiered',
    presets: [
      {
        key: 'claude-sonnet',
        label: 'Claude Sonnet 4.5',
        expr: 'len <= 200000 ? tier("standard", p * 3 + c * 15 + cr * 0.3 + cc * 3.75 + cc1h * 6) : tier("long_context", p * 6 + c * 22.5 + cr * 0.6 + cc * 7.5 + cc1h * 12)',
      },
      {
        key: 'qwen3-max',
        label: 'Qwen3 Max',
        expr: 'len <= 32000 ? tier("short", p * 1.2 + c * 6 + cr * 0.24 + cc * 1.5) : len <= 128000 ? tier("mid", p * 2.4 + c * 12 + cr * 0.48 + cc * 3) : tier("long", p * 3 + c * 15 + cr * 0.6 + cc * 3.75)',
      },
      {
        key: 'glm-4.5-air',
        label: 'GLM-4.5 Air',
        expr: 'len < 32000 && c < 200 ? tier("short_output", p * 0.8 + c * 2 + cr * 0.16) : len < 32000 && c >= 200 ? tier("long_output", p * 0.8 + c * 6 + cr * 0.16) : tier("mid_context", p * 1.2 + c * 8 + cr * 0.24)',
      },
      {
        key: 'doubao-seed-1.8',
        label: 'Doubao Seed 1.8',
        expr: 'len <= 32000 && c <= 200 ? tier("discount", p * 0.8 + c * 2 + cr * 0.16 + cc * 0.17) : len <= 32000 ? tier("short", p * 0.8 + c * 8 + cr * 0.16 + cc * 0.17) : len <= 128000 ? tier("mid", p * 1.2 + c * 16 + cr * 0.16 + cc * 0.17) : tier("long", p * 2.4 + c * 24 + cr * 0.16 + cc * 0.17)',
      },
    ],
  },
  {
    group: 'Multimodal',
    presets: [
      {
        key: 'gpt-image-1-mini',
        label: 'GPT Image 1 Mini',
        expr: 'tier("base", p * 2 + c * 8 + img * 2.5)',
      },
      {
        key: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        expr: 'tier("base", p * 0.3 + c * 2.5 + cr * 0.03 + ai * 1.0)',
      },
      {
        key: 'gemini-3-pro-image',
        label: 'Gemini 3 Pro Image',
        expr: 'tier("base", p * 2 + c * 12 + img_o * 120)',
      },
      {
        key: 'qwen3-omni-flash',
        label: 'Qwen3 Omni Flash',
        expr: 'tier("base", p * 0.43 + c * 3.06 + img * 0.78 + ai * 3.81 + ao * 15.11)',
      },
    ],
  },
  {
    group: 'Request rule',
    presets: [
      {
        key: 'claude-opus-fast',
        label: 'Claude Opus 4.6 Fast',
        expr: 'tier("base", p * 5 + c * 25 + cr * 0.5 + cc * 6.25 + cc1h * 10)',
        requestRules: [
          {
            conditions: [{ conditions: [
              {
                source: SOURCE_HEADER as 'header',
                path: 'anthropic-beta',
                mode: MATCH_CONTAINS,
                value: 'fast-mode-2026-02-01',
              },
            ] }],
            multiplier: '6',
          },
        ],
      },
      {
        key: 'gpt-5.4-tiers',
        label: 'GPT-5.4 Priority/Flex',
        expr: 'len <= 272000 ? tier("standard", p * 2.5 + c * 15 + cr * 0.25) : tier("long_context", p * 5 + c * 22.5 + cr * 0.5)',
        requestRules: [
          {
            conditions: [{ conditions: [
              {
                source: SOURCE_PARAM as 'param',
                path: 'service_tier',
                mode: MATCH_EQ,
                value: 'priority',
              },
            ] }],
            multiplier: '2',
          },
          {
            conditions: [{ conditions: [
              {
                source: SOURCE_PARAM as 'param',
                path: 'service_tier',
                mode: MATCH_EQ,
                value: 'flex',
              },
            ] }],
            multiplier: '0.5',
          },
        ],
      },
    ],
  },
  {
    group: 'Time-based',
    presets: [
      {
        key: 'night-discount',
        label: 'Night discount (50%)',
        expr: 'tier("base", p * 3 + c * 15)',
        requestRules: [
          {
            conditions: [{ conditions: [
              {
                source: SOURCE_TIME as 'time',
                timeFunc: 'hour',
                timezone: 'Asia/Shanghai',
                mode: MATCH_RANGE,
                value: '',
                rangeStart: '21',
                rangeEnd: '6',
              },
            ] }],
            multiplier: '0.5',
          },
        ],
      },
      {
        key: 'weekend-discount',
        label: 'Weekend discount (80%)',
        expr: 'tier("base", p * 3 + c * 15)',
        requestRules: [
          {
            conditions: [{ conditions: [
              {
                source: SOURCE_TIME as 'time',
                timeFunc: 'weekday',
                timezone: 'Asia/Shanghai',
                mode: MATCH_EQ,
                value: '0',
                rangeStart: '',
                rangeEnd: '',
              },
            ] }],
            multiplier: '0.8',
          },
          {
            conditions: [{ conditions: [
              {
                source: SOURCE_TIME as 'time',
                timeFunc: 'weekday',
                timezone: 'Asia/Shanghai',
                mode: MATCH_EQ,
                value: '6',
                rangeStart: '',
                rangeEnd: '',
              },
            ] }],
            multiplier: '0.8',
          },
        ],
      },
    ],
  },
]

function unitCostToPrice(uc: number | string): number {
  return Number(uc) || 0
}

function priceToUnitCost(price: number | string): number {
  return Number(price) || 0
}

// ---------------------------------------------------------------------------
// Tier condition row
// ---------------------------------------------------------------------------

type TierConditionRowProps = {
  condition: TierCondition
  onChange: (next: TierCondition) => void
  onRemove: () => void
}

function TierConditionRow({
  condition,
  onChange,
  onRemove,
}: TierConditionRowProps) {
  const { t } = useTranslation()
  const currentInputOption = CONDITION_INPUT_OPTIONS.find(
    (option) => option.value === condition.var
  )

  return (
    <div className='flex items-center gap-2'>
      <Select
        items={[
          ...CONDITION_INPUT_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          })),
        ]}
        value={condition.var}
        onValueChange={(value) =>
          onChange({ ...condition, var: value as TierCondition['var'] })
        }
      >
        <SelectTrigger className='w-32' size='sm'>
          <SelectValue>
            {currentInputOption
              ? t(currentInputOption.labelKey)
              : condition.var}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {CONDITION_INPUT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        items={OPS.map((op) => ({ value: op, label: op }))}
        value={condition.op}
        onValueChange={(value) =>
          onChange({ ...condition, op: value as TierCondition['op'] })
        }
      >
        <SelectTrigger className='w-20' size='sm'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {OPS.map((op) => (
              <SelectItem key={op} value={op}>
                {op}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <DraftNumberInput
        min={0}
        value={condition.value}
        onValueChange={(value) =>
          onChange({ ...condition, value: Number(value) || 0 })
        }
        placeholder='tokens'
        className='w-32'
      />
      <span className='text-muted-foreground text-xs'>
        {formatTokenHint(condition.value)}
      </span>
      <Button
        variant='ghost'
        size='icon'
        onClick={onRemove}
        aria-label='remove'
        className='ml-auto'
      >
        <Trash2 className='text-destructive h-4 w-4' />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Price input field
// ---------------------------------------------------------------------------

type PriceFieldProps = {
  label: string
  hint?: string
  value: number
  onChange: (next: number) => void
}

function PriceField({ label, hint, value, onChange }: PriceFieldProps) {
  return (
    <div className='w-36 space-y-0.5'>
      <Label className='text-muted-foreground text-xs'>{label}</Label>
      <DraftNumberInput
        min={0}
        step={0.000001}
        value={Number.isFinite(value) ? value : 0}
        onValueChange={onChange}
        className='h-8 w-full'
      />
      {hint && <p className='text-muted-foreground text-xs'>{hint}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single tier card (visual editor)
// ---------------------------------------------------------------------------

type VisualTierCardProps = {
  tier: VisualTier
  index: number
  total: number
  onChange: (next: VisualTier) => void
  onRemove: () => void
  onMakeFallback: () => void
}

function VisualTierCard({
  tier,
  index,
  total,
  onChange,
  onRemove,
  onMakeFallback,
}: VisualTierCardProps) {
  const { t } = useTranslation()
  const cacheMode = getTierCacheMode(tier)

  const handleConditionsChange = (conditions: TierConditionDnf) => {
    onChange({ ...tier, conditions })
  }

  const handlePriceChange = (field: keyof VisualTier, value: number) => {
    onChange({ ...tier, [field]: value })
  }

  const handleCacheModeChange = (mode: CacheMode) => {
    onChange({
      ...tier,
      cache_mode: mode,
      cache_create_1h_unit_cost:
        mode === CACHE_MODE_TIMED ? (tier.cache_create_1h_unit_cost ?? 0) : 0,
    })
  }

  const inputUnitPrice = unitCostToPrice(tier.input_unit_cost)
  const outputUnitPrice = unitCostToPrice(tier.output_unit_cost)
  const hasMediaPricing = MEDIA_PRICE_VARS.some((variable) => {
    const fieldKey = variable.tierField as keyof VisualTier
    return unitCostToPrice((tier[fieldKey] as number | undefined) ?? 0) > 0
  })
  const [mediaOpen, setMediaOpen] = useState(hasMediaPricing)

  useEffect(() => {
    if (hasMediaPricing) setMediaOpen(true)
  }, [hasMediaPricing])

  const renderPriceVariable = (
    variable: (typeof BILLING_EXTRA_VARS)[number]
  ) => {
    const fieldKey = variable.tierField as keyof VisualTier
    const value = unitCostToPrice((tier[fieldKey] as number | undefined) ?? 0)

    return (
      <PriceField
        key={variable.key}
        label={t(variable.label)}
        value={value}
        onChange={(next) => handlePriceChange(fieldKey, priceToUnitCost(next))}
      />
    )
  }

  return (
    <div className='space-y-3 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <Badge variant='outline'>
            {t('Tier')} {index + 1} / {total}
          </Badge>
          {tier.isFallback && (
            <Badge variant='secondary'>{t('Fallback tier')}</Badge>
          )}
          <Input
            value={tier.label}
            onChange={(event) =>
              onChange({ ...tier, label: event.target.value })
            }
            placeholder={t('Tier name')}
            className='h-7 w-36'
          />
          {!tier.isFallback && (
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={onMakeFallback}
            >
              {t('Make fallback')}
            </Button>
          )}
        </div>
        <Button
          variant='ghost'
          size='icon'
          onClick={onRemove}
          disabled={total <= 1}
          aria-label={t('Remove tier')}
        >
          <Trash2 className='text-destructive h-4 w-4' />
        </Button>
      </div>

      {/* Conditions */}
      {tier.isFallback ? (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Fallback tier matches when no other tier applies. It cannot have conditions.'
          )}
        </p>
      ) : (
        <ConditionBuilder<TierCondition>
          dnf={tier.conditions}
          onChange={handleConditionsChange}
          renderRow={({ value, onChange: onRowChange, onRemove: onRowRemove }) => (
            <TierConditionRow
              condition={value}
              onChange={onRowChange}
              onRemove={onRowRemove}
            />
          )}
          createEmptyAtom={() => ({
            var: 'len',
            op: '<' as const,
            value: 200000,
          })}
          rowAddLabel={t('Add condition')}
          branchAddLabel={t('Add OR branch')}
          orLabel={t('OR')}
          clauseSeparator={t('AND')}
          preview={formatTierDnfText(tier.conditions, t)}
          translateIssue={t}
        />
      )}

      <div className='space-y-2'>
        <div className='flex items-center justify-between gap-3'>
          <Label className='text-sm font-semibold'>{t('Token prices')}</Label>
          <span className='bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs'>
            {PRICE_SUFFIX}
          </span>
        </div>

        <div className='space-y-3'>
          <div className='flex flex-wrap gap-x-4 gap-y-2'>
            <PriceField
              label={t('Input price')}
              value={inputUnitPrice}
              onChange={(value) =>
                handlePriceChange('input_unit_cost', priceToUnitCost(value))
              }
            />
            <PriceField
              label={t('Output price')}
              value={outputUnitPrice}
              onChange={(value) =>
                handlePriceChange('output_unit_cost', priceToUnitCost(value))
              }
            />
          </div>

          <div className='space-y-2'>
            <div className='flex h-7 items-center'>
              <Tabs
                value={cacheMode}
                onValueChange={(value) =>
                  value !== null && handleCacheModeChange(value as CacheMode)
                }
              >
                <TabsList className='h-8'>
                  <TabsTrigger
                    value={CACHE_MODE_GENERIC}
                    className='px-2 text-xs'
                  >
                    {t('Generic cache')}
                  </TabsTrigger>
                  <TabsTrigger
                    value={CACHE_MODE_TIMED}
                    className='px-2 text-xs'
                  >
                    {t('Time-sliced cache (Claude)')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className='flex flex-wrap gap-x-4 gap-y-2'>
              {CACHE_PRICE_VARS.map((variable) => {
                if (variable.key === 'cc1h' && cacheMode !== CACHE_MODE_TIMED) {
                  return null
                }
                return renderPriceVariable(variable)
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Media prices */}
      <div className='space-y-1.5'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 px-2 text-xs'
          onClick={() => setMediaOpen((prev) => !prev)}
        >
          <ChevronDown
            className={cn(
              'mr-1 h-3 w-3 transition-transform',
              mediaOpen && 'rotate-180'
            )}
          />
          {t('Media pricing')}
        </Button>
        {mediaOpen && (
          <div className='flex flex-wrap gap-x-4 gap-y-2'>
            {MEDIA_PRICE_VARS.map(renderPriceVariable)}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Visual editor (list of tiers)
// ---------------------------------------------------------------------------

type VisualEditorProps = {
  visualConfig: VisualConfig | null
  onChange: (next: VisualConfig) => void
}

function VisualEditor({ visualConfig, onChange }: VisualEditorProps) {
  const { t } = useTranslation()
  const config = useMemo(
    () => normalizeVisualConfig(visualConfig),
    [visualConfig]
  )

  const handleTierChange = (index: number, next: VisualTier) => {
    const tiers = [...config.tiers]
    tiers[index] = normalizeVisualTier(next)
    onChange({ ...config, tiers })
  }

  const handleAddTier = () => {
    const tiers = [...config.tiers]
    const fallbackIndex = config.tiers.findIndex((tier) => tier.isFallback)
    // Insert before the fallback so evaluation order matches visual order. The
    // new tier gets a visible, editable default condition — never a silent bound
    // injected into an existing tier.
    const newTier = normalizeVisualTier({
      label: `tier_${tiers.length + 1}`,
      conditions: [{ conditions: [{ var: 'len', op: '<', value: 200000 }] }],
      input_unit_cost: 0,
      output_unit_cost: 0,
    })
    tiers.splice(fallbackIndex >= 0 ? fallbackIndex : tiers.length, 0, newTier)
    onChange({ ...config, tiers })
  }

  const handleRemoveTier = (index: number) => {
    const tiers = config.tiers.filter((_, i) => i !== index)
    onChange({ ...config, tiers: tiers.length > 0 ? tiers : config.tiers })
  }

  // Explicitly marking a tier as the fallback moves it last and clears its
  // conditions (a fallback is by definition unconditional).
  const handleMakeFallback = (index: number) => {
    const unmarked = config.tiers.map((tier) => ({ ...tier, isFallback: false }))
    const fallback = normalizeVisualTier({
      ...unmarked[index],
      conditions: [],
      isFallback: true,
    })
    const rest = unmarked.filter((_, i) => i !== index)
    onChange({ ...config, tiers: [...rest, fallback] })
  }

  const validationIssues = useMemo(() => {
    const issues: string[] = []
    config.tiers.forEach((tier, index) => {
      // A tier with no conditions — or only empty OR branches, which serialize
      // to nothing — degrades to an unconditional bare tier that shadows every
      // tier below it. Test the serialized form so both shapes are caught.
      if (!tier.isFallback && buildTierDnfExpr(tier.conditions) === '') {
        issues.push(
          t('Tier {{index}} always matches and hides the tiers below it. Add a condition or remove it.', {
            index: index + 1,
          })
        )
      }
    })
    return issues
  }, [config, t])

  return (
    <div className='space-y-2'>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Each tier is checked in order; the first matching tier applies. Mark one tier as the fallback (the last one by default) — it matches when no other tier applies.'
        )}
      </p>
      {validationIssues.length > 0 && (
        <div className='flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2'>
          <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive' />
          <div className='space-y-0.5'>
            {validationIssues.map((issue) => (
              <p key={issue} className='text-destructive text-xs'>
                {issue}
              </p>
            ))}
          </div>
        </div>
      )}
      {config.tiers.map((tier, index) => (
        <VisualTierCard
          key={index}
          tier={tier}
          index={index}
          total={config.tiers.length}
          onChange={(next) => handleTierChange(index, next)}
          onRemove={() => handleRemoveTier(index)}
          onMakeFallback={() => handleMakeFallback(index)}
        />
      ))}
      <Button
        variant='outline'
        size='sm'
        className='h-9 w-36 justify-center'
        onClick={handleAddTier}
      >
        <Plus className='mr-2 h-4 w-4' />
        {t('Add tier')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Raw expression editor
// ---------------------------------------------------------------------------

type RawExprEditorProps = {
  exprString: string
  onChange: (value: string) => void
}

function RawExprEditor({ exprString, onChange }: RawExprEditorProps) {
  const { t } = useTranslation()
  return (
    <div className='space-y-3'>
      <Alert>
        <AlertDescription className='space-y-1 text-xs'>
          <div>
            {t('Variables')}: <code>len</code>, <code>p</code>, <code>c</code>,{' '}
            <code>cr</code>, <code>cc</code>, <code>cc1h</code>,{' '}
            <code>img</code>, <code>img_o</code>, <code>ai</code>,{' '}
            <code>ao</code>
          </div>
          <div>
            {t('Functions')}: <code>tier(name, value)</code>, <code>max</code>,{' '}
            <code>min</code>, <code>ceil</code>, <code>floor</code>,{' '}
            <code>abs</code>, <code>header(name)</code>,{' '}
            <code>param(path)</code>, <code>has(source, text)</code>
          </div>
        </AlertDescription>
      </Alert>
      <Textarea
        value={exprString}
        onChange={(event) => onChange(event.target.value)}
        placeholder='tier("base", p * 3 + c * 15)'
        rows={6}
        className='font-mono text-xs'
        spellCheck={false}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Request rule condition row
// ---------------------------------------------------------------------------

type RuleConditionRowProps = {
  condition: RequestCondition
  onChange: (next: RequestCondition) => void
  onRemove: () => void
  /** Row-level issues (conditionIndex matching this row), from the group check. */
  issues?: ConditionIssue[]
}

function RuleConditionRow({
  condition,
  onChange,
  onRemove,
  issues,
}: RuleConditionRowProps) {
  const { t } = useTranslation()
  const matchOptions = getRequestRuleMatchOptions(condition.source)
  const getMatchLabel = (mode: string) => {
    switch (mode) {
      case MATCH_EQ:
        return t('Equals')
      case MATCH_CONTAINS:
        return t('Contains')
      case MATCH_EXISTS:
        return t('Exists')
      case MATCH_GT:
        return t('Greater than')
      case MATCH_GTE:
        return t('Greater than or equal')
      case MATCH_LT:
        return t('Less than')
      case MATCH_LTE:
        return t('Less than or equal')
      case MATCH_RANGE:
        return t('Overnight range')
      default:
        return mode
    }
  }
  const getTimeFuncLabel = (timeFunc: TimeFunc) => {
    switch (timeFunc) {
      case 'hour':
        return t('Hour of day')
      case 'minute':
        return t('Minute')
      case 'weekday':
        return t('Weekday')
      case 'month':
        return t('Month number')
      case 'day':
        return t('Day of month')
      default:
        return timeFunc
    }
  }
  const sourceLabel =
    condition.source === SOURCE_PARAM
      ? t('Body param')
      : condition.source === SOURCE_HEADER
        ? t('Header')
        : t('Time')

  const handleSourceChange = (source: string) => {
    if (source === SOURCE_TIME) {
      onChange(createEmptyTimeCondition())
    } else if (source === SOURCE_HEADER || source === SOURCE_PARAM) {
      onChange({
        ...createEmptyCondition(),
        source: source as 'param' | 'header',
      })
    }
  }

  const handleModeChange = (mode: string) => {
    onChange({ ...condition, mode } as RequestCondition)
  }

  const renderTimeValueInput = (timeCond: TimeCondition) => {
    if (timeCond.mode === MATCH_EQ && timeCond.timeFunc === 'weekday') {
      return (
        <Select
          items={WEEKDAY_OPTIONS.map((day) => ({
            value: String(day),
            label: t(`Every week on day ${day}`),
          }))}
          value={timeCond.value}
          onValueChange={(value) =>
            value !== null && onChange({ ...timeCond, value: String(value) })
          }
        >
          <SelectTrigger className='w-32' size='sm'>
            <SelectValue>
              {/^[0-6]$/.test(timeCond.value)
                ? t(`Every week on day ${timeCond.value}`)
                : t('Every week')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {WEEKDAY_OPTIONS.map((day) => (
                <SelectItem key={day} value={String(day)}>
                  {t(`Every week on day ${day}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    }
    if (timeCond.mode === MATCH_RANGE) {
      return (
        <>
          <DraftNumberInput
            value={timeCond.rangeStart}
            onValueChange={(value) =>
              onChange({ ...timeCond, rangeStart: String(value) })
            }
            placeholder={t('Start')}
            className='w-20'
          />
          <span className='text-muted-foreground text-xs'>~</span>
          <DraftNumberInput
            value={timeCond.rangeEnd}
            onValueChange={(value) =>
              onChange({ ...timeCond, rangeEnd: String(value) })
            }
            placeholder={t('End')}
            className='w-20'
          />
        </>
      )
    }
    return (
      <DraftNumberInput
        value={timeCond.value}
        onValueChange={(value) =>
          onChange({ ...timeCond, value: String(value) })
        }
        placeholder={t('Value')}
        className='w-24'
      />
    )
  }

  const renderTimeCondition = (timeCond: TimeCondition) => (
    <>
      <Select
        items={[
          ...TIME_FUNCS.map((fn) => ({
            value: fn,
            label: getTimeFuncLabel(fn),
          })),
        ]}
        value={timeCond.timeFunc}
        onValueChange={(value) =>
          onChange({ ...timeCond, timeFunc: value as TimeFunc })
        }
      >
        <SelectTrigger className='w-32' size='sm'>
          <SelectValue>{getTimeFuncLabel(timeCond.timeFunc)}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {TIME_FUNCS.map((fn) => (
              <SelectItem key={fn} value={fn}>
                {getTimeFuncLabel(fn)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        items={[
          ...COMMON_TIMEZONES.map((tz) => ({
            value: tz.value,
            label: tz.label,
          })),
        ]}
        value={timeCond.timezone}
        onValueChange={(value) =>
          value !== null && onChange({ ...timeCond, timezone: value })
        }
      >
        <SelectTrigger className='w-56' size='sm'>
          <SelectValue>
            {COMMON_TIMEZONES.find((tz) => tz.value === timeCond.timezone)
              ?.label ?? timeCond.timezone}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {COMMON_TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        items={[
          ...matchOptions.map((option) => ({
            value: option.value,
            label: getMatchLabel(option.value),
          })),
        ]}
        value={timeCond.mode}
        onValueChange={(v) => v !== null && handleModeChange(v)}
      >
        <SelectTrigger className='w-32' size='sm'>
          <SelectValue>{getMatchLabel(timeCond.mode)}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {matchOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {getMatchLabel(option.value)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {renderTimeValueInput(timeCond)}
    </>
  )

  const renderParamHeaderCondition = (phCond: ParamHeaderCondition) => (
    <>
      <Input
        value={phCond.path}
        onChange={(event) => onChange({ ...phCond, path: event.target.value })}
        placeholder={
          phCond.source === SOURCE_HEADER ? 'X-Header-Name' : 'service_tier'
        }
        className='w-44'
      />
      <Select
        items={[
          ...matchOptions.map((option) => ({
            value: option.value,
            label: getMatchLabel(option.value),
          })),
        ]}
        value={phCond.mode}
        onValueChange={(v) => v !== null && handleModeChange(v)}
      >
        <SelectTrigger className='w-32' size='sm'>
          <SelectValue>{getMatchLabel(phCond.mode)}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {matchOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {getMatchLabel(option.value)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {phCond.mode !== MATCH_EXISTS && (
        <Input
          value={phCond.value}
          onChange={(event) =>
            onChange({ ...phCond, value: event.target.value })
          }
          placeholder={t('Value')}
          className='w-44'
        />
      )}
    </>
  )

  // The group card header renders the natural-language live preview for the
  // whole group; a per-row preview would just repeat the controls above it.
  // Only issues (incomplete / always-match / never-match) render under a row.

  return (
    <div className='space-y-1'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          items={[
            { value: SOURCE_PARAM, label: t('Body param') },
            { value: SOURCE_HEADER, label: t('Header') },
            { value: SOURCE_TIME, label: t('Time') },
          ]}
          value={condition.source}
          onValueChange={(v) => v !== null && handleSourceChange(v)}
        >
          <SelectTrigger className='w-28' size='sm'>
            <SelectValue>{sourceLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectItem value={SOURCE_PARAM}>{t('Body param')}</SelectItem>
              <SelectItem value={SOURCE_HEADER}>{t('Header')}</SelectItem>
              <SelectItem value={SOURCE_TIME}>{t('Time')}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {condition.source === SOURCE_TIME
          ? renderTimeCondition(condition as TimeCondition)
          : renderParamHeaderCondition(condition as ParamHeaderCondition)}
        <Button
          variant='ghost'
          size='icon'
          onClick={onRemove}
          aria-label={t('Remove condition')}
          className='ml-auto'
        >
          <Trash2 className='text-destructive h-4 w-4' />
        </Button>
      </div>
      {issues && issues.length > 0 && (
        <div className='space-y-0.5 pl-0.5'>
          {issues.map((issue) => (
            <p
              key={issue.key}
              className={cn(
                'text-xs',
                issue.severity === 'error'
                  ? 'text-destructive'
                  : 'text-amber-600 dark:text-amber-400'
              )}
            >
              {t(issue.key, issue.params)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Request rule group card
// ---------------------------------------------------------------------------

type RuleGroupCardProps = {
  group: RequestRuleGroup
  onChange: (next: RequestRuleGroup) => void
  onRemove: () => void
}

function RuleGroupCard({ group, onChange, onRemove }: RuleGroupCardProps) {
  const { t } = useTranslation()
  const issues = useMemo(
    () => checkRequestDnfIssues(group.conditions, t),
    [group.conditions, t]
  )
  const summary = formatRequestDnfText(group.conditions, t)

  const handleConditionsChange = (conditions: RequestDnf) => {
    onChange({ ...group, conditions })
  }

  return (
    <div className='space-y-3 rounded-lg border p-3'>
      {/* Header: the × multiplier is the whole point of a rule — edit it right
          here, with the natural-language condition summary as the live preview. */}
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-1.5'>
          <span className='text-muted-foreground text-sm' aria-hidden='true'>
            ×
          </span>
          <DraftNumberInput
            min={0}
            step={0.000001}
            value={group.multiplier}
            onValueChange={(value) =>
              onChange({ ...group, multiplier: String(value) })
            }
            className='w-20 text-sm'
            placeholder='1.0'
            aria-label={t('Multiplier')}
          />
        </div>
        <Button
          variant='ghost'
          size='icon'
          onClick={onRemove}
          aria-label={t('Remove rule group')}
        >
          <Trash2 className='text-destructive h-4 w-4' />
        </Button>
      </div>

      <ConditionBuilder<RequestCondition>
        dnf={group.conditions}
        onChange={handleConditionsChange}
        renderRow={({
          value,
          onChange: onRowChange,
          onRemove: onRowRemove,
          issues: rowIssues,
        }) => (
          <RuleConditionRow
            condition={value}
            onChange={onRowChange}
            onRemove={onRowRemove}
            issues={rowIssues}
          />
        )}
        createEmptyAtom={() => createEmptyCondition()}
        rowAddLabel={t('Add condition')}
        branchAddLabel={t('Add OR branch')}
        orLabel={t('OR')}
        clauseSeparator={t('AND')}
        preview={summary || undefined}
        issues={issues}
        translateIssue={t}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

type CollapsibleSectionProps = {
  title: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
  contentClassName?: string
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  className,
  contentClassName,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='h-8 w-full justify-start px-2 text-xs font-medium text-muted-foreground hover:text-foreground'
          />
        }
      >
        <ChevronDown
          className={cn(
            'mr-1 h-3.5 w-3.5 transition-transform',
            open && 'rotate-180'
          )}
        />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('mt-2', contentClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Preset section
// ---------------------------------------------------------------------------

type PresetSectionProps = {
  applyPreset: (preset: Preset) => void
}

function PresetSection({ applyPreset }: PresetSectionProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? PRESET_GROUPS : PRESET_GROUPS.slice(0, 2)
  const hasMore = PRESET_GROUPS.length > 2

  return (
    <div className='space-y-2'>
      <div className='space-y-1'>
        {visible.map((presetGroup) => (
          <div
            key={presetGroup.group}
            className='flex flex-wrap items-center gap-2'
          >
            <Badge variant='secondary' className='min-w-[60px] justify-center'>
              {t(presetGroup.group)}
            </Badge>
            {presetGroup.presets.map((preset) => (
              <Button
                key={preset.key}
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        ))}
      </div>
      {hasMore && (
        <Button
          variant='ghost'
          size='sm'
          className='h-6 px-2 text-xs'
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? t('Collapse') : t('More templates...')}
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cost estimator
// ---------------------------------------------------------------------------

type EstimatorProps = {
  effectiveExpr: string
}

function CostEstimator({ effectiveExpr }: EstimatorProps) {
  const { t } = useTranslation()
  const [promptTokens, setPromptTokens] = useState(0)
  const [completionTokens, setCompletionTokens] = useState(0)
  const [extras, setExtras] = useState<ExtraTokenValues>({
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    cacheCreate1hTokens: 0,
    imageTokens: 0,
    imageOutputTokens: 0,
    audioInputTokens: 0,
    audioOutputTokens: 0,
  })

  const usesExtras = useMemo(
    () => exprUsesExtraVars(effectiveExpr),
    [effectiveExpr]
  )

  const result = useMemo(
    () =>
      evalExprLocally(effectiveExpr, promptTokens, completionTokens, extras),
    [effectiveExpr, promptTokens, completionTokens, extras]
  )

  return (
    <div className='space-y-3 rounded-lg border p-3'>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Enter token counts to preview the estimated cost (excluding group multipliers).'
        )}
      </p>
      <div className='grid grid-cols-2 gap-3'>
        <div className='space-y-1'>
          <Label className='text-xs'>{t('Input tokens')}</Label>
          <DraftNumberInput
            min={0}
            value={promptTokens}
            onValueChange={setPromptTokens}
          />
        </div>
        <div className='space-y-1'>
          <Label className='text-xs'>{t('Output tokens')}</Label>
          <DraftNumberInput
            min={0}
            value={completionTokens}
            onValueChange={setCompletionTokens}
          />
        </div>
      </div>
      {usesExtras && (
        <div className='grid grid-cols-2 gap-3'>
          {BILLING_EXTRA_VARS.map((variable) => {
            // BILLING_EXTRA_VARS only contains pricing variables; they are
            // guaranteed to have a non-null `field` (the `len` condition-only
            // variable is filtered out). Narrow the type here for safety.
            if (!variable.field) return null
            const stateKey = variable.field.replace(
              'Price',
              'Tokens'
            ) as keyof ExtraTokenValues
            return (
              <div key={variable.key} className='space-y-1'>
                <Label className='text-xs'>{t(variable.shortLabel)}</Label>
                <DraftNumberInput
                  min={0}
                  value={extras[stateKey]}
                  onValueChange={(value) =>
                    setExtras((prev) => ({
                      ...prev,
                      [stateKey]: value,
                    }))
                  }
                />
              </div>
            )
          })}
        </div>
      )}
      <div
        className={cn(
          'rounded-md border p-3 text-sm',
          result.error
            ? 'border-destructive/50 bg-destructive/10 text-destructive'
            : 'border-primary/50 bg-primary/10'
        )}
      >
        {result.error ? (
          <span>
            {t('Expression error')}: {result.error}
          </span>
        ) : (
          <div className='flex items-center gap-2'>
            <span className='font-medium'>
              {t('Estimated quota cost')}: {result.cost.toLocaleString()}
            </span>
            {result.matchedTier && (
              <Badge variant='outline' className='text-xs'>
                {t('Hit tier')}: {result.matchedTier}
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LLM prompt helper
// ---------------------------------------------------------------------------

const LLM_PROMPT_TEMPLATE = `You are an AI API billing expression design assistant. The user needs help designing a billing expression for an AI API gateway.

## Expression Language

Expressions are based on standard arithmetic with ternary operators.

### Token Variables

Input side:
- p — input token count (for pricing). Automatically excludes sub-categories priced separately (e.g., if cr is used, cache tokens are deducted from p)
- len — total input context length (for condition checks). Not affected by auto-exclusion; always reflects the full input length. Use in tier conditions
- cr — cache-hit (read) token count
- cc — cache-create token count (5-min TTL)
- cc1h — cache-create token count (1-hour TTL, Claude-specific)
- img — image input token count
- ai — audio input token count

Output side:
- c — output token count. Also auto-excludes sub-categories priced separately
- img_o — image output token count
- ao — audio output token count

### p/c Auto-exclusion

p and c are fallback variables representing all tokens not separately priced in the expression. If the expression uses a sub-category variable (e.g., cr), those tokens are deducted from p to avoid double-billing. Unused sub-category tokens remain in p/c at base price.

Important: len is NOT affected by auto-exclusion. Tier conditions should use len instead of p to prevent cache hits from lowering p and misidentifying the tier.

### Built-in Functions

- tier(name, value) — labels the billing tier; must wrap the cost expression
- max(a, b), min(a, b) — maximum/minimum
- ceil(x), floor(x), abs(x) — ceiling, floor, absolute value
- header(name) — reads a request header
- param(path) — reads a request body JSON path (gjson syntax)
- has(source, substr) — substring check
- hour(tz), minute(tz), weekday(tz), month(tz), day(tz) — time functions, tz is a timezone like "Asia/Shanghai"

### Price Coefficients

Numbers in the expression are $/1M tokens prices. For example, p * 2.5 means input $2.50/1M tokens.

## Expression Examples

Simple pricing:
tier("base", p * 2.5 + c * 15)

With cache:
tier("base", p * 2.5 + c * 15 + cr * 0.25)

Multi-tier (use len for conditions):
len <= 200000
  ? tier("standard", p * 3 + c * 15 + cr * 0.3 + cc * 3.75 + cc1h * 6)
  : tier("long_context", p * 6 + c * 22.5 + cr * 0.6 + cc * 7.5 + cc1h * 12)

Image model:
tier("base", p * 2 + c * 8 + img * 2.5)

Multimodal with audio:
tier("base", p * 0.43 + c * 3.06 + img * 0.78 + ai * 3.81 + ao * 15.11)

Three-tier example:
len <= 128000
  ? tier("standard", p * 1.1 + c * 4.4)
  : (len <= 1000000
    ? tier("medium", p * 2.2 + c * 8.8)
    : tier("long", p * 4.4 + c * 17.6))

## Rules

1. Every leaf branch must be wrapped in tier("name", cost_expr)
2. Use English tier names, e.g. "base", "standard", "long_context"
3. Use len for tier conditions (not p), supports <, <=, >, >=
4. Multi-tier uses nested ternary: cond1 ? tier(...) : (cond2 ? tier(...) : tier(...))
5. Price coefficients are the provider's official $/1M tokens prices
6. If cache/image/audio don't need separate pricing, omit those variables; their tokens are included in p/c automatically

Please generate a billing expression based on the model information and pricing requirements provided.`

type LlmPromptHelperProps = {
  modelName?: string
}

function LlmPromptHelper({ modelName }: LlmPromptHelperProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const prompt = useMemo(() => {
    if (modelName) {
      return LLM_PROMPT_TEMPLATE + `\n\nCurrent model: ${modelName}`
    }
    return LLM_PROMPT_TEMPLATE
  }, [modelName])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success(t('Copied to clipboard'))
    } catch {
      toast.error(t('Failed to copy'))
    }
  }, [prompt, t])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='h-8 w-full justify-start px-2 text-xs font-medium text-muted-foreground hover:text-foreground'
          />
        }
      >
        <Copy className='mr-1.5 h-3.5 w-3.5' />
        {t('LLM prompt helper')}
      </CollapsibleTrigger>
      <CollapsibleContent className='mt-2'>
        <div className='rounded-lg border p-3'>
          <div className='mb-2 flex items-center justify-between'>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Copy this prompt and send it to an LLM (e.g. ChatGPT / Claude) to help design your billing expression.'
              )}
            </p>
            <Button
              variant='outline'
              size='sm'
              className='ml-3 shrink-0'
              onClick={handleCopy}
            >
              <Copy className='mr-1.5 h-3 w-3' />
              {t('Copy prompt')}
            </Button>
          </div>
          <Textarea
            value={prompt}
            readOnly
            rows={8}
            className='font-mono text-xs'
            spellCheck={false}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export type TieredPricingEditorProps = {
  modelName?: string
  billingExpr: string
  requestRuleExpr: string
  onBillingExprChange: (next: string) => void
  onRequestRuleExprChange: (next: string) => void
}

type EditorMode = 'visual' | 'raw'

export const TieredPricingEditor = memo(function TieredPricingEditor({
  modelName,
  billingExpr: currentExpr,
  requestRuleExpr: currentRequestRuleExpr,
  onBillingExprChange,
  onRequestRuleExprChange,
}: TieredPricingEditorProps) {
  const { t } = useTranslation()
  const [editorMode, setEditorMode] = useState<EditorMode>('visual')
  const [visualConfig, setVisualConfig] = useState<VisualConfig | null>(() =>
    tryParseVisualConfig(currentExpr)
  )
  const [rawExpr, setRawExpr] = useState(() =>
    combineBillingExpr(currentExpr || '', currentRequestRuleExpr || '')
  )
  const [requestRuleGroups, setRequestRuleGroups] = useState<
    RequestRuleGroup[]
  >(() => tryParseRequestRuleExpr(currentRequestRuleExpr) || [])
  const [visualBlockReason, setVisualBlockReason] = useState<
    'billing' | 'rules' | null
  >(null)
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    const parsedConfig = tryParseVisualConfig(currentExpr)
    if (parsedConfig) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisualConfig(parsedConfig)
      setEditorMode('visual')
    } else if (currentExpr) {
      setVisualConfig(null)
      setEditorMode('raw')
    } else {
      setVisualConfig(createDefaultVisualConfig())
    }
    setRawExpr(
      combineBillingExpr(currentExpr || '', currentRequestRuleExpr || '')
    )
    setRequestRuleGroups(tryParseRequestRuleExpr(currentRequestRuleExpr) || [])
  }, [currentExpr, currentRequestRuleExpr])

  useEffect(() => {
    initRef.current = false
  }, [modelName])

  const canUseVisualRules = useMemo(() => {
    if (!currentRequestRuleExpr) return true
    return tryParseRequestRuleExpr(currentRequestRuleExpr) !== null
  }, [currentRequestRuleExpr])

  // Display-only preview for the estimator; never pushed to the parent (each
  // mode pushes on its own change handlers below, so switching modes can't
  // overwrite unrepresentable content).
  const previewExpr = useMemo(() => {
    if (editorMode === 'visual') {
      return combineBillingExpr(
        generateExprFromVisualConfig(visualConfig),
        buildRequestRuleExpr(requestRuleGroups)
      )
    }
    return rawExpr
  }, [editorMode, visualConfig, requestRuleGroups, rawExpr])

  const handleVisualChange = useCallback(
    (next: VisualConfig) => {
      setVisualConfig(next)
      onBillingExprChange(generateExprFromVisualConfig(next))
    },
    [onBillingExprChange]
  )

  const handleRawChange = useCallback(
    (value: string) => {
      setRawExpr(value)
      // In raw mode the whole combined string IS the billing value and rules are
      // empty; combineBillingExpr(raw, '') returns raw unchanged, so the stored
      // expression is byte-lossless even when unparseable.
      onBillingExprChange(value)
      onRequestRuleExprChange('')
    },
    [onBillingExprChange, onRequestRuleExprChange]
  )

  const handleModeChange = useCallback(
    (next: EditorMode) => {
      if (next === 'visual') {
        const { billingExpr, requestRuleExpr: ruleStr } =
          splitBillingExprAndRequestRules(rawExpr)
        const parsed = tryParseVisualConfig(billingExpr)
        const parsedGroups = tryParseRequestRuleExpr(ruleStr)
        if (parsed && parsedGroups !== null) {
          setVisualConfig(parsed)
          setRequestRuleGroups(parsedGroups)
          setVisualBlockReason(null)
          setEditorMode('visual')
        } else {
          // Refuse the switch instead of silently resetting content to a default
          // config or an empty rule list.
          setVisualBlockReason(parsed ? 'rules' : 'billing')
        }
      } else {
        const expr = generateExprFromVisualConfig(visualConfig)
        const ruleExpr = buildRequestRuleExpr(requestRuleGroups)
        setRawExpr(combineBillingExpr(expr, ruleExpr) || expr)
        setVisualBlockReason(null)
        setEditorMode('raw')
      }
    },
    [rawExpr, visualConfig, requestRuleGroups]
  )

  const applyPreset = useCallback(
    (preset: Preset) => {
      const presetGroups = preset.requestRules || []
      const ruleExpr = buildRequestRuleExpr(presetGroups)
      const combined = combineBillingExpr(preset.expr, ruleExpr) || preset.expr
      setRawExpr(combined)
      const parsed = tryParseVisualConfig(preset.expr)
      if (parsed) {
        setVisualConfig(parsed)
        setEditorMode('visual')
        setRequestRuleGroups(presetGroups)
        onBillingExprChange(preset.expr)
        onRequestRuleExprChange(ruleExpr)
      } else {
        setEditorMode('raw')
        setVisualConfig(null)
        onBillingExprChange(combined)
        onRequestRuleExprChange('')
      }
    },
    [onBillingExprChange, onRequestRuleExprChange]
  )

  const handleRuleGroupsChange = useCallback(
    (next: RequestRuleGroup[]) => {
      setRequestRuleGroups(next)
      onRequestRuleExprChange(buildRequestRuleExpr(next))
    },
    [onRequestRuleExprChange]
  )

  return (
    <div className='space-y-5'>
      <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end'>
        <Field className='gap-2'>
          <FieldLabel>{t('Editor mode')}</FieldLabel>
          <Select
            items={[
              { value: 'visual', label: t('Visual editor') },
              { value: 'raw', label: t('Expression editor') },
            ]}
            value={editorMode}
            onValueChange={(value) => handleModeChange(value as EditorMode)}
          >
            <SelectTrigger className='w-full sm:w-56' size='sm'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value='visual'>{t('Visual editor')}</SelectItem>
                <SelectItem value='raw'>{t('Expression editor')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {editorMode === 'raw' && (
          <div className='sm:pb-0.5'>
            <LlmPromptHelper modelName={modelName} />
          </div>
        )}
      </div>

      {visualBlockReason && (
        <Alert>
          <AlertDescription className='text-xs'>
            {visualBlockReason === 'billing'
              ? t(
                  'This expression cannot be fully represented in the visual editor (for example it uses max/min/ceil/floor/abs or nested conditions). Stay in expression mode — switching would discard content.'
                )
              : t(
                  'The request rules cannot be fully represented in the visual editor. Stay in expression mode — switching would discard content.'
                )}
          </AlertDescription>
        </Alert>
      )}

      <CollapsibleSection title={t('Preset templates')}>
        <PresetSection applyPreset={applyPreset} />
      </CollapsibleSection>

      <div className='space-y-3 rounded-lg border p-3'>
        {editorMode === 'visual' ? (
          <VisualEditor
            visualConfig={visualConfig}
            onChange={handleVisualChange}
          />
        ) : (
          <RawExprEditor exprString={rawExpr} onChange={handleRawChange} />
        )}

        {editorMode === 'visual' && (
          <CollapsibleSection
            title={t('Request rule pricing')}
            defaultOpen
            className='border-t pt-3'
            contentClassName='space-y-3'
          >
            <p className='text-muted-foreground text-xs'>
              {t(
                'When conditions match, the final price is multiplied by X. Multiple matches multiply together; values < 1 act as discounts.'
              )}
            </p>

            {currentRequestRuleExpr && !canUseVisualRules ? (
              <Alert>
                <AlertDescription className='text-xs'>
                  {t(
                    'This expression is too complex for the visual editor. Please switch to expression mode to edit.'
                  )}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {requestRuleGroups.map((group, groupIndex) => (
                  <RuleGroupCard
                    key={groupIndex}
                    group={group}
                    onChange={(next) => {
                      const updated = [...requestRuleGroups]
                      updated[groupIndex] = next
                      handleRuleGroupsChange(updated)
                    }}
                    onRemove={() =>
                      handleRuleGroupsChange(
                        requestRuleGroups.filter((_, i) => i !== groupIndex)
                      )
                    }
                  />
                ))}
                <Button
                  variant='outline'
                  size='sm'
                  className='h-9 w-36 justify-center'
                  onClick={() =>
                    handleRuleGroupsChange([
                      ...requestRuleGroups,
                      createEmptyRuleGroup(),
                    ])
                  }
                >
                  <Plus className='mr-2 h-4 w-4' />
                  {t('Add rule group')}
                </Button>
              </>
            )}
          </CollapsibleSection>
        )}
      </div>

      <CollapsibleSection title={t('Token estimator')}>
        <CostEstimator effectiveExpr={previewExpr} />
      </CollapsibleSection>
    </div>
  )
})
