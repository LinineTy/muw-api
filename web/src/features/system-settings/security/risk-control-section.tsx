/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { Save } from 'lucide-react'
import { useMemo, useRef } from 'react'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import {
  SettingsForm,
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

  // 每个区块独立保存：diff 只考虑本区块字段，避免点留存保存连带提交信誉分改动。
  const saveFields = async (
    values: RiskControlFormValues,
    prefix: 'credit_score_setting' | 'conversation_retention_setting'
  ) => {
    const normalized = normalizeFormValues(values)
    const prefixKey = `${prefix}.`
    const updates = (
      Object.keys(normalized) as Array<keyof FlatRiskControlDefaults>
    ).filter(
      (key) =>
        key.startsWith(prefixKey) && normalized[key] !== baselineRef.current[key]
    )
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
    <>
      <SettingsSection title={t('Credit Score')}>
        <Form {...form}>
          <SettingsForm
            onSubmit={form.handleSubmit((v) =>
              saveFields(v, 'credit_score_setting')
            )}
          >
            <SettingsPageFormActions
              onSave={form.handleSubmit((v) =>
                saveFields(v, 'credit_score_setting')
              )}
              isSaving={updateOption.isPending}
            />

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
            <FormField
              control={form.control}
              name='credit_score_setting.marker_analysis_base_url'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Marker analysis API base URL')}</FormLabel>
                  <FormControl>
                    <Input
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      placeholder='https://api.openai.com/v1'
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'OpenAI-compatible endpoint. Can point at this site itself (e.g. http://127.0.0.1:3000/v1 with a site token) to reuse your own models.'
                    )}
                  </FormDescription>
                </FormItem>
              )}
            />
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
            <FormField
              control={form.control}
              name='credit_score_setting.marker_analysis_model'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Marker analysis model')}</FormLabel>
                  <FormControl>
                    <Input
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      placeholder='gpt-4o-mini'
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </SettingsForm>
        </Form>
      </SettingsSection>

      <Separator className='my-2' />

      <SettingsSection title={t('Conversation Retention')}>
        <Form {...form}>
          <SettingsForm
            onSubmit={form.handleSubmit((v) =>
              saveFields(v, 'conversation_retention_setting')
            )}
          >
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
            <Button
              type='button'
              size='sm'
              onClick={form.handleSubmit((v) =>
                saveFields(v, 'conversation_retention_setting')
              )}
              disabled={updateOption.isPending}
            >
              <Save data-icon='inline-start' />
              {t('Save Retention Settings')}
            </Button>
          </SettingsForm>
        </Form>
      </SettingsSection>
    </>
  )
}

// Re-exported for section-registry type inference.
export type { FlatRiskControlDefaults }
