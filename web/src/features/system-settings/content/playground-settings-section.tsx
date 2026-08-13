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
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
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

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

const playgroundSchema = z.object({
  PlaygroundImageTTLDays: z.number().int().min(1),
  PlaygroundImageMaxCountPerUser: z.number().int().min(1),
  PlaygroundImageMaxTotalMBPerUser: z.number().int().min(1),
  PlaygroundImageMaxPermanentPerUser: z.number().int().min(1),
})

type PlaygroundSettingsValues = z.infer<typeof playgroundSchema>

type PlaygroundSettingsSectionProps = {
  defaultValues: PlaygroundSettingsValues
}

const FIELD_KEYS: Array<keyof PlaygroundSettingsValues> = [
  'PlaygroundImageTTLDays',
  'PlaygroundImageMaxCountPerUser',
  'PlaygroundImageMaxTotalMBPerUser',
  'PlaygroundImageMaxPermanentPerUser',
]

/**
 * Playground image storage settings: transient TTL and per-user quotas.
 * Hot-applies via the option store.
 */
export function PlaygroundSettingsSection({
  defaultValues,
}: PlaygroundSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<PlaygroundSettingsValues>({
    resolver: zodResolver(playgroundSchema),
    mode: 'onChange',
    defaultValues,
  })

  const initialValuesRef = useRef<PlaygroundSettingsValues>(defaultValues)

  useEffect(() => {
    form.reset(defaultValues)
    initialValuesRef.current = defaultValues
  }, [defaultValues, form])

  const onSubmit = async (values: PlaygroundSettingsValues) => {
    const initial = initialValuesRef.current
    for (const key of FIELD_KEYS) {
      if (values[key] === initial[key]) continue
      await updateOption.mutateAsync({
        key,
        value: String(values[key]),
      })
    }
  }

  return (
    <SettingsSection title={t('Playground image storage')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            isSaving={updateOption.isPending}
            onSave={form.handleSubmit(onSubmit)}
            saveLabel='Save playground settings'
          />

          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='PlaygroundImageTTLDays'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Temporary image TTL (days)')}</FormLabel>
                  <FormControl>
                    <Input min={1} type='number' {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormDescription>
                    {t('Expire temporary chat attachments after this many days.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='PlaygroundImageMaxCountPerUser'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Max temporary images per user')}
                  </FormLabel>
                  <FormControl>
                    <Input min={1} type='number' {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='PlaygroundImageMaxTotalMBPerUser'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Max temporary image storage (MB)')}
                  </FormLabel>
                  <FormControl>
                    <Input min={1} type='number' {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='PlaygroundImageMaxPermanentPerUser'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Max permanent images per user')}
                  </FormLabel>
                  <FormControl>
                    <Input min={1} type='number' {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormDescription>
                    {t('Saved generated images never expire.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
