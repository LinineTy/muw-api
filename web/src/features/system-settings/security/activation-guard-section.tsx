// @muw-owned
/** 激活防护设置页：人机校验难度、钓鱼码宽限时间、蜜罐与登录入口校验开关。 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
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
import { Switch } from '@/components/ui/switch'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  MAX_POW_BITS,
  MIN_GRACE_SECONDS,
  pickChangedActivationGuardOptions,
} from './activation-guard'

const activationGuardSchema = z.object({
  PoWChallengeBits: z.number().min(0).max(MAX_POW_BITS),
  InviteTrapGraceSeconds: z.number().min(MIN_GRACE_SECONDS),
  ActivationHoneypotEnabled: z.boolean(),
  LoginChallengeEnabled: z.boolean(),
})

type ActivationGuardFormValues = z.output<typeof activationGuardSchema>
type ActivationGuardFormInput = z.input<typeof activationGuardSchema>

type NormalizedActivationGuardValues = {
  PoWChallengeBits: number
  InviteTrapGraceSeconds: number
  ActivationHoneypotEnabled: boolean
  LoginChallengeEnabled: boolean
}

type ActivationGuardSectionProps = {
  defaultValues: NormalizedActivationGuardValues
}

const buildFormDefaults = (
  defaults: ActivationGuardSectionProps['defaultValues']
): ActivationGuardFormInput => ({
  PoWChallengeBits: defaults.PoWChallengeBits,
  InviteTrapGraceSeconds: defaults.InviteTrapGraceSeconds,
  ActivationHoneypotEnabled: defaults.ActivationHoneypotEnabled,
  LoginChallengeEnabled: defaults.LoginChallengeEnabled,
})

export function ActivationGuardSection({
  defaultValues,
}: ActivationGuardSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<
    ActivationGuardFormInput,
    unknown,
    ActivationGuardFormValues
  >({
    resolver: zodResolver(activationGuardSchema),
    mode: 'onChange',
    defaultValues: buildFormDefaults(defaultValues),
  })

  useEffect(() => {
    form.reset(buildFormDefaults(defaultValues))
  }, [defaultValues, form])

  const onSubmit = async (values: ActivationGuardFormValues) => {
    // 只提交改动过的键（逐项 PUT），避免把没动过的值一起回写。
    for (const { key, value } of pickChangedActivationGuardOptions(
      values,
      defaultValues
    )) {
      await updateOption.mutateAsync({ key, value })
    }
  }

  return (
    <SettingsSection title={t('Activation Protection')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save activation protection'
          />

          <FormField
            control={form.control}
            name='PoWChallengeBits'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Proof-of-work difficulty')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={MAX_POW_BITS}
                    step={1}
                    className='w-32'
                    {...field}
                    onChange={(e) =>
                      field.onChange(Number.parseInt(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Leading zero bits each challenge must solve. 0 disables the check, 24 is the maximum, default 18.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='InviteTrapGraceSeconds'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Trap code grace period (seconds)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={MIN_GRACE_SECONDS}
                    step={60}
                    className='w-32'
                    {...field}
                    onChange={(e) =>
                      field.onChange(Number.parseInt(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'How long an account that used a trap invite code stays usable before it is disabled. Minimum 60 seconds, default 900; activating with a valid code clears it.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='LoginChallengeEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between gap-4 rounded-xl border p-4'>
                <div className='space-y-1'>
                  <FormLabel>{t('Require the check on sign-in')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Require the check for password sign-in, sign-up and third-party sign-in.'
                    )}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='ActivationHoneypotEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between gap-4 rounded-xl border p-4'>
                <div className='space-y-1'>
                  <FormLabel>{t('Hidden honeypot field')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Adds a field that is hidden from users; only automation fills it. A filled value disables the account.'
                    )}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
