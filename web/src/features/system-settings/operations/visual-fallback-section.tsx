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
import { zodResolver } from '@hookform/resolvers/zod'
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
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { MultiSelect } from '@/components/multi-select'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useSystemModels } from '../hooks/use-system-options'
import { useUpdateOption } from '../hooks/use-update-option'

// react-hook-form resolves dotted field names as nested paths, so the form
// schema and defaults must be nested while the persisted option keys stay flat
// (visual_fallback_setting.<field>).
const visualFallbackSchema = z.object({
  visual_fallback_setting: z.object({
    enabled: z.boolean(),
    model: z.string(),
    prompt: z.string(),
    supported_models: z.string(),
  }),
})

type VisualFallbackFormInput = z.input<typeof visualFallbackSchema>
type VisualFallbackFormValues = z.output<typeof visualFallbackSchema>

type FlatVisualFallbackDefaults = {
  'visual_fallback_setting.enabled': boolean
  'visual_fallback_setting.model': string
  'visual_fallback_setting.prompt': string
  'visual_fallback_setting.supported_models': string
}

type VisualFallbackSectionProps = {
  defaultValues: FlatVisualFallbackDefaults
}

const buildFormDefaults = (
  defaults: VisualFallbackSectionProps['defaultValues']
): VisualFallbackFormInput => ({
  visual_fallback_setting: {
    enabled: defaults['visual_fallback_setting.enabled'],
    model: defaults['visual_fallback_setting.model'] ?? '',
    prompt: defaults['visual_fallback_setting.prompt'] ?? '',
    supported_models: defaults['visual_fallback_setting.supported_models'] ?? '',
  },
})

const normalizeDefaults = (
  defaults: VisualFallbackSectionProps['defaultValues']
): FlatVisualFallbackDefaults => ({
  'visual_fallback_setting.enabled':
    defaults['visual_fallback_setting.enabled'],
  'visual_fallback_setting.model': defaults['visual_fallback_setting.model'] ?? '',
  'visual_fallback_setting.prompt':
    defaults['visual_fallback_setting.prompt'] ?? '',
  'visual_fallback_setting.supported_models':
    defaults['visual_fallback_setting.supported_models'] ?? '',
})

const normalizeFormValues = (
  values: VisualFallbackFormValues
): FlatVisualFallbackDefaults => ({
  'visual_fallback_setting.enabled': values.visual_fallback_setting.enabled,
  'visual_fallback_setting.model': values.visual_fallback_setting.model,
  'visual_fallback_setting.prompt': values.visual_fallback_setting.prompt,
  'visual_fallback_setting.supported_models':
    values.visual_fallback_setting.supported_models,
})

export function VisualFallbackSection({
  defaultValues,
}: VisualFallbackSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const { data: models = [] } = useSystemModels()

  // 下拉选中保存的是纯净 model_name；禁用模型只在列表项里做记号
  // （ComboboxInput 用 icon，MultiSelect 用 label 后缀）。
  const fallbackModelOptions = models.map((m) => ({
    value: m.model_name,
    label: m.model_name,
    icon:
      m.status !== 1 ? (
        <span className='text-destructive text-[10px]'>
          {t('Disabled')}
        </span>
      ) : undefined,
  }))
  const visionModelOptions = models.map((m) => ({
    value: m.model_name,
    label:
      m.status !== 1 ? `${m.model_name} (${t('Disabled')})` : m.model_name,
  }))

  const baselineRef = useRef<FlatVisualFallbackDefaults>(
    normalizeDefaults(defaultValues)
  )
  const baselineSerializedRef = useRef<string>(
    JSON.stringify(normalizeDefaults(defaultValues))
  )

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<VisualFallbackFormInput, unknown, VisualFallbackFormValues>(
    {
      resolver: zodResolver(visualFallbackSchema),
      defaultValues: formDefaults,
    }
  )

  useResetForm(form, formDefaults)

  const onSubmit = async (values: VisualFallbackFormValues) => {
    const normalized = normalizeFormValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof FlatVisualFallbackDefaults>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({
        key,
        value: normalized[key],
      })
    }

    baselineRef.current = normalized
    baselineSerializedRef.current = JSON.stringify(normalized)
  }

  return (
    <SettingsSection title={t('Vision Fallback')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='visual_fallback_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>
                    {t('Enable vision fallback for non-vision models')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'When a request contains images but the target model does not support vision, each image is described by the vision fallback model and the description is sent to the target model instead.'
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
            name='visual_fallback_setting.model'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Vision fallback model')}</FormLabel>
                <FormControl>
                  <ComboboxInput
                    options={fallbackModelOptions}
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
                    placeholder={t('Select or enter model name')}
                    allowCustomValue
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'A vision-capable model used to describe images. It must have an enabled channel in the user group and a configured price/ratio, because each vision call is billed to the user.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='visual_fallback_setting.prompt'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Vision description prompt')}</FormLabel>
                <FormControl>
                  <Textarea
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    rows={5}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'System prompt sent to the vision fallback model when describing an image.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='visual_fallback_setting.supported_models'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Vision-capable models')}</FormLabel>
                <FormControl>
                  <MultiSelect
                    options={visionModelOptions}
                    selected={(field.value ?? '')
                      .split('\n')
                      .map((item) => item.trim())
                      .filter(Boolean)}
                    onChange={(values) => field.onChange(values.join('\n'))}
                    placeholder={t('Select or enter model name')}
                    allowCreate
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Models that already support vision, one per line. Requests to these models skip the fallback. Matching is case-insensitive and matches model names containing the entry.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
