// @muw-owned
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import {
  useFieldArray,
  useForm,
  type Resolver,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import {
  SettingsControlGroup,
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const PERIOD_OPTIONS = [
  { value: 'daily', labelKey: 'Daily' },
  { value: 'weekly', labelKey: 'Weekly' },
  { value: 'monthly', labelKey: 'Monthly' },
] as const

const AMOUNT_TYPE_OPTIONS = [
  { value: 'random', labelKey: 'Random' },
  { value: 'fixed', labelKey: 'Fixed' },
] as const

const BALANCE_MODE_OPTIONS = [
  { value: 'off', labelKey: 'No balance requirement' },
  { value: 'below', labelKey: 'Balance below the threshold' },
  { value: 'above', labelKey: 'Balance above the threshold' },
] as const

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const schema = z.object({
  enabled: z.boolean(),
  poolPeriod: z.string(),
  userPeriod: z.string(),
  amountType: z.string(),
  amount: z.coerce.number().min(0),
  minAmount: z.coerce.number().min(0),
  maxAmount: z.coerce.number().min(0),
  poolPeriodCap: z.coerce.number().min(0),
  userPeriodCap: z.coerce.number().min(0),
  userPeriodCountLimit: z.coerce.number().int().min(0),
  balanceMode: z.string(),
  balanceLimit: z.coerce.number().min(0),
  timeEnabled: z.boolean(),
  weekdays: z.array(z.number()),
  periods: z.array(z.object({ start: z.string(), end: z.string() })),
  dates: z.string(),
})

type Values = z.infer<typeof schema>

type QuotaPoolSettingsDefaultValues = {
  enabled: boolean
  poolPeriod: string
  userPeriod: string
  amountType: string
  amount: number
  minAmount: number
  maxAmount: number
  poolPeriodCap: number
  userPeriodCap: number
  userPeriodCountLimit: number
  timeRule: string
  balanceMode: string
  balanceLimit: number
}

type TimeWindowForm = {
  timeEnabled: boolean
  weekdays: number[]
  periods: { start: string; end: string }[]
  dates: string
}

const parseTimeRule = (rule: string): TimeWindowForm => {
  if (!rule || !rule.trim()) {
    return { timeEnabled: false, weekdays: [], periods: [], dates: '' }
  }
  try {
    const arr = JSON.parse(rule)
    const w = Array.isArray(arr) ? arr[0] : null
    if (!w || typeof w !== 'object') {
      return { timeEnabled: false, weekdays: [], periods: [], dates: '' }
    }
    return {
      timeEnabled: true,
      weekdays: Array.isArray(w.weekdays) ? w.weekdays : [],
      periods: Array.isArray(w.periods)
        ? w.periods
        : [{ start: '', end: '' }],
      dates: Array.isArray(w.dates) ? w.dates.join(', ') : '',
    }
  } catch {
    return { timeEnabled: false, weekdays: [], periods: [], dates: '' }
  }
}

const buildTimeRule = (v: {
  timeEnabled: boolean
  weekdays: number[]
  periods: { start: string; end: string }[]
  dates: string
}): string => {
  if (!v.timeEnabled) return ''
  const dates = v.dates
    .split(/[,，\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const periods = v.periods
    .filter((p) => p.start && p.end)
    .map((p) => ({ start: p.start, end: p.end }))
  const weekdays = v.weekdays || []
  return JSON.stringify([{ dates, weekdays, periods }])
}

const buildFormDefaults = (
  d: QuotaPoolSettingsDefaultValues
): Values => {
  const tw = parseTimeRule(d.timeRule)
  return {
    enabled: d.enabled,
    poolPeriod: d.poolPeriod || 'daily',
    userPeriod: d.userPeriod || 'weekly',
    amountType: d.amountType || 'random',
    amount: quotaUnitsToDollars(d.amount ?? 0),
    minAmount: quotaUnitsToDollars(d.minAmount ?? 0),
    maxAmount: quotaUnitsToDollars(d.maxAmount ?? 0),
    poolPeriodCap: quotaUnitsToDollars(d.poolPeriodCap ?? 0),
    userPeriodCap: quotaUnitsToDollars(d.userPeriodCap ?? 0),
    userPeriodCountLimit: d.userPeriodCountLimit ?? 0,
    balanceMode: d.balanceMode || 'off',
    balanceLimit: quotaUnitsToDollars(d.balanceLimit ?? 0),
    timeEnabled: tw.timeEnabled,
    weekdays: tw.weekdays,
    periods: tw.periods.length ? tw.periods : [{ start: '', end: '' }],
    dates: tw.dates,
  }
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
      {children}
    </div>
  )
}

export function QuotaPoolSettingsSection({
  defaultValues,
}: {
  defaultValues: QuotaPoolSettingsDefaultValues
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: formDefaults,
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'periods',
  })

  const { isDirty, isSubmitting } = form.formState
  const enabled = form.watch('enabled')
  const amountType = form.watch('amountType')
  const balanceMode = form.watch('balanceMode')
  const timeEnabled = form.watch('timeEnabled')
  const selectedWeekdays = form.watch('weekdays') || []

  const toggleWeekday = (idx: number, checked: boolean) => {
    const next = checked
      ? [...selectedWeekdays.filter((w) => w !== idx), idx]
      : selectedWeekdays.filter((w) => w !== idx)
    form.setValue('weekdays', next, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []

    if (values.enabled !== formDefaults.enabled) {
      updates.push({
        key: 'quota_pool_setting.enabled',
        value: String(values.enabled),
      })
    }
    if (values.poolPeriod !== formDefaults.poolPeriod) {
      updates.push({
        key: 'quota_pool_setting.pool_period',
        value: values.poolPeriod,
      })
    }
    if (values.userPeriod !== formDefaults.userPeriod) {
      updates.push({
        key: 'quota_pool_setting.user_period',
        value: values.userPeriod,
      })
    }
    if (values.amountType !== formDefaults.amountType) {
      updates.push({
        key: 'quota_pool_setting.amount_type',
        value: values.amountType,
      })
    }
    if (values.amount !== formDefaults.amount) {
      updates.push({
        key: 'quota_pool_setting.amount',
        value: String(parseQuotaFromDollars(values.amount)),
      })
    }
    if (values.minAmount !== formDefaults.minAmount) {
      updates.push({
        key: 'quota_pool_setting.min_amount',
        value: String(parseQuotaFromDollars(values.minAmount)),
      })
    }
    if (values.maxAmount !== formDefaults.maxAmount) {
      updates.push({
        key: 'quota_pool_setting.max_amount',
        value: String(parseQuotaFromDollars(values.maxAmount)),
      })
    }
    if (values.poolPeriodCap !== formDefaults.poolPeriodCap) {
      updates.push({
        key: 'quota_pool_setting.pool_period_cap',
        value: String(parseQuotaFromDollars(values.poolPeriodCap)),
      })
    }
    if (values.userPeriodCap !== formDefaults.userPeriodCap) {
      updates.push({
        key: 'quota_pool_setting.user_period_cap',
        value: String(parseQuotaFromDollars(values.userPeriodCap)),
      })
    }
    if (values.userPeriodCountLimit !== formDefaults.userPeriodCountLimit) {
      updates.push({
        key: 'quota_pool_setting.user_period_count_limit',
        value: String(values.userPeriodCountLimit),
      })
    }
    if (values.balanceMode !== formDefaults.balanceMode) {
      updates.push({
        key: 'quota_pool_setting.balance_mode',
        value: values.balanceMode,
      })
    }
    if (values.balanceLimit !== formDefaults.balanceLimit) {
      updates.push({
        key: 'quota_pool_setting.balance_limit',
        value: String(parseQuotaFromDollars(values.balanceLimit)),
      })
    }

    const newTimeRule = buildTimeRule(values)
    if (newTimeRule !== defaultValues.timeRule.trim()) {
      updates.push({
        key: 'quota_pool_setting.time_rule',
        value: newTimeRule,
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    form.reset(values)
  }

  const selectField = (
    field: { value: string; onChange: (v: string) => void },
    options: readonly { value: string; labelKey: string }[]
  ) => (
    <Select
      items={options.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
      value={field.value}
      onValueChange={(v) => {
        if (v !== null) field.onChange(v)
      }}
    >
      <FormControl>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
      </FormControl>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {t(o.labelKey)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )

  return (
    <SettingsSection title={t('Quota Pool Settings')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save quota pool settings'
          />

          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable Quota Pool')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Allow users to claim quota from the pool on the wallet page'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={updateOption.isPending || isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {enabled && (
            <>
              {/* 发放设置 */}
              <SettingsControlGroup>
                <GroupLabel>{t('Grant Settings')}</GroupLabel>
                <div className='grid gap-6 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='amountType'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Amount Type')}</FormLabel>
                        {selectField(field, AMOUNT_TYPE_OPTIONS)}
                        <FormDescription>
                          {t('Fixed amount or random amount within a range')}
                        </FormDescription>
                      </FormItem>
                    )}
                  />

                  {amountType === 'fixed' ? (
                    <FormField
                      control={form.control}
                      name='amount'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Claim Amount')}</FormLabel>
                          <FormControl>
                            <Input
                              type='number'
                              min={0}
                              step='any'
                              placeholder='0.00'
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            {t('Quota awarded on each claim')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <>
                      <FormField
                        control={form.control}
                        name='minAmount'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('Minimum Claim Amount')}</FormLabel>
                            <FormControl>
                              <Input
                                type='number'
                                min={0}
                                step='any'
                                placeholder='0.00'
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              {t('Lower bound of the random amount')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='maxAmount'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('Maximum Claim Amount')}</FormLabel>
                            <FormControl>
                              <Input
                                type='number'
                                min={0}
                                step='any'
                                placeholder='0.00'
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              {t('Upper bound of the random amount')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </div>
              </SettingsControlGroup>

              {/* 全站 / 单用户 并排分开 */}
              <div className='grid gap-4 lg:grid-cols-2'>
                <SettingsControlGroup>
                  <GroupLabel>{t('Global')}</GroupLabel>
                  <FormField
                    control={form.control}
                    name='poolPeriod'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Global Period')}</FormLabel>
                        {selectField(field, PERIOD_OPTIONS)}
                        <FormDescription>
                          {t(
                            'The global cap resets at the start of this period'
                          )}
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='poolPeriodCap'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Global Period Cap')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step='any'
                            placeholder='0.00'
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Maximum total quota issued to all users this period. 0 = unlimited'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </SettingsControlGroup>

                <SettingsControlGroup>
                  <GroupLabel>{t('Per-User')}</GroupLabel>
                  <FormField
                    control={form.control}
                    name='userPeriod'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('User Period')}</FormLabel>
                        {selectField(field, PERIOD_OPTIONS)}
                        <FormDescription>
                          {t(
                            'Per-user caps and claim counts reset at the start of this period'
                          )}
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='userPeriodCap'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('User Period Cap')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step='any'
                            placeholder='0.00'
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Maximum quota a single user can claim this period. 0 = unlimited'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='userPeriodCountLimit'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Claim Count Limit')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step={1}
                            placeholder='0'
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Maximum number of claims per user per period. 0 = unlimited'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </SettingsControlGroup>
              </div>

              {/* 领取条件 */}
              <SettingsControlGroup>
                <GroupLabel>{t('Claim Conditions')}</GroupLabel>

                <FormField
                  control={form.control}
                  name='balanceMode'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Balance Requirement')}</FormLabel>
                      {selectField(field, BALANCE_MODE_OPTIONS)}
                      <FormDescription>
                        {t(
                          'Only users whose balance meets this rule can claim'
                        )}
                      </FormDescription>
                    </FormItem>
                  )}
                />

                {balanceMode !== 'off' && (
                  <FormField
                    control={form.control}
                    name='balanceLimit'
                    render={({ field }) => (
                      <FormItem className='sm:max-w-xs'>
                        <FormLabel>{t('Balance Threshold')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step='any'
                            placeholder='0.00'
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name='timeEnabled'
                  render={({ field }) => (
                    <SettingsSwitchItem>
                      <SettingsSwitchContent>
                        <FormLabel>{t('Enable time restriction')}</FormLabel>
                        <FormDescription>
                          {t(
                            'Limit claims to specific weekdays and time periods'
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

                {timeEnabled && (
                  <div className='space-y-4'>
                    <FormItem>
                      <FormLabel>{t('Allowed weekdays')}</FormLabel>
                      <div className='flex flex-wrap gap-x-4 gap-y-2'>
                        {WEEKDAY_LABELS.map((label, idx) => (
                          <label
                            key={label}
                            className='flex cursor-pointer items-center gap-1.5'
                          >
                            <Checkbox
                              checked={selectedWeekdays.includes(idx)}
                              onCheckedChange={(checked) =>
                                toggleWeekday(idx, Boolean(checked))
                              }
                            />
                            <span className='text-sm'>{label}</span>
                          </label>
                        ))}
                      </div>
                      <FormDescription>
                        {t(
                          'Leave all unchecked to allow every day'
                        )}
                      </FormDescription>
                    </FormItem>

                    <FormItem>
                      <FormLabel>{t('Time periods')}</FormLabel>
                      <div className='space-y-2'>
                        {fields.map((field, index) => (
                          <div
                            key={field.id}
                            className='flex items-center gap-2'
                          >
                            <FormField
                              control={form.control}
                              name={`periods.${index}.start`}
                              render={({ field: startField }) => (
                                <FormItem className='flex-1'>
                                  <FormControl>
                                    <Input
                                      type='time'
                                      aria-label={t('Start time')}
                                      {...startField}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <span className='text-muted-foreground'>–</span>
                            <FormField
                              control={form.control}
                              name={`periods.${index}.end`}
                              render={({ field: endField }) => (
                                <FormItem className='flex-1'>
                                  <FormControl>
                                    <Input
                                      type='time'
                                      aria-label={t('End time')}
                                      {...endField}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              className='h-8 w-8 shrink-0'
                              onClick={() => remove(index)}
                              aria-label={t('Remove')}
                            >
                              <span className='text-lg leading-none'>×</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        className='mt-1'
                        onClick={() => append({ start: '', end: '' })}
                      >
                        {t('Add time period')}
                      </Button>
                      <FormDescription>
                        {t(
                          'Empty periods are ignored. A period spanning midnight uses start > end'
                        )}
                      </FormDescription>
                    </FormItem>

                    <FormField
                      control={form.control}
                      name='dates'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t('Specific dates (optional)')}
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              rows={2}
                              placeholder='2026-08-01, 2026-08-15'
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            {t(
                              'One date per line, empty = any date'
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </SettingsControlGroup>
            </>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
