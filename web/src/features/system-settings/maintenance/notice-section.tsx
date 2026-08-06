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
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import {
  SettingsForm,
  SettingsFormGridItem,
  SettingsSwitchField,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const noticeSchema = z.object({
  Notice: z.string().optional(),
})

type NoticeFormValues = z.infer<typeof noticeSchema>

type NoticeSectionProps = {
  defaultValue: string
  popupEnabled: boolean
  popupDuration: number
}

export function NoticeSection({
  defaultValue,
  popupEnabled,
  popupDuration,
}: NoticeSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [isPopupEnabled, setIsPopupEnabled] = useState(popupEnabled)
  const [duration, setDuration] = useState(popupDuration)
  const form = useForm<NoticeFormValues>({
    resolver: zodResolver(noticeSchema),
    defaultValues: {
      Notice: defaultValue ?? '',
    },
  })

  useEffect(() => {
    setIsPopupEnabled(popupEnabled)
  }, [popupEnabled])

  useEffect(() => {
    setDuration(popupDuration)
  }, [popupDuration])

  useEffect(() => {
    form.reset({ Notice: defaultValue ?? '' })
  }, [defaultValue, form])

  const handleTogglePopup = async (checked: boolean) => {
    try {
      await updateOption.mutateAsync({
        key: 'console_setting.announcement_popup_enabled',
        value: checked,
      })
      setIsPopupEnabled(checked)
      toast.success(t('Setting saved'))
    } catch {
      toast.error(t('Failed to update setting'))
    }
  }

  const handleDurationChange = (raw: string) => {
    const num = Number(raw)
    if (!Number.isNaN(num)) {
      setDuration(num)
    }
  }

  const saveDuration = async () => {
    const value = Math.max(0, Math.floor(Number(duration) || 0))
    setDuration(value)
    try {
      await updateOption.mutateAsync({
        key: 'console_setting.announcement_popup_duration',
        value,
      })
      toast.success(t('Setting saved'))
    } catch {
      toast.error(t('Failed to update setting'))
    }
  }

  const onSubmit = async (values: NoticeFormValues) => {
    const normalized = values.Notice ?? ''
    if (normalized === (defaultValue ?? '')) {
      return
    }
    await updateOption.mutateAsync({
      key: 'Notice',
      value: normalized,
    })
  }

  return (
    <SettingsSection title={t('System Notice')}>
      <div className='pb-2'>
        <SettingsSwitchField
          checked={isPopupEnabled}
          onCheckedChange={handleTogglePopup}
          label={t('Show announcement popup automatically')}
          description={t(
            'Show the announcement popup when visiting the landing page'
          )}
        />
        <SettingsFormGridItem className='pt-2'>
          <div className='flex min-w-0 flex-row items-center justify-between gap-4'>
            <div className='min-w-0 space-y-0.5'>
              <div className='text-sm font-medium'>
                {t('Countdown (seconds)')}
              </div>
              <p className='text-muted-foreground text-xs'>
                {t('How long the popup must stay open before it can be closed')}
              </p>
            </div>
            <Input
              type='number'
              min={0}
              max={60}
              value={Number.isFinite(duration) ? duration : 0}
              onChange={(e) => handleDurationChange(e.target.value)}
              onBlur={saveDuration}
              className='w-24'
            />
          </div>
        </SettingsFormGridItem>
      </div>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save notice'
          />
          <FormField
            control={form.control}
            name='Notice'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Announcement content')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={8}
                    placeholder={t(
                      'Planned maintenance on Friday at 22:00 UTC...'
                    )}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
