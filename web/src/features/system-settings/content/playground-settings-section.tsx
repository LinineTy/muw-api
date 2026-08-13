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
import { useRef, useState } from 'react'
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

import { cleanupPlaygroundImages } from '@/features/playground/api'
import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

// 云空间容量设置：初始容量 / 展示货币价格 / 单次上限 / 总分配量
const spaceSchema = z.object({
  UserSpaceInitialMB: z.number().int().min(1),
  UserSpacePurchaseRatio: z.number().positive(),
  UserSpaceMaxPurchaseMB: z.number().int().min(1),
  UserSpaceGlobalMaxMB: z.number().int().min(1),
})

// 临时图片清理：TTL + 手动清理
const cleanupSchema = z.object({
  PlaygroundImageTTLDays: z.number().int().min(1),
})

type SpaceSettingsValues = z.infer<typeof spaceSchema>
type CleanupSettingsValues = z.infer<typeof cleanupSchema>

type PlaygroundSettingsSectionProps = {
  defaultValues: SpaceSettingsValues & CleanupSettingsValues
}

const SPACE_FIELD_KEYS: Array<keyof SpaceSettingsValues> = [
  'UserSpaceInitialMB',
  'UserSpacePurchaseRatio',
  'UserSpaceMaxPurchaseMB',
  'UserSpaceGlobalMaxMB',
]
const CLEANUP_FIELD_KEYS: Array<keyof CleanupSettingsValues> = [
  'PlaygroundImageTTLDays',
]

function pick<T extends object, K extends keyof T>(
  source: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    result[key] = source[key]
  }
  return result
}

/**
 * 云空间设置：分两张卡片——「用户云空间」（容量/价格/上限/总分配量）与
 * 「临时图片清理」（TTL + 手动清理），热生效。
 */
export function PlaygroundSettingsSection({
  defaultValues,
}: PlaygroundSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const spaceForm = useForm<SpaceSettingsValues>({
    resolver: zodResolver(spaceSchema),
    mode: 'onChange',
    defaultValues: pick(defaultValues, SPACE_FIELD_KEYS),
  })
  const spaceInitialRef = useRef<SpaceSettingsValues>(
    pick(defaultValues, SPACE_FIELD_KEYS)
  )

  const cleanupForm = useForm<CleanupSettingsValues>({
    resolver: zodResolver(cleanupSchema),
    mode: 'onChange',
    defaultValues: pick(defaultValues, CLEANUP_FIELD_KEYS),
  })
  const cleanupInitialRef = useRef<CleanupSettingsValues>(
    pick(defaultValues, CLEANUP_FIELD_KEYS)
  )

  const [busy, setBusy] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const onSubmitSpace = async (values: SpaceSettingsValues) => {
    const initial = spaceInitialRef.current
    for (const key of SPACE_FIELD_KEYS) {
      if (values[key] === initial[key]) continue
      await updateOption.mutateAsync({
        key,
        value: String(values[key]),
      })
    }
  }

  const onSubmitCleanup = async (values: CleanupSettingsValues) => {
    const initial = cleanupInitialRef.current
    for (const key of CLEANUP_FIELD_KEYS) {
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
    } catch {
      toast.error(t('Cleanup failed'))
    } finally {
      setBusy(false)
      setClearConfirmOpen(false)
    }
  }

  return (
    <>
      <SettingsSection title={t('User cloud space')}>
        <Form {...spaceForm}>
          <SettingsForm onSubmit={spaceForm.handleSubmit(onSubmitSpace)}>
            <SettingsPageFormActions
              isSaving={updateOption.isPending}
              onSave={spaceForm.handleSubmit(onSubmitSpace)}
              saveLabel='Save cloud space settings'
            />

            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                control={spaceForm.control}
                name='UserSpaceInitialMB'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Initial storage per user (MB)')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        min={1}
                        type='number'
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Every user starts with this capacity; they can buy more with quota.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={spaceForm.control}
                name='UserSpacePurchaseRatio'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Purchase ratio (quota per MB)')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        step='0.0001'
                        type='number'
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Price per MB in the display currency; converted to quota when buying.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={spaceForm.control}
                name='UserSpaceMaxPurchaseMB'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Max purchase per order (MB)')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        min={1}
                        type='number'
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('The most a user can buy in a single purchase.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={spaceForm.control}
                name='UserSpaceGlobalMaxMB'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Cloud space total allocation (MB)')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        min={1}
                        type='number'
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Fixed allocation for all users’ cloud space (e.g. 20GB of a 50GB disk). Regular users are refused when it is full.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </SettingsForm>
        </Form>
      </SettingsSection>

      <SettingsSection title={t('Temporary image cleanup')}>
        <Form {...cleanupForm}>
          <SettingsForm onSubmit={cleanupForm.handleSubmit(onSubmitCleanup)}>
            <SettingsPageFormActions
              isSaving={updateOption.isPending}
              onSave={cleanupForm.handleSubmit(onSubmitCleanup)}
              saveLabel='Save cleanup settings'
            />

            <FormField
              control={cleanupForm.control}
              name='PlaygroundImageTTLDays'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Temporary image TTL (days)')}</FormLabel>
                  <FormControl>
                    <Input
                      min={1}
                      type='number'
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Expire temporary chat attachments after this many days.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsForm>
        </Form>

        <div className='border-border/60 mt-6 border-t pt-4'>
          <h4 className='text-sm font-semibold'>{t('Manual cleanup')}</h4>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(
              'Usage is shown in the cloud space page. Here you can clean up temporary images for all users.'
            )}
          </p>
          <div className='mt-3 flex flex-wrap gap-2'>
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
      </SettingsSection>

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
    </>
  )
}
