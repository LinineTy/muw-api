// @muw-owned
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
import { SettingsForm, SettingsFormGrid } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

// 云空间容量设置：初始容量 / 展示货币价格 / 单次上限 / 累计购买上限 / 总分配量
const spaceSchema = z.object({
  UserSpaceInitialMB: z.number().int().min(1),
  UserSpacePurchaseRatio: z.number().positive(),
  UserSpaceMaxPurchaseMB: z.number().int().min(1),
  UserSpaceMaxPurchasedMB: z.number().int().min(0), // 0 = 不限制累计购买
  UserSpaceGlobalMaxMB: z.number().int().min(1),
})

// 临时图片清理：TTL + 手动清理
const cleanupSchema = z.object({
  PlaygroundImageTTLDays: z.number().int().min(1),
})

// 两个分表单合并成一个：云空间容量 + 临时图片 TTL 共用同一个保存按钮（页头只出
// 一个「保存」，改动字段才提交），避免页头堆两个保存按钮造成误解。
const spaceSettingsSchema = spaceSchema.extend(cleanupSchema.shape)

type SpaceSettingsValues = z.infer<typeof spaceSettingsSchema>
type CleanupSettingsValues = z.infer<typeof cleanupSchema>

type PlaygroundSettingsSectionProps = {
  defaultValues: SpaceSettingsValues & CleanupSettingsValues
}

const SPACE_FIELD_KEYS: Array<keyof SpaceSettingsValues> = [
  'UserSpaceInitialMB',
  'UserSpacePurchaseRatio',
  'UserSpaceMaxPurchaseMB',
  'UserSpaceMaxPurchasedMB',
  'UserSpaceGlobalMaxMB',
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
 * 「临时图片清理」（TTL + 手动清理），热生效。两张卡共用一份表单与一个保存按钮。
 */
export function PlaygroundSettingsSection({
  defaultValues,
}: PlaygroundSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<SpaceSettingsValues>({
    resolver: zodResolver(spaceSettingsSchema),
    mode: 'onChange',
    defaultValues: pick(defaultValues, SPACE_FIELD_KEYS),
  })
  const initialRef = useRef<SpaceSettingsValues>(
    pick(defaultValues, SPACE_FIELD_KEYS)
  )

  const [busy, setBusy] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const onSubmit = async (values: SpaceSettingsValues) => {
    const initial = initialRef.current
    for (const key of SPACE_FIELD_KEYS) {
      if (values[key] === initial[key]) continue
      await updateOption.mutateAsync({
        key,
        value: String(values[key]),
      })
    }
    // 保存成功后以本次提交为新的基线，避免下次保存重复提交未变化的字段。
    initialRef.current = { ...values }
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
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            isSaving={updateOption.isPending}
            onSave={form.handleSubmit(onSubmit)}
            saveLabel='Save cloud space settings'
          />

          <SettingsSection title={t('User cloud space')}>
            <SettingsFormGrid>
              <FormField
                control={form.control}
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
                control={form.control}
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
                    <FormDescription>
                      {t(
                        'When the display currency is tokens, this value is the token price per MB directly.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
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
                control={form.control}
                name='UserSpaceMaxPurchasedMB'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Max purchased per user (MB)')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        type='number'
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Total capacity a user can buy across all purchases. 0 means unlimited.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
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
            </SettingsFormGrid>
          </SettingsSection>

          <SettingsSection title={t('Temporary image cleanup')}>
            <SettingsFormGrid>
              <FormField
                control={form.control}
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
            </SettingsFormGrid>

            <div className='border-border/60 mt-6 border-t pt-4'>
              <h4 className='text-sm font-semibold'>{t('Manual cleanup')}</h4>
              <p className='text-muted-foreground mt-1 text-sm'>
                {t(
                  'Usage is shown on the profile page. Here you can clean up temporary images for all users.'
                )}
              </p>
              <div className='mt-3 flex flex-wrap gap-2'>
                <Button
                  type='button'
                  disabled={busy}
                  onClick={() => void handleCleanup(false)}
                  size='sm'
                  variant='outline'
                >
                  {t('Clean up expired temporary images')}
                </Button>
                <Button
                  type='button'
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
        </SettingsForm>
      </Form>

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
