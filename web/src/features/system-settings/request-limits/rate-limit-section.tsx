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
import { Code2, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { JsonCodeEditor } from '@/components/json-code-editor'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { RateLimitVisualEditor } from './rate-limit-visual-editor'

const isValidJSON = (value: string | undefined) => {
  if (!value || value.trim() === '') return true
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false
    }
    for (const [, val] of Object.entries(parsed)) {
      if (!Array.isArray(val) || val.length !== 2) return false
      if (typeof val[0] !== 'number' || typeof val[1] !== 'number') return false
      if (val[0] < 0 || val[1] < 1) return false
      if (val[0] > 2147483647 || val[1] > 2147483647) return false
    }
    return true
  } catch {
    return false
  }
}

const createRateLimitSchema = (t: (key: string) => string) =>
  z.object({
    ModelRequestRateLimitEnabled: z.boolean(),
    ModelRequestRateLimitDurationMinutes: z.number().min(0),
    ModelRequestRateLimitCount: z.number().min(0).max(100000000),
    ModelRequestRateLimitSuccessCount: z.number().min(1).max(100000000),
    ModelRequestRateLimitGroup: z
      .string()
      .optional()
      .refine(isValidJSON, {
        message: t('Invalid JSON format or values out of allowed range'),
      }),
    // IP 维度限流：次数 >= 1，窗口以秒存储（>= 60 秒 = 1 分钟）
    CriticalRateLimitEnable: z.boolean(),
    CriticalRateLimitNum: z.number().min(1).max(100000000),
    CriticalRateLimitDuration: z.number().min(60).max(2147483647),
    GlobalApiRateLimitEnable: z.boolean(),
    GlobalApiRateLimitNum: z.number().min(1).max(100000000),
    GlobalApiRateLimitDuration: z.number().min(60).max(2147483647),
    GlobalWebRateLimitEnable: z.boolean(),
    GlobalWebRateLimitNum: z.number().min(1).max(100000000),
    GlobalWebRateLimitDuration: z.number().min(60).max(2147483647),
  })

type RateLimitFormValues = z.infer<ReturnType<typeof createRateLimitSchema>>

type RateLimitSectionProps = {
  defaultValues: RateLimitFormValues
}

type IpRateLimitEnableField =
  | 'CriticalRateLimitEnable'
  | 'GlobalApiRateLimitEnable'
  | 'GlobalWebRateLimitEnable'

type IpRateLimitNumField =
  | 'CriticalRateLimitNum'
  | 'GlobalApiRateLimitNum'
  | 'GlobalWebRateLimitNum'

type IpRateLimitDurationField =
  | 'CriticalRateLimitDuration'
  | 'GlobalApiRateLimitDuration'
  | 'GlobalWebRateLimitDuration'

// RateLimitGroupFields 渲染一组 IP 维度限流：开关 + 次数 + 时间窗口。
// 时间窗口以「分钟」输入、以「秒」存储（与后端 common 变量及现有环境变量单位一致），
// 保存后立即生效，无需重启。
function RateLimitGroupFields({
  title,
  description,
  enableField,
  numField,
  durationField,
}: {
  title: string
  description: string
  enableField: IpRateLimitEnableField
  numField: IpRateLimitNumField
  durationField: IpRateLimitDurationField
}) {
  const { t } = useTranslation()
  const { control } = useFormContext<RateLimitFormValues>()

  return (
    <div className='space-y-3'>
      <FormField
        control={control}
        name={enableField}
        render={({ field }) => (
          <SettingsSwitchItem>
            <SettingsSwitchContent>
              <FormLabel>{title}</FormLabel>
              <FormDescription>{description}</FormDescription>
            </SettingsSwitchContent>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </SettingsSwitchItem>
        )}
      />
      <div className='grid gap-4 md:grid-cols-2'>
        <FormField
          control={control}
          name={numField}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Max requests')}</FormLabel>
              <FormControl>
                <div className='flex items-center gap-2'>
                  <Input
                    type='number'
                    min={1}
                    step={1}
                    {...field}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value) || 0)
                    }
                  />
                  <span className='text-muted-foreground text-sm'>
                    {t('times')}
                  </span>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={durationField}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Time window (minutes)')}</FormLabel>
              <FormControl>
                <div className='flex items-center gap-2'>
                  <Input
                    type='number'
                    min={1}
                    step={1}
                    {...field}
                    value={Math.round((field.value / 60) * 100) / 100}
                    onChange={(e) => {
                      const minutes = parseFloat(e.target.value)
                      field.onChange(
                        Number.isNaN(minutes) ? 0 : Math.round(minutes * 60)
                      )
                    }}
                  />
                  <span className='text-muted-foreground text-sm'>
                    {t('minutes')}
                  </span>
                </div>
              </FormControl>
              <FormDescription>
                {t('Shared by all requests behind the same IP')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  )
}

export function RateLimitSection({ defaultValues }: RateLimitSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [useVisualEditor, setUseVisualEditor] = useState(true)

  const rateLimitSchema = createRateLimitSchema(t)

  const form = useForm<RateLimitFormValues>({
    resolver: zodResolver(rateLimitSchema),
    mode: 'onChange', // Enable real-time validation
    defaultValues,
  })

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const onSubmit = async (values: RateLimitFormValues) => {
    const updates = Object.entries(values).filter(
      ([key, value]) =>
        value !== defaultValues[key as keyof RateLimitFormValues]
    )

    for (const [key, value] of updates) {
      await updateOption.mutateAsync({ key, value: value ?? '' })
    }
  }

  return (
    <SettingsSection title={t('Rate Limiting')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save rate limits'
          />
          <FormField
            control={form.control}
            name='ModelRequestRateLimitEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable rate limiting')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Applies to model relay requests, keyed per user/group'
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

          <div className='grid gap-4 md:grid-cols-3'>
            <FormField
              control={form.control}
              name='ModelRequestRateLimitDurationMinutes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Limit period')}</FormLabel>
                  <FormControl>
                    <div className='flex items-center gap-2'>
                      <Input
                        type='number'
                        min={0}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 0)
                        }
                      />
                      <span className='text-muted-foreground text-sm'>
                        {t('minutes')}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('Time window for rate limiting')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ModelRequestRateLimitCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max requests per period')}</FormLabel>
                  <FormControl>
                    <div className='flex items-center gap-2'>
                      <Input
                        type='number'
                        min={0}
                        max={100000000}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 0)
                        }
                      />
                      <span className='text-muted-foreground text-sm'>
                        {t('times')}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('Including failed requests, 0 = unlimited')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ModelRequestRateLimitSuccessCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max successful requests')}</FormLabel>
                  <FormControl>
                    <div className='flex items-center gap-2'>
                      <Input
                        type='number'
                        min={1}
                        max={100000000}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 1)
                        }
                      />
                      <span className='text-muted-foreground text-sm'>
                        {t('times')}
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('Only successful requests')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='ModelRequestRateLimitGroup'
            render={({ field }) => (
              <FormItem>
                <div className='flex items-center justify-between'>
                  <FormLabel>{t('Group-based rate limits')}</FormLabel>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setUseVisualEditor(!useVisualEditor)}
                  >
                    {useVisualEditor ? (
                      <>
                        <Code2 className='mr-2 h-4 w-4' />
                        {t('JSON Mode')}
                      </>
                    ) : (
                      <>
                        <Palette className='mr-2 h-4 w-4' />
                        {t('Visual Mode')}
                      </>
                    )}
                  </Button>
                </div>
                <FormControl>
                  {useVisualEditor ? (
                    <RateLimitVisualEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                    />
                  ) : (
                    <JsonCodeEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                      name={field.name}
                      onBlur={field.onBlur}
                      textareaRef={field.ref}
                      placeholder={`{\n  "default": [200, 100],\n  "vip": [0, 1000]\n}`}
                      aria-invalid={Boolean(
                        form.formState.errors.ModelRequestRateLimitGroup
                      )}
                    />
                  )}
                </FormControl>
                {!useVisualEditor && (
                  <FormDescription>
                    <div className='space-y-1 text-xs'>
                      <p className='font-semibold'>{t('Format:')}</p>
                      <ul className='list-inside list-disc space-y-0.5 pl-2'>
                        <li>
                          {t('JSON object:')}{' '}
                          {`{"groupName": [maxRequests, maxSuccess]}`}
                        </li>
                        <li>
                          {t('Example:')}{' '}
                          {`{"default": [200, 100], "vip": [0, 1000]}`}
                        </li>
                        <li>
                          {t(
                            'maxRequests ≥ 0, maxSuccess ≥ 1, both ≤ 2,147,483,647'
                          )}
                        </li>
                        <li>
                          {t(
                            'Group config overrides global limits, shares the same period'
                          )}
                        </li>
                      </ul>
                    </div>
                  </FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* IP 维度限流：与 relay 模型限流不同，按客户端 IP 统计，覆盖敏感操作与整组路由 */}
          <div className='border-border/60 space-y-5 border-t pt-4'>
            <RateLimitGroupFields
              title={t('Critical Rate Limit')}
              description={t(
                'Sensitive operations: login, session refresh, OAuth and purchases'
              )}
              enableField='CriticalRateLimitEnable'
              numField='CriticalRateLimitNum'
              durationField='CriticalRateLimitDuration'
            />
            <RateLimitGroupFields
              title={t('Global API Rate Limit')}
              description={t('Applies to all /api requests')}
              enableField='GlobalApiRateLimitEnable'
              numField='GlobalApiRateLimitNum'
              durationField='GlobalApiRateLimitDuration'
            />
            <RateLimitGroupFields
              title={t('Global Web Rate Limit')}
              description={t('Applies to web page assets and fallback routes')}
              enableField='GlobalWebRateLimitEnable'
              numField='GlobalWebRateLimitNum'
              durationField='GlobalWebRateLimitDuration'
            />
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
