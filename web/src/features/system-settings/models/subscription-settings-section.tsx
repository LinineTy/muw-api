// @muw-owned
import { zodResolver } from '@hookform/resolvers/zod'
import { Trash2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
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

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

const subscriptionSettingsSchema = z.object({
  SubscriptionAutoRenewEnabled: z.boolean(),
  SubscriptionPriorityEnabled: z.boolean(),
  SubscriptionGroupUpgradeEnabled: z.boolean(),
  SubscriptionExclusiveGroupEnabled: z.boolean(),
  SubscriptionGroupPriorities: z.string(),
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

/** 解析组优先级 JSON → 行数组（非法输入容忍为空）。 */
function parsePriorityRows(
  value: string
): { group: string; priority: number }[] {
  try {
    const parsed: unknown = JSON.parse(value || '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return []
    return Object.entries(parsed).map(([group, priority]) => ({
      group,
      priority: Number(priority) || 0,
    }))
  } catch {
    return []
  }
}

/**
 * 组优先级结构化编辑器:每行 = 组名 + 优先级 + 删除,底部添加行。
 * 对外交付 JSON 字符串(空组名行不入序列),管理员不用手写 JSON。
 */
function GroupPrioritiesEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const rows = useMemo(() => parsePriorityRows(value), [value])

  const emit = (next: { group: string; priority: number }[]) => {
    const obj: Record<string, number> = {}
    for (const r of next) {
      const name = r.group.trim()
      if (name) obj[name] = r.priority
    }
    onChange(JSON.stringify(obj))
  }

  return (
    <div className='space-y-2'>
      {rows.map((row, i) => (
        <div key={i} className='flex items-center gap-2'>
          <Input
            className='max-w-48'
            value={row.group}
            placeholder={t('Group name')}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...row, group: e.target.value }
              emit(next)
            }}
          />
          <Input
            className='max-w-32'
            type='number'
            step={1}
            value={row.priority}
            onChange={(e) => {
              const next = [...rows]
              next[i] = {
                ...row,
                priority: Number.parseInt(e.target.value, 10) || 0,
              }
              emit(next)
            }}
          />
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label={t('Remove group')}
            onClick={() => emit(rows.filter((_, j) => j !== i))}
          >
            <Trash2 className='size-4' aria-hidden='true' />
          </Button>
        </div>
      ))}
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => emit([...rows, { group: '', priority: 0 }])}
      >
        {t('Add group')}
      </Button>
    </div>
  )
}

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
                  <GroupPrioritiesEditor
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Higher priority wins (unlisted groups = 0). A purchase only changes the user group when the target priority is not lower; group fallback on expiry never lands on an equal-or-higher group and prefers the highest group still backed by an active subscription.'
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
