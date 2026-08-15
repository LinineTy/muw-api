/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
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
import { Loader2, Search } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { getModels } from '@/features/models/api'
import {
  fetchUpstreamModels,
  getAllGroups,
  getMarkerAnalysisTokenStatus,
  regenerateMarkerAnalysisToken,
} from '@/features/risk-control/api'

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

type FlatRiskControlDefaults = {
  'credit_score_setting.enabled': boolean
  'credit_score_setting.auto_freeze_enabled': boolean
  'credit_score_setting.full_score': number
  'credit_score_setting.freeze_threshold': number
  'credit_score_setting.deduction_upstream_violation': number
  'credit_score_setting.deduction_local_keyword': number
  'credit_score_setting.violation_markers': string
  'credit_score_setting.repeat_multiplier_enabled': boolean
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
                        'Repeated same-type violations within 24h deduct x2 then x3.'
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
                <SelectContent className='min-w-56'>
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
                            <SelectContent className='w-fit min-w-56 max-w-[80vw] max-h-72'>
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
                          <SelectContent className='min-w-52'>
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
