// @muw-owned
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
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { JsonCodeEditor } from '@/components/json-code-editor'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

// 组优先级 JSON：{"v2":30,"v1":20}——组名 → 整数优先级，未配置的组 = 0。
const groupPrioritiesSchema = z
  .string()
  .refine((v) => {
    if (!v.trim()) return true
    try {
      const parsed: unknown = JSON.parse(v)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return false
      }
      return Object.values(parsed).every((n) => Number.isInteger(n))
    } catch {
      return false
    }
  })

const subscriptionSettingsSchema = z.object({
  SubscriptionAutoRenewEnabled: z.boolean(),
  SubscriptionPriorityEnabled: z.boolean(),
  SubscriptionGroupUpgradeEnabled: z.boolean(),
  SubscriptionExclusiveGroupEnabled: z.boolean(),
  SubscriptionGroupPriorities: groupPrioritiesSchema,
  SubscriptionMaxSimultaneous: z.number().int().min(0),
})

type SubscriptionSettingsFormValues = z.infer<
  typeof subscriptionSettingsSchema
>
type SubscriptionSettingsFormInput = z.input<
  typeof subscriptionSettingsSchema
>

type SubscriptionSettingsSectionProps = {
  defaultValues: {
    SubscriptionAutoRenewEnabled: boolean
    SubscriptionPriorityEnabled: boolean
    SubscriptionGroupUpgradeEnabled: boolean
    SubscriptionExclusiveGroupEnabled: boolean
    SubscriptionGroupPriorities: string
    SubscriptionMaxSimultaneous: number
  }
}

const buildFormDefaults = (
  defaults: SubscriptionSettingsSectionProps['defaultValues']
): SubscriptionSettingsFormInput => ({
  SubscriptionAutoRenewEnabled: defaults.SubscriptionAutoRenewEnabled,
  SubscriptionPriorityEnabled: defaults.SubscriptionPriorityEnabled,
  SubscriptionGroupUpgradeEnabled:
    defaults.SubscriptionGroupUpgradeEnabled,
  SubscriptionExclusiveGroupEnabled:
    defaults.SubscriptionExclusiveGroupEnabled,
  SubscriptionGroupPriorities: defaults.SubscriptionGroupPriorities,
  SubscriptionMaxSimultaneous: defaults.SubscriptionMaxSimultaneous ?? 0,
})

export function SubscriptionSettingsSection({
  defaultValues,
}: SubscriptionSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<SubscriptionSettingsFormValues>(
    buildFormDefaults(defaultValues)
  )

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<
    SubscriptionSettingsFormInput,
    unknown,
    SubscriptionSettingsFormValues
  >({
    resolver: zodResolver(subscriptionSettingsSchema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const onSubmit = async (values: SubscriptionSettingsFormValues) => {
    const updates = (
      Object.keys(values) as Array<keyof SubscriptionSettingsFormValues>
    ).filter((key) => values[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({
        key,
        value: String(values[key]),
      })
    }

    baselineRef.current = values
  }

  return (
    <SettingsSection title={t('Subscription')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          <div className='grid min-w-0 gap-6 lg:grid-cols-2'>
            <FormField
              control={form.control}
              name='SubscriptionAutoRenewEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Auto-renew')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Automatically renew active subscriptions with wallet balance near expiry. When disabled the task is skipped.'
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
              name='SubscriptionPriorityEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Consumption priority')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Let users mark one active subscription as preferred (Use First). Disabled hides the feature.'
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
              name='SubscriptionGroupUpgradeEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('User group upgrade / downgrade')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Apply the plan upgrade group on purchase and downgrade on expiry/cancel. Disabled keeps the user group unchanged.'
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
              name='SubscriptionExclusiveGroupEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Mutual-exclusion groups')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Plans in the same exclusive group cannot coexist; purchasing another triggers a prorated upgrade/downgrade. Disabled lets users hold several plans.'
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
          </div>

          <FormField
            control={form.control}
            name='SubscriptionGroupPriorities'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Subscription group priorities')}</FormLabel>
                <FormControl>
                  <JsonCodeEditor
                    value={field.value}
                    onChange={field.onChange}
                    name={field.name}
                    onBlur={field.onBlur}
                    textareaRef={field.ref}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'JSON mapping group name to integer priority (higher wins, unlisted groups = 0). Purchases only change the user group when the target priority is not lower; group fallback on expiry never lands on an equal-or-higher group and prefers the highest group still backed by an active subscription. Example: {"v2":30,"v1":20}.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='SubscriptionMaxSimultaneous'
            render={({ field }) => (
              <FormItem className='max-w-xs'>
                <FormLabel>{t('Max simultaneous subscriptions')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step={1}
                    {...field}
                    onChange={(e) =>
                      field.onChange(
                        Number.parseInt(e.target.value, 10) || 0
                      )
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Global cap on how many active subscriptions one user may hold. 0 means unlimited.'
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
