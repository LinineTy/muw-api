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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
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

import {
  cleanupPlaygroundImages,
  getPlaygroundImageAdminStats,
  type PlaygroundImageAdminStats,
} from '@/features/playground/api'
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

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(mb >= 10 ? 0 : 2)} MB`
}

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

  const [stats, setStats] = useState<PlaygroundImageAdminStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const loadStats = useCallback(async () => {
    const next = await getPlaygroundImageAdminStats()
    setStats(next)
  }, [])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

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

  const handleCleanup = async (all: boolean) => {
    setBusy(true)
    try {
      const deleted = await cleanupPlaygroundImages(all)
      toast.success(
        all
          ? t('Cleared {{count}} temporary images', { count: deleted })
          : t('Cleaned up {{count}} expired temporary images', {
              count: deleted,
            })
      )
      await loadStats()
    } catch {
      toast.error(t('Cleanup failed'))
    } finally {
      setBusy(false)
      setClearConfirmOpen(false)
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

      {/* Usage stats + manual cleanup */}
      <div className='border-border/60 mt-6 border-t pt-4'>
        <h4 className='text-sm font-semibold'>{t('Usage')}</h4>
        {stats ? (
          <dl className='text-muted-foreground mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4'>
            <div>
              <dt className='text-xs'>{t('Temporary images')}</dt>
              <dd className='text-foreground font-medium'>
                {stats.transient.count}
              </dd>
            </div>
            <div>
              <dt className='text-xs'>{t('Temporary size')}</dt>
              <dd className='text-foreground font-medium'>
                {formatBytes(stats.transient.total_bytes)}
              </dd>
            </div>
            <div>
              <dt className='text-xs'>{t('Permanent images')}</dt>
              <dd className='text-foreground font-medium'>
                {stats.permanent.count}
              </dd>
            </div>
            <div>
              <dt className='text-xs'>{t('Permanent size')}</dt>
              <dd className='text-foreground font-medium'>
                {formatBytes(stats.permanent.total_bytes)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className='text-muted-foreground mt-3 text-sm'>{t('Loading...')}</p>
        )}

        {stats && (stats.top_users?.length ?? 0) > 0 && (
          <div className='mt-3'>
            <p className='text-muted-foreground text-xs'>
              {t('Top users by storage')}
            </p>
            <ul className='text-muted-foreground mt-1 space-y-0.5 text-xs'>
              {stats.top_users?.map((user) => (
                <li key={user.user_id}>
                  #{user.user_id} · {user.count} {t('images')} ·{' '}
                  {formatBytes(user.total_bytes)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className='mt-4 flex flex-wrap gap-2'>
          <Button
            disabled={busy}
            onClick={() => void handleCleanup(false)}
            size='sm'
            variant='outline'
          >
            {t('Clean up expired temporary images')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => setClearConfirmOpen(true)}
            size='sm'
            variant='destructive'
          >
            {t('Clear all temporary images')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        destructive
        desc={t(
          'All temporary playground images will be deleted immediately, including ones not yet expired.'
        )}
        confirmText={t('Clear')}
        handleConfirm={() => void handleCleanup(true)}
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('Clear all temporary images?')}
      />
    </SettingsSection>
  )
}
