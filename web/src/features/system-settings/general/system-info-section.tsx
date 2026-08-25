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
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

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
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

const _systemInfoSchema = z.object({
  SystemName: z.string().min(1),
  ServerAddress: z.string().optional(),
  Logo: z.string().url().optional().or(z.literal('')),
  BackgroundImage: z.string().optional(),
  GlassMaskOpacity: z.string().optional(),
  GlassBrightness: z.string().optional(),
  Footer: z.string().optional(),
})

type SystemInfoFormValues = z.infer<typeof _systemInfoSchema>

type SystemInfoSectionProps = {
  defaultValues: SystemInfoFormValues
}

function normalizeValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

export function SystemInfoSection({ defaultValues }: SystemInfoSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const normalizedDefaults: SystemInfoFormValues = {
    SystemName: normalizeValue(defaultValues.SystemName),
    ServerAddress: normalizeValue(defaultValues.ServerAddress),
    Logo: normalizeValue(defaultValues.Logo),
    BackgroundImage: normalizeValue(defaultValues.BackgroundImage),
    GlassMaskOpacity:
      normalizeValue(defaultValues.GlassMaskOpacity) || '0.35',
    GlassBrightness: normalizeValue(defaultValues.GlassBrightness) || '1',
    Footer: normalizeValue(defaultValues.Footer),
  }

  const systemInfoSchemaWithI18n = z.object({
    SystemName: z.string().min(1, {
      error: () => t('System name is required'),
    }),
    ServerAddress: z.string().optional(),
    Logo: z.string().url().optional().or(z.literal('')),
    BackgroundImage: z.string().optional(),
    GlassMaskOpacity: z.string().optional(),
    GlassBrightness: z.string().optional(),
    Footer: z.string().optional(),
  })

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<SystemInfoFormValues>({
      resolver: zodResolver(systemInfoSchemaWithI18n) as Resolver<
        SystemInfoFormValues,
        unknown,
        SystemInfoFormValues
      >,
      defaultValues: normalizedDefaults,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          let v = normalizeValue(value)
          if (key === 'ServerAddress') {
            v = v.replace(/\/+$/, '')
          }
          await updateOption.mutateAsync({
            key,
            value: v,
          })
        }
      },
    })

  return (
    <>
      <FormNavigationGuard when={isDirty} />

      <SettingsSection title={t('System Information')}>
        <Form {...form}>
          <SettingsForm onSubmit={handleSubmit}>
            <SettingsPageFormActions
              onSave={handleSubmit}
              onReset={handleReset}
              isSaving={isSubmitting || updateOption.isPending}
              isResetDisabled={!isDirty}
            />
            <FormDirtyIndicator isDirty={isDirty} />
            <SettingsFormGrid>
              <FormField
                control={form.control}
                name='SystemName'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('System Name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('New API')} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('The name displayed across the application')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ServerAddress'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Server Address')}</FormLabel>
                    <FormControl>
                      <Input placeholder='https://yourdomain.com' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'The public URL of your server, used for OAuth callbacks, webhooks, and other external integrations'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='Logo'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Logo URL')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('https://example.com/logo.png')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('URL to your logo image (optional)')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='BackgroundImage'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Background image URL')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('https://example.com/background.jpg')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'URL to a global background image shown behind the interface (optional); looks best with the Liquid Glass theme'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='GlassMaskOpacity'
                render={({ field }) => {
                  const raw = Number(field.value)
                  // clamp 到滑块 [0,90],防 DB 值被 API 写成越界时滑块 value 超 max
                  const percent = Number.isFinite(raw)
                    ? Math.min(90, Math.max(0, Math.round(raw * 100)))
                    : 35
                  return (
                    <FormItem>
                      <FormLabel>{t('Background image mask')}</FormLabel>
                      <div className='flex items-center gap-3'>
                        <Slider
                          aria-label={t('Background image mask')}
                          min={0}
                          max={90}
                          step={5}
                          value={[percent]}
                          onValueChange={(nextValue) => {
                            const first = Array.isArray(nextValue)
                              ? nextValue[0]
                              : nextValue
                            field.onChange((first / 100).toFixed(2))
                          }}
                        />
                        <span className='text-muted-foreground w-10 shrink-0 text-right text-sm tabular-nums'>
                          {percent}%
                        </span>
                      </div>
                      <FormDescription>
                        {t(
                          'How strongly the background image is dimmed (0% = shown as-is; higher = softer behind the glass)'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />

              <FormField
                control={form.control}
                name='GlassBrightness'
                render={({ field }) => {
                  const raw = Number(field.value)
                  // clamp 到滑块 [50,150],防 DB 值被 API 写成越界时滑块 value 超 max
                  const percent = Number.isFinite(raw)
                    ? Math.min(150, Math.max(50, Math.round(raw * 100)))
                    : 100
                  return (
                    <FormItem>
                      <FormLabel>{t('Background brightness')}</FormLabel>
                      <div className='flex items-center gap-3'>
                        <Slider
                          aria-label={t('Background brightness')}
                          min={50}
                          max={150}
                          step={5}
                          value={[percent]}
                          onValueChange={(nextValue) => {
                            const first = Array.isArray(nextValue)
                              ? nextValue[0]
                              : nextValue
                            field.onChange((first / 100).toFixed(2))
                          }}
                        />
                        <span className='text-muted-foreground w-10 shrink-0 text-right text-sm tabular-nums'>
                          {percent}%
                        </span>
                      </div>
                      <FormDescription>
                        {t(
                          'Overall brightness of the background image (100% = as-is)'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />

              <FormField
                control={form.control}
                name='Footer'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Footer')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          '© 2025 Your Company. All rights reserved.'
                        )}
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Footer text displayed at the bottom of pages')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

            </SettingsFormGrid>
          </SettingsForm>
        </Form>
      </SettingsSection>
    </>
  )
}
