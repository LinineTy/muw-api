/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Loader2, Plus, RotateCcw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { getModels } from '@/features/models/api'
import {
  fetchUpstreamModels,
  getAllGroups,
  getCreditScoreResetStatus,
  getMarkerAnalysisTokenStatus,
  regenerateMarkerAnalysisToken,
  resetCreditScores,
  resetMarkerAnalysisPrompt,
} from '@/features/risk-control/api'

import { ConfirmDialog } from '@/components/confirm-dialog'

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

// react-hook-form 将点号字段名解析为嵌套路径；持久化的 option key 仍是扁平
// credit_score_setting.<field> / conversation_retention_setting.<field>。
const riskControlSchema = z.object({
  credit_score_setting: z.object({
    enabled: z.boolean(),
    auto_freeze_enabled: z.boolean(),
    full_score: z.coerce.number().min(1),
    freeze_threshold: z.coerce.number().min(1),
    deduction_upstream_violation: z.coerce.number().min(0),
    deduction_local_keyword: z.coerce.number().min(0),
    violation_markers: z.string(),
    repeat_multiplier_enabled: z.boolean(),
    // 24h 同类违规重复扣分倍率阶梯：每档"从第几次起 + 倍率"，from 严格递增，
    // 倍率 >= 1（可为小数）。持久化为 JSON 字符串。
    repeat_multiplier_tiers: z
      .array(
        z.object({
          from: z.coerce
            .number()
            .int()
            .min(2, 'Occurrence number must be at least 2'),
          multiplier: z.coerce
            .number()
            .min(1, 'Multiplier must be at least 1'),
        })
      )
      .superRefine((tiers, ctx) => {
        for (let i = 1; i < tiers.length; i++) {
          if (tiers[i].from <= tiers[i - 1].from) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Occurrence numbers must be strictly increasing',
            })
            return
          }
        }
      }),
    max_daily_deduction: z.coerce.number().min(0),
    recover_enabled: z.boolean(),
    recover_per_day: z.coerce.number().min(0),
    pledge_points: z.coerce.number().min(0),
    pledge_cooldown_days: z.coerce.number().min(1),
    marker_analysis_enabled: z.boolean(),
    marker_analysis_base_url: z.string(),
    marker_analysis_api_key: z.string(),
    marker_analysis_model: z.string(),
    marker_analysis_internal_group: z.string(),
    marker_analysis_threshold_enabled: z.boolean(),
    marker_analysis_threshold_count: z.coerce.number().int().min(1),
    marker_analysis_request_interval_ms: z.coerce.number().int().min(0),
    marker_analysis_prompt: z.string(),
  }),
  conversation_retention_setting: z.object({
    enabled: z.boolean(),
    // 表单里用 MB/GB，持久化时乘 1048576/1073741824 转字节（见 normalizeFormValues）。
    request_max_mb: z.coerce.number().min(1),
    response_max_mb: z.coerce.number().min(1),
    max_total_gb: z.coerce.number().min(0),
    ttl_days: z.coerce.number().min(0),
  }),
})

type RiskControlFormInput = z.input<typeof riskControlSchema>
type RiskControlFormValues = z.output<typeof riskControlSchema>

// 倍率阶梯的一档：from 为第几次（>=2，第 1 次恒为 ×1），multiplier 为该次起倍率（>=1 可小数）。
type RepeatMultiplierTier = { from: number; multiplier: number }

// 与后端 operation_setting 默认值一致：第2次×2、第3次起×3封顶（老配置/空档的兜底）。
const DEFAULT_REPEAT_TIERS: RepeatMultiplierTier[] = [
  { from: 2, multiplier: 2 },
  { from: 3, multiplier: 3 },
]

// 解析后端 option 存的 JSON 字符串；空/损坏时回退默认阶梯，不让表单崩坏。
function parseRepeatTiers(raw: string | undefined): RepeatMultiplierTier[] {
  if (!raw) return DEFAULT_REPEAT_TIERS
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (t) =>
          t &&
          typeof t.from === 'number' &&
          typeof t.multiplier === 'number' &&
          Number.isFinite(t.from) &&
          Number.isFinite(t.multiplier) &&
          t.from >= 2 &&
          t.multiplier >= 1
      )
    ) {
      return parsed as RepeatMultiplierTier[]
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_REPEAT_TIERS
}

type FlatRiskControlDefaults = {
  'credit_score_setting.enabled': boolean
  'credit_score_setting.auto_freeze_enabled': boolean
  'credit_score_setting.full_score': number
  'credit_score_setting.freeze_threshold': number
  'credit_score_setting.deduction_upstream_violation': number
  'credit_score_setting.deduction_local_keyword': number
  'credit_score_setting.violation_markers': string
  'credit_score_setting.repeat_multiplier_enabled': boolean
  'credit_score_setting.repeat_multiplier_tiers': string
  'credit_score_setting.max_daily_deduction': number
  'credit_score_setting.recover_enabled': boolean
  'credit_score_setting.recover_per_day': number
  'credit_score_setting.pledge_points': number
  'credit_score_setting.pledge_cooldown_days': number
  'credit_score_setting.marker_analysis_enabled': boolean
  'credit_score_setting.marker_analysis_base_url': string
  'credit_score_setting.marker_analysis_api_key': string
  'credit_score_setting.marker_analysis_model': string
  'credit_score_setting.marker_analysis_internal_group': string
  'credit_score_setting.marker_analysis_threshold_enabled': boolean
  'credit_score_setting.marker_analysis_threshold_count': number
  'credit_score_setting.marker_analysis_request_interval_ms': number
  'credit_score_setting.marker_analysis_prompt': string
  'conversation_retention_setting.enabled': boolean
  'conversation_retention_setting.request_max_bytes': number
  'conversation_retention_setting.response_max_bytes': number
  'conversation_retention_setting.max_total_bytes': number
  'conversation_retention_setting.ttl_days': number
}

type RiskControlSectionProps = { defaultValues: FlatRiskControlDefaults }

const num = (v: number | undefined) => (v == null || Number.isNaN(v) ? 0 : v)

const buildFormDefaults = (
  d: RiskControlSectionProps['defaultValues']
): RiskControlFormInput => ({
  credit_score_setting: {
    enabled: d['credit_score_setting.enabled'],
    auto_freeze_enabled: d['credit_score_setting.auto_freeze_enabled'],
    full_score: num(d['credit_score_setting.full_score']),
    freeze_threshold: num(d['credit_score_setting.freeze_threshold']),
    deduction_upstream_violation: num(
      d['credit_score_setting.deduction_upstream_violation']
    ),
    deduction_local_keyword: num(
      d['credit_score_setting.deduction_local_keyword']
    ),
    violation_markers: d['credit_score_setting.violation_markers'] ?? '',
    repeat_multiplier_enabled:
      d['credit_score_setting.repeat_multiplier_enabled'],
    repeat_multiplier_tiers: parseRepeatTiers(
      d['credit_score_setting.repeat_multiplier_tiers']
    ),
    max_daily_deduction: num(d['credit_score_setting.max_daily_deduction']),
    recover_enabled: d['credit_score_setting.recover_enabled'],
    recover_per_day: num(d['credit_score_setting.recover_per_day']),
    pledge_points: num(d['credit_score_setting.pledge_points']),
    pledge_cooldown_days: num(d['credit_score_setting.pledge_cooldown_days']),
    marker_analysis_enabled: d['credit_score_setting.marker_analysis_enabled'],
    marker_analysis_base_url:
      d['credit_score_setting.marker_analysis_base_url'] ?? '',
    marker_analysis_api_key:
      d['credit_score_setting.marker_analysis_api_key'] ?? '',
    marker_analysis_model:
      d['credit_score_setting.marker_analysis_model'] ?? '',
    marker_analysis_internal_group:
      d['credit_score_setting.marker_analysis_internal_group'] ?? '',
    marker_analysis_threshold_enabled:
      d['credit_score_setting.marker_analysis_threshold_enabled'] ?? false,
    marker_analysis_threshold_count: num(
      d['credit_score_setting.marker_analysis_threshold_count']
    ) || 150,
    marker_analysis_request_interval_ms: num(
      d['credit_score_setting.marker_analysis_request_interval_ms']
    ),
    marker_analysis_prompt:
      d['credit_score_setting.marker_analysis_prompt'] ?? '',
  },
  conversation_retention_setting: {
    enabled: d['conversation_retention_setting.enabled'],
    request_max_mb: num(d['conversation_retention_setting.request_max_bytes']) / 1048576,
    response_max_mb: num(d['conversation_retention_setting.response_max_bytes']) / 1048576,
    max_total_gb: num(d['conversation_retention_setting.max_total_bytes']) / 1073741824,
    ttl_days: num(d['conversation_retention_setting.ttl_days']),
  },
})

const normalizeDefaults = (
  d: RiskControlSectionProps['defaultValues']
): FlatRiskControlDefaults => d

const normalizeFormValues = (
  v: RiskControlFormValues
): FlatRiskControlDefaults => ({
  'credit_score_setting.enabled': v.credit_score_setting.enabled,
  'credit_score_setting.auto_freeze_enabled':
    v.credit_score_setting.auto_freeze_enabled,
  'credit_score_setting.full_score': num(v.credit_score_setting.full_score),
  'credit_score_setting.freeze_threshold': num(
    v.credit_score_setting.freeze_threshold
  ),
  'credit_score_setting.deduction_upstream_violation': num(
    v.credit_score_setting.deduction_upstream_violation
  ),
  'credit_score_setting.deduction_local_keyword': num(
    v.credit_score_setting.deduction_local_keyword
  ),
  'credit_score_setting.violation_markers':
    v.credit_score_setting.violation_markers,
  'credit_score_setting.repeat_multiplier_enabled':
    v.credit_score_setting.repeat_multiplier_enabled,
  'credit_score_setting.repeat_multiplier_tiers': JSON.stringify(
    v.credit_score_setting.repeat_multiplier_tiers
  ),
  'credit_score_setting.max_daily_deduction': num(
    v.credit_score_setting.max_daily_deduction
  ),
  'credit_score_setting.recover_enabled':
    v.credit_score_setting.recover_enabled,
  'credit_score_setting.recover_per_day': num(
    v.credit_score_setting.recover_per_day
  ),
  'credit_score_setting.pledge_points': num(
    v.credit_score_setting.pledge_points
  ),
  'credit_score_setting.pledge_cooldown_days': num(
    v.credit_score_setting.pledge_cooldown_days
  ),
  'credit_score_setting.marker_analysis_enabled':
    v.credit_score_setting.marker_analysis_enabled,
  'credit_score_setting.marker_analysis_base_url':
    v.credit_score_setting.marker_analysis_base_url,
  'credit_score_setting.marker_analysis_api_key':
    v.credit_score_setting.marker_analysis_api_key,
  'credit_score_setting.marker_analysis_model':
    v.credit_score_setting.marker_analysis_model,
  'credit_score_setting.marker_analysis_internal_group':
    v.credit_score_setting.marker_analysis_internal_group,
  'credit_score_setting.marker_analysis_threshold_enabled':
    v.credit_score_setting.marker_analysis_threshold_enabled,
  'credit_score_setting.marker_analysis_threshold_count': num(
    v.credit_score_setting.marker_analysis_threshold_count
  ),
  'credit_score_setting.marker_analysis_request_interval_ms': num(
    v.credit_score_setting.marker_analysis_request_interval_ms
  ),
  'credit_score_setting.marker_analysis_prompt':
    v.credit_score_setting.marker_analysis_prompt,
  'conversation_retention_setting.enabled':
    v.conversation_retention_setting.enabled,
  'conversation_retention_setting.request_max_bytes': Math.round(
    num(v.conversation_retention_setting.request_max_mb) * 1048576
  ),
  'conversation_retention_setting.response_max_bytes': Math.round(
    num(v.conversation_retention_setting.response_max_mb) * 1048576
  ),
  'conversation_retention_setting.max_total_bytes': Math.round(
    num(v.conversation_retention_setting.max_total_gb) * 1073741824
  ),
  'conversation_retention_setting.ttl_days': num(
    v.conversation_retention_setting.ttl_days
  ),
})

export function RiskControlSection({ defaultValues }: RiskControlSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const baselineRef = useRef<FlatRiskControlDefaults>(
    normalizeDefaults(defaultValues)
  )
  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<RiskControlFormInput, unknown, RiskControlFormValues>({
    resolver: zodResolver(riskControlSchema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  // 24h 重复违规倍率阶梯编辑器（credit_score_setting 嵌套对象下的数组字段）。
  const repeatTiersField = useFieldArray({
    control: form.control,
    name: 'credit_score_setting.repeat_multiplier_tiers',
  })
  const repeatTiersError =
    form.formState.errors.credit_score_setting?.repeat_multiplier_tiers?.message

  // 接入方式预设：本站套娃（自动内部 base_url + 分组/模型联动 + 内部 token）vs 自定义端点。
  // 初始按已配置 base_url 判断：空/回环地址视为套娃预设，其它视为自定义。
  const [mode, setMode] = useState<'site' | 'custom'>(() => {
    const b = defaultValues['credit_score_setting.marker_analysis_base_url'] ?? ''
    return b === '' || b.includes('127.0.0.1') || b.includes('localhost')
      ? 'site'
      : 'custom'
  })

  // 套娃内部 token：状态（已配置尾号/分组 + 内部 base_url 自动推断）、全量分组、本站模型。
  const { data: tokenStatus, refetch: refetchTokenStatus } = useQuery({
    queryKey: ['marker-analysis-token-status'],
    queryFn: getMarkerAnalysisTokenStatus,
  })
  const internalBaseUrl = tokenStatus?.internal_base_url ?? ''
  const { data: groups = [] } = useQuery({
    queryKey: ['groups'],
    queryFn: getAllGroups,
  })
  const { data: modelsData } = useQuery({
    queryKey: ['models', 'all'],
    queryFn: () => getModels({ page_size: 1000, status: '1' }),
  })
  const allModels = useMemo(
    () => modelsData?.data?.items ?? [],
    [modelsData]
  )
  // 分组 → 模型联动：选分组后模型下拉只显示该分组下可用的模型（enable_groups）。
  const selectedGroup = form.watch(
    'credit_score_setting.marker_analysis_internal_group'
  )
  // 自动触发方式：定量开关决定是否显示阈值参数字段。
  const thresholdEnabled = form.watch(
    'credit_score_setting.marker_analysis_threshold_enabled'
  )
  // 已配置内部 token 的实际分组 ≠ 当前所选分组 → 红字提醒重新生成（token 路由仍走旧分组）。
  const groupChanged =
    !!tokenStatus?.configured &&
    !!selectedGroup &&
    !!tokenStatus.token_group &&
    tokenStatus.token_group !== selectedGroup
  // 分析模型被改动（相对上次保存值）→ 红字提醒确认分组可用 / 必要时重新生成。
  const modelChanged =
    form.watch('credit_score_setting.marker_analysis_model') !==
    baselineRef.current['credit_score_setting.marker_analysis_model']
  const availableModelNames = useMemo(() => {
    // auto 分组无固定渠道绑定（按用户所在组自动路由），此时不按分组过滤。
    if (!selectedGroup || selectedGroup === 'auto') {
      return allModels.map((m) => m.model_name)
    }
    return allModels
      .filter(
        (m) => !m.enable_groups?.length || m.enable_groups.includes(selectedGroup)
      )
      .map((m) => m.model_name)
  }, [allModels, selectedGroup])

  const generateMutation = useMutation({
    mutationFn: (group: string) => regenerateMarkerAnalysisToken(group),
    onSuccess: () => {
      toast.success(t('Internal token generated'))
      refetchTokenStatus()
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to generate internal token'))
    },
  })
  const handleGenerateToken = () => {
    const group = form.getValues(
      'credit_score_setting.marker_analysis_internal_group'
    )
    if (!group) {
      toast.error(t('Select an analysis group first'))
      return
    }
    generateMutation.mutate(group)
  }

  // 自动获取分析模型（site 模式）：从当前分组下可用模型挑，custom 模式从本站全部模型挑。
  const handleAutoPickModel = () => {
    const names =
      mode === 'site'
        ? availableModelNames
        : allModels.map((m) => m.model_name)
    if (names.length === 0) {
      toast.error(t('No model available for the selected group'))
      return
    }
    const picked = names[0]
    form.setValue('credit_score_setting.marker_analysis_model', picked)
    toast.success(`${t('Auto picked model')}: ${picked}`)
  }

  // 上游模型（custom 模式）：点放大镜拉取 base_url 的 /v1/models，弹层里搜索选择。
  const [upstreamModelsOpen, setUpstreamModelsOpen] = useState(false)
  const [upstreamModelList, setUpstreamModelList] = useState<string[]>([])
  const [upstreamSearch, setUpstreamSearch] = useState('')
  const fetchUpstreamMutation = useMutation({
    mutationFn: (payload: { base_url: string; api_key: string }) =>
      fetchUpstreamModels(payload),
    onSuccess: (r) => {
      setUpstreamModelList(r.models)
      setUpstreamModelsOpen(true)
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to fetch upstream models'))
    },
  })
  const handleOpenUpstreamModels = () => {
    const baseUrl =
      form.getValues('credit_score_setting.marker_analysis_base_url') ?? ''
    const apiKey =
      form.getValues('credit_score_setting.marker_analysis_api_key') ?? ''
    if (!baseUrl.trim()) {
      toast.error(t('Fill the base URL first'))
      return
    }
    fetchUpstreamMutation.mutate({ base_url: baseUrl, api_key: apiKey })
  }
  const filteredUpstreamModels = upstreamModelList.filter((m) =>
    m.toLowerCase().includes(upstreamSearch.trim().toLowerCase())
  )

  // 一个保存按钮保存全部区块，但 diff 只提交变更字段：未改动的区块不会连带写入。
  // site 预设保存时：base_url 用自动推断的内部地址，api key 置空（内部 token 已足够鉴权）。
  const saveAll = async (values: RiskControlFormValues) => {
    const normalized = normalizeFormValues(values)
    if (mode === 'site') {
      if (internalBaseUrl) {
        normalized['credit_score_setting.marker_analysis_base_url'] =
          internalBaseUrl
      }
      normalized['credit_score_setting.marker_analysis_api_key'] = ''
    }
    const updates = (
      Object.keys(normalized) as Array<keyof FlatRiskControlDefaults>
    ).filter((key) => normalized[key] !== baselineRef.current[key])
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const key of updates) {
      await updateOption.mutateAsync({ key, value: String(normalized[key]) })
    }
    baselineRef.current = normalized
  }

  // 恢复默认提示词：调后端重置为内置默认（与违规标记词"重置"语义对称，立即持久化），
  // 把返回的默认提示词回填表单并同步 baseline，避免之后保存时把相同值再写一遍。
  const [promptResetOpen, setPromptResetOpen] = useState(false)
  const resetPromptMutation = useMutation({
    mutationFn: resetMarkerAnalysisPrompt,
    onSuccess: (r) => {
      form.setValue(
        'credit_score_setting.marker_analysis_prompt',
        r.prompt ?? ''
      )
      baselineRef.current['credit_score_setting.marker_analysis_prompt'] =
        r.prompt ?? ''
      toast.success(t('Prompt restored to default'))
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Save failed'))
    },
  })

  // 全站信誉分重置：把所用用户 credit_score 归一到已保存的满分，并清保证书冷却。
  // 走后台系统任务（带进度），逐用户落审计明细（source=full_score_reset）。
  const queryClient = useQueryClient()
  const { data: resetStatus } = useQuery({
    queryKey: ['credit-score-reset-status'],
    queryFn: getCreditScoreResetStatus,
    // 重置在跑时每 2s 轮询进度；结束后自动停。
    refetchInterval: (query) => {
      const s = query.state.data
      return s?.running ? 2000 : false
    },
  })
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  // 重置按「已保存」的满分执行：表单里改了满分但没保存时禁用按钮并提示先保存。
  const savedFullScore = num(
    baselineRef.current['credit_score_setting.full_score']
  )
  const fullScoreUnsaved =
    Number(form.watch('credit_score_setting.full_score')) !== savedFullScore
  const resetRunning = resetStatus?.running ?? false
  const resetMutation = useMutation({
    mutationFn: resetCreditScores,
    onSuccess: () => {
      toast.success(t('Credit score reset started'))
      void queryClient.invalidateQueries({
        queryKey: ['credit-score-reset-status'],
      })
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Reset failed'))
    },
  })

  return (
    <Form {...form}>
      <SettingsForm onSubmit={form.handleSubmit(saveAll)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(saveAll)}
            isSaving={updateOption.isPending}
          />
          <SettingsSection title={t('Credit Score')}>
            <SettingsFormGrid>
            <FormField
              control={form.control}
              name='credit_score_setting.enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable credit score system')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Deduct points on upstream content-safety violations and local sensitive-word hits; freeze API calls when the score drops below the threshold.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.auto_freeze_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Auto-freeze below threshold')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Freeze /v1 API calls when the score is below the threshold. The account itself is not disabled; the user can still log in.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.full_score'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Full score')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <div
              data-settings-form-span='full'
              className='min-w-0 space-y-2 rounded-md border p-3'
            >
              <div className='flex flex-wrap items-start justify-between gap-2'>
                <div className='min-w-0 space-y-1'>
                  <div className='text-sm font-medium'>
                    {t('Reset all users to full score')}
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Set every user credit score to the saved full score ({{full_score}}) and clear all credit score logs (deduction, recovery and pledge history). The whole credit score system starts over.',
                      { full_score: savedFullScore }
                    )}
                  </p>
                  {fullScoreUnsaved && (
                    <p className='text-destructive text-xs font-medium'>
                      {t(
                        'The full score has unsaved changes; save it first so the reset applies to the new value.'
                      )}
                    </p>
                  )}
                </div>
                <Button
                  type='button'
                  variant='destructive'
                  size='sm'
                  disabled={
                    resetRunning || resetMutation.isPending || fullScoreUnsaved
                  }
                  onClick={() => setResetConfirmOpen(true)}
                >
                  {resetRunning || resetMutation.isPending ? (
                    <Loader2
                      className='size-4 animate-spin'
                      aria-hidden='true'
                    />
                  ) : (
                    <RotateCcw className='size-4' aria-hidden='true' />
                  )}
                  {t('Reset to full score')}
                </Button>
              </div>
              {resetRunning && (
                <div className='space-y-1.5'>
                  <div className='flex items-center justify-between text-xs'>
                    <span className='text-muted-foreground'>
                      {t('Resetting credit scores…')}
                    </span>
                    <span className='tabular-nums'>
                      {resetStatus?.state?.progress ?? 0}%
                    </span>
                  </div>
                  <Progress value={resetStatus?.state?.progress ?? 0} />
                  <p className='text-muted-foreground text-xs'>
                    {t('Processed {{processed}} / {{total}} users.', {
                      processed: resetStatus?.state?.processed ?? 0,
                      total: resetStatus?.state?.total ?? 0,
                    })}
                  </p>
                </div>
              )}
              {resetStatus?.last && !resetRunning && (
                <div
                  className={`rounded-md border p-2 text-xs ${
                    resetStatus.last.error
                      ? 'border-destructive/40'
                      : 'bg-muted/40'
                  }`}
                >
                  {resetStatus.last.error ? (
                    <p className='text-destructive break-all'>
                      {t('Last reset failed: {{error}}', {
                        error: resetStatus.last.error,
                      })}
                    </p>
                  ) : (
                    <p className='text-muted-foreground'>
                      {t(
                        'Last reset: {{reset}} users updated, {{skipped}} unchanged, {{cleared}} credit score logs cleared.',
                        {
                          reset: resetStatus.last.reset,
                          skipped: resetStatus.last.skipped,
                          cleared: resetStatus.last.cleared_logs,
                        }
                      )}
                    </p>
                  )}
                </div>
              )}
              <ConfirmDialog
                open={resetConfirmOpen}
                onOpenChange={setResetConfirmOpen}
                title={t('Reset all users to full score?')}
                desc={t(
                  'This resets every user credit score to {{full_score}} and permanently deletes all credit score logs — deduction, recovery and pledge history (pledge read counts reset to zero). Each changed user keeps a fresh reset record. This cannot be undone.',
                  { full_score: savedFullScore }
                )}
                destructive
                confirmText={t('Reset to full score')}
                isLoading={resetMutation.isPending}
                handleConfirm={() => {
                  setResetConfirmOpen(false)
                  resetMutation.mutate()
                }}
              />
            </div>
            <FormField
              control={form.control}
              name='credit_score_setting.freeze_threshold'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Freeze threshold')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.deduction_upstream_violation'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Deduction per upstream violation')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.deduction_local_keyword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Deduction per sensitive-word hit')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.violation_markers'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Upstream violation markers')}</FormLabel>
                  <FormControl>
                    <Textarea
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      rows={5}
                      placeholder='is sensitive&#10;please check your input'
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Substrings (one per line, case-insensitive) matched against upstream error messages to detect content-safety violations. Suggestions from the AI marker analysis can be added here.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.repeat_multiplier_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Repeat violation escalation')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Repeated same-type violations within 24h apply the configured multiplier tiers below.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <div
              data-settings-form-span='full'
              className='min-w-0 space-y-2 rounded-md border p-3'
            >
              <div className='text-sm font-medium'>
                {t('Repeat multiplier tiers')}
              </div>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Multiplier applied from the Nth same-type violation within 24h. The first violation is always x1; once the last tier is reached it applies to all later violations.'
                )}
              </p>
              <div className='space-y-2'>
                {repeatTiersField.fields.map((tier, index) => {
                  const tierErrors =
                    form.formState.errors.credit_score_setting
                      ?.repeat_multiplier_tiers?.[index]
                  const rowFromError =
                    tierErrors?.from?.message ??
                    tierErrors?.multiplier?.message
                  return (
                    <div key={tier.id} className='space-y-1'>
                      <div className='flex items-center gap-2'>
                        <span className='text-muted-foreground shrink-0 text-xs whitespace-nowrap'>
                          {t('From occurrence')}
                        </span>
                        <Input
                          type='number'
                          min={2}
                          step={1}
                          value={tier.from as number}
                          onChange={(e) =>
                            repeatTiersField.update(index, {
                              ...tier,
                              from: Number(e.target.value),
                            })
                          }
                          className='w-20'
                        />
                        <span className='text-muted-foreground shrink-0'>
                          ×
                        </span>
                        <Input
                          type='number'
                          min={1}
                          step={0.5}
                          value={tier.multiplier as number}
                          onChange={(e) =>
                            repeatTiersField.update(index, {
                              ...tier,
                              multiplier: Number(e.target.value),
                            })
                          }
                          className='w-24'
                        />
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          aria-label={t('Remove tier')}
                          onClick={() => repeatTiersField.remove(index)}
                        >
                          <X className='size-4' />
                        </Button>
                      </div>
                      {rowFromError && (
                        <p className='text-destructive pl-1 text-xs'>
                          {t(rowFromError)}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() =>
                  repeatTiersField.append({ from: 2, multiplier: 2 })
                }
              >
                <Plus className='size-4' />
                {t('Add tier')}
              </Button>
              {repeatTiersError && (
                <p className='text-destructive text-xs'>
                  {t(repeatTiersError)}
                </p>
              )}
            </div>
            <FormField
              control={form.control}
              name='credit_score_setting.max_daily_deduction'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max daily deduction')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Rolling 24h cap on total deduction to protect against upstream flakiness.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.recover_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable passive recovery')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Recover a few points per day for users with no violation in the last 24h.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.recover_per_day'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Points recovered per day')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.pledge_points'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Points per pledge')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Points granted after the user completes the content-safety pledge. Set 0 to disable the pledge.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.pledge_cooldown_days'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Pledge cooldown (days)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.marker_analysis_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable AI marker analysis')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Periodically analyze recent error logs with a configured model to suggest new violation markers. Suggestions are reviewed manually in the Risk Control page.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.marker_analysis_threshold_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Threshold-based analysis')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Run automatically when unanalyzed error logs accumulate to the threshold set below. Unanalyzed counts since the last analysis (no time window).'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            {thresholdEnabled && (
              <FormField
                control={form.control}
                name='credit_score_setting.marker_analysis_threshold_count'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Trigger threshold (unanalyzed errors)')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={1}
                        value={field.value as number}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Run analysis once unanalyzed error logs reach this count. All accumulated errors are fed to the model in batches, so no upper cap is needed.'
                      )}
                    </FormDescription>
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name='credit_score_setting.marker_analysis_prompt'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between gap-2'>
                    <FormLabel>{t('Marker analysis prompt')}</FormLabel>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-6 px-2 text-xs'
                      disabled={resetPromptMutation.isPending}
                      onClick={() => setPromptResetOpen(true)}
                    >
                      {resetPromptMutation.isPending ? (
                        <Loader2
                          className='size-3 animate-spin'
                          aria-hidden='true'
                        />
                      ) : (
                        <RotateCcw className='size-3' aria-hidden='true' />
                      )}
                      {t('Restore default')}
                    </Button>
                  </div>
                  <FormControl>
                    <Textarea
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      rows={8}
                      className='font-mono text-xs'
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'System prompt sent to the analysis model. The {messages} placeholder is replaced with the batch of error messages; if your prompt does not contain it, the messages are appended as the user message. Leave empty to use the built-in default. Save then re-run analysis to apply.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            <ConfirmDialog
              open={promptResetOpen}
              onOpenChange={setPromptResetOpen}
              title={t('Restore default analysis prompt?')}
              desc={t(
                'This replaces the current prompt with the built-in default. Changes apply immediately.'
              )}
              destructive
              confirmText={t('Restore default')}
              isLoading={resetPromptMutation.isPending}
              handleConfirm={() => {
                setPromptResetOpen(false)
                resetPromptMutation.mutate()
              }}
            />
            <div
              data-settings-form-span='full'
              className='min-w-0 space-y-2'
            >
              <div className='text-sm font-medium'>
                {t('Analysis connection')}
              </div>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as 'site' | 'custom')}
              >
                <SelectTrigger>
                  <SelectValue>
                    {() =>
                      mode === 'site'
                        ? t('Use this site (local models, free)')
                        : t('Custom OpenAI-compatible endpoint')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  className='w-fit min-w-56 max-w-[80vw]'
                  alignItemWithTrigger={false}
                >
                  <SelectItem value='site'>
                    {t('Use this site (local models, free)')}
                  </SelectItem>
                  <SelectItem value='custom'>
                    {t('Custom OpenAI-compatible endpoint')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Site mode reuses your own configured models with the internal token and costs nothing; custom mode points to an external OpenAI-compatible API.'
                )}
              </p>
            </div>
            <FormField
              control={form.control}
              name='credit_score_setting.marker_analysis_request_interval_ms'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Request interval between analysis calls (ms)')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Minimum delay between analysis requests when scanning a large backlog, to avoid upstream rate limiting (429). 0 = no delay. Rate-limited responses are auto-retried with backoff regardless.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='credit_score_setting.marker_analysis_base_url'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Marker analysis API base URL')}</FormLabel>
                  <FormControl>
                    <Input
                      value={
                        mode === 'site'
                          ? internalBaseUrl || field.value || ''
                          : field.value ?? ''
                      }
                      onChange={field.onChange}
                      disabled={mode === 'site'}
                      placeholder='https://api.openai.com/v1'
                    />
                  </FormControl>
                  <FormDescription>
                    {mode === 'site'
                      ? t(
                          'Auto-filled with the loopback address of this site (runtime port inferred). Save to apply.'
                        )
                      : t(
                          'OpenAI-compatible endpoint. Can point at this site itself (e.g. http://127.0.0.1:3000/v1 with a site token) to reuse your own models.'
                        )}
                  </FormDescription>
                </FormItem>
              )}
            />
            {mode === 'custom' && (
              <FormField
                control={form.control}
                name='credit_score_setting.marker_analysis_api_key'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Marker analysis API key')}</FormLabel>
                    <FormControl>
                      <Input
                        type='password'
                        value={field.value ?? ''}
                        onChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}
            {mode === 'site' ? (
              <FormField
                control={form.control}
                name='credit_score_setting.marker_analysis_model'
                render={({ field }) => {
                  const current = field.value ?? ''
                  const currentMissing =
                    current !== '' && !availableModelNames.includes(current)
                  return (
                    <FormItem>
                      <FormLabel>{t('Marker analysis model')}</FormLabel>
                      <div className='flex items-center gap-2'>
                        <div className='min-w-0 flex-1'>
                          <Select value={current} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={t('Select a model')} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent
                              className='w-fit min-w-56 max-w-[80vw] max-h-72'
                              alignItemWithTrigger={false}
                            >
                              {currentMissing && (
                                <SelectItem value={current}>{current}</SelectItem>
                              )}
                              {availableModelNames.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={handleAutoPickModel}
                        >
                          {t('Auto pick a model')}
                        </Button>
                      </div>
                      {selectedGroup && currentMissing && (
                        <FormDescription className='text-amber-600'>
                          {t(
                            'This model is not available under the selected group; pick one from the list or regenerate the token with a matching group.'
                          )}
                        </FormDescription>
                      )}
                      {modelChanged && (
                        <FormDescription className='text-destructive font-medium'>
                          {t(
                            'The analysis model changed; confirm it is available in the selected group and regenerate the internal token if needed.'
                          )}
                        </FormDescription>
                      )}
                      <FormDescription>
                        {t(
                          'Models listed are filtered by the selected analysis group.'
                        )}
                      </FormDescription>
                    </FormItem>
                  )
                }}
              />
            ) : (
              <FormField
                control={form.control}
                name='credit_score_setting.marker_analysis_model'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Marker analysis model')}</FormLabel>
                    <FormControl>
                      <div className='flex items-center gap-2'>
                        <div className='min-w-0 flex-1'>
                          <Input
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            placeholder='gpt-4o-mini'
                          />
                        </div>
                        <Popover
                          open={upstreamModelsOpen}
                          onOpenChange={setUpstreamModelsOpen}
                        >
                          <PopoverTrigger
                            render={
                              <Button
                                type='button'
                                variant='outline'
                                size='sm'
                                aria-label={t('Fetch models from upstream')}
                                disabled={fetchUpstreamMutation.isPending}
                                onClick={handleOpenUpstreamModels}
                              >
                                {fetchUpstreamMutation.isPending ? (
                                  <Loader2 className='size-4 animate-spin' />
                                ) : (
                                  <Search className='size-4' />
                                )}
                              </Button>
                            }
                          />
                          <PopoverContent className='w-72 p-2' align='end'>
                            <Input
                              value={upstreamSearch}
                              onChange={(e) =>
                                setUpstreamSearch(e.target.value)
                              }
                              placeholder={t('Search models...')}
                              className='mb-2'
                            />
                            {upstreamModelList.length === 0 ? (
                              <p className='text-muted-foreground px-1 py-3 text-center text-sm'>
                                {t('No models returned by the upstream endpoint')}
                              </p>
                            ) : (
                              <div className='max-h-60 space-y-0.5 overflow-y-auto'>
                                {filteredUpstreamModels.map((model) => (
                                  <button
                                    key={model}
                                    type='button'
                                    className='hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm select-none'
                                    onClick={() => {
                                      field.onChange(model)
                                      setUpstreamModelsOpen(false)
                                      setUpstreamSearch('')
                                    }}
                                  >
                                    <span className='truncate'>{model}</span>
                                  </button>
                                ))}
                                {filteredUpstreamModels.length === 0 && (
                                  <p className='text-muted-foreground px-1 py-3 text-center text-sm'>
                                    {t('No option found.')}
                                  </p>
                                )}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Click the magnifier to fetch models from the base URL above, then pick one; you can also type a custom name.'
                      )}
                    </FormDescription>
                  </FormItem>
                )}
              />
            )}
            {mode === 'site' && (
              <>
                <FormField
                  control={form.control}
                  name='credit_score_setting.marker_analysis_internal_group'
                  render={({ field }) => {
                    const current = field.value ?? ''
                    return (
                      <FormItem>
                        <FormLabel>{t('Marker analysis group')}</FormLabel>
                        <Select value={current} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('Select a group')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent
                            className='min-w-52'
                            alignItemWithTrigger={false}
                          >
                            {groups
                              .filter((group) => group !== 'auto')
                              .map((group) => (
                                <SelectItem key={group} value={group}>
                                  {group}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          {t(
                            'Analysis requests are routed under this group using the internal token.'
                          )}
                        </FormDescription>
                        {groupChanged && (
                          <FormDescription className='text-destructive font-medium'>
                            {t(
                              'The analysis group changed; regenerate the internal token so requests route under the new group.'
                            )}
                          </FormDescription>
                        )}
                      </FormItem>
                    )
                  }}
                />
                <div className='min-w-0 space-y-2'>
                  <div className='text-sm font-medium'>
                    {t('Internal analysis token')}
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-mono text-sm'>
                      {tokenStatus?.configured
                        ? tokenStatus.masked_key
                        : t('Token not configured')}
                    </span>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={generateMutation.isPending}
                      onClick={handleGenerateToken}
                    >
                      {tokenStatus?.configured
                        ? t('Regenerate internal token')
                        : t('Generate internal token')}
                    </Button>
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'When the analysis base URL points at this site itself (nested), the analysis request authenticates with this token. It is bound to the root user, only reachable from local loopback (127.0.0.1/::1), never expires and has unlimited quota; your own relay recognizes it and skips sensitive-word checks, conversation retention and credit deductions. Regenerating immediately disables the previous token. Changing the analysis group requires regenerating the token.'
                    )}
                  </p>
                </div>
              </>
            )}
            </SettingsFormGrid>
          </SettingsSection>

          <Separator className='my-2' />

          <SettingsSection title={t('Conversation Retention')}>
            <SettingsFormGrid>
            <FormField
              control={form.control}
              name='conversation_retention_setting.enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>
                      {t('Record conversation requests & responses')}
                    </FormLabel>
                    <FormDescription>
                      {t(
                        'Store chat request and response content (images omitted) for admin review. Used as the evidence chain for credit deductions.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <FormField
              control={form.control}
              name='conversation_retention_setting.request_max_mb'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max request size (MB)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Stored as bytes internally; entered MB are multiplied by 1048576. 0 uses the default 2 MB.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='conversation_retention_setting.response_max_mb'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max response size (MB)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Stored as bytes internally; entered MB are multiplied by 1048576. 0 uses the default 2 MB.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='conversation_retention_setting.max_total_gb'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max total storage (GB)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Total cap for stored conversations; when exceeded, the cleanup task deletes the oldest records. 0 = unlimited.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='conversation_retention_setting.ttl_days'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Retention (days)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value as number}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Records older than this are deleted by the scheduled cleanup task.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
            </SettingsFormGrid>
          </SettingsSection>
        </SettingsForm>
    </Form>
  )
}

// Re-exported for section-registry type inference.
export type { FlatRiskControlDefaults }
