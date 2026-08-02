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
import { CalendarClock, Plus, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
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
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'

import {
  createPlan,
  updatePlan,
  getGroups,
  getAdminPlans,
} from '../api'
import { getDurationUnitOptions, getResetPeriodOptions } from '../constants'
import {
  getPlanFormSchema,
  PLAN_FORM_DEFAULTS,
  planToFormValues,
  formValuesToPlanPayload,
  type PlanFormValues,
} from '../lib'
import type { PlanRecord } from '../types'
import { useSubscriptions } from './subscriptions-provider'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: PlanRecord
}

export function SubscriptionsMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: Props) {
  const { t } = useTranslation()
  const isEdit = !!currentRow?.plan?.id
  const { triggerRefresh } = useSubscriptions()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const currencyLabel = getCurrencyLabel()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [groupOptions, setGroupOptions] = useState<string[]>([])
  const [exclusiveGroupOptions, setExclusiveGroupOptions] = useState<string[]>([])
  const [newExclusiveGroup, setNewExclusiveGroup] = useState(false)
  const [newExclusiveGroupValue, setNewExclusiveGroupValue] = useState('')

  const schema = getPlanFormSchema(t)
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PlanFormValues>,
    defaultValues: PLAN_FORM_DEFAULTS,
  })

  useEffect(() => {
    if (open) {
      if (currentRow?.plan) {
        form.reset(planToFormValues(currentRow.plan))
      } else {
        form.reset(PLAN_FORM_DEFAULTS)
      }
      setNewExclusiveGroup(false)
      setNewExclusiveGroupValue('')
      getGroups()
        .then((res) => {
          if (res.success) setGroupOptions(res.data || [])
        })
        .catch(() => {})
      // Load existing exclusive groups so they can be picked instead of typed.
      getAdminPlans()
        .then((res) => {
          if (!res.success) return
          const groups = new Set<string>()
          for (const p of res.data || []) {
            const g = p?.plan?.exclusive_group
            if (g) groups.add(g)
          }
          setExclusiveGroupOptions([...groups])
        })
        .catch(() => {})
    }
  }, [open, currentRow, form])

  const durationUnit = form.watch('duration_unit')
  const resetPeriod = form.watch('quota_reset_period')

  const onSubmit = async (values: PlanFormValues) => {
    setIsSubmitting(true)
    try {
      const payload = formValuesToPlanPayload(values)
      if (isEdit && currentRow?.plan?.id) {
        const res = await updatePlan(currentRow.plan.id, payload)
        if (res.success) {
          toast.success(t('Update succeeded'))
          onOpenChange(false)
          triggerRefresh()
        }
      } else {
        const res = await createPlan(payload)
        if (res.success) {
          toast.success(t('Create succeeded'))
          onOpenChange(false)
          triggerRefresh()
        }
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const durationUnitOpts = getDurationUnitOptions(t)
  const resetPeriodOpts = getResetPeriodOptions(t)

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          form.reset()
        }
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[600px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isEdit ? t('Update plan info') : t('Create new subscription plan')}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? t('Modify existing subscription plan configuration')
              : t(
                  'Fill in the following info to create a new subscription plan'
                )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='subscription-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className={sideDrawerFormClassName()}
          >
            {/* Basic Info */}
            <SideDrawerSection>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='info' size='xs'>
                  <Settings2 />
                </IconBadge>
                {t('Basic Info')}
              </h3>

              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Plan Title')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('e.g. Basic Plan')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='subtitle'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Plan Subtitle')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t('e.g. Suitable for light usage')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='price_amount'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Plan Price')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          step='0.01'
                          min={0}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Amount the user pays to purchase this plan; the actual currency depends on the payment gateway.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='total_amount'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Quota ({{currency}})', { currency: currencyLabel })}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          step={tokensOnly ? 1 : 0.01}
                          placeholder={
                            tokensOnly
                              ? t('Enter quota in tokens')
                              : t('Enter quota in {{currency}}', {
                                  currency: currencyLabel,
                                })
                          }
                          onChange={(e) =>
                            field.onChange(
                              Number.parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Total quota included in the plan, usable per billing period. 0 means unlimited.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='upgrade_group'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Upgrade Group')}</FormLabel>
                      <Select
                        items={[
                          { value: '__none__', label: t('No Upgrade') },
                          ...groupOptions.map((g) => ({ value: g, label: g })),
                        ]}
                        onValueChange={(v) =>
                          field.onChange(v === '__none__' ? '' : v)
                        }
                        value={field.value || ''}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('No Upgrade')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            <SelectItem value='__none__'>
                              {t('No Upgrade')}
                            </SelectItem>
                            {groupOptions.map((g) => (
                              <SelectItem key={g} value={g}>
                                {g}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='downgrade_group'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Downgrade Group')}</FormLabel>
                      <Select
                        items={[
                          {
                            value: '__none__',
                            label: t('Downgrade to pre-purchase group'),
                          },
                          ...groupOptions.map((g) => ({ value: g, label: g })),
                        ]}
                        onValueChange={(v) =>
                          field.onChange(v === '__none__' ? '' : v)
                        }
                        value={field.value || ''}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t('Downgrade to pre-purchase group')}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            <SelectItem value='__none__'>
                              {t('Downgrade to pre-purchase group')}
                            </SelectItem>
                            {groupOptions.map((g) => (
                              <SelectItem key={g} value={g}>
                                {g}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {t(
                          'Downgrade to this group after the subscription expires'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='max_purchase_per_user'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Purchase Limit')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t('0 means unlimited')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name='sort_order'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Sort Order')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='number'
                        onChange={(e) =>
                          field.onChange(
                            Number.parseInt(e.target.value, 10) || 0
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='priority'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Plan Tier')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='number'
                        onChange={(e) =>
                          field.onChange(
                            Number.parseInt(e.target.value, 10) || 0
                          )
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Tier within the mutual-exclusion group, higher is a higher tier. Used to decide upgrade/downgrade direction.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='flex flex-col gap-3'>
                <FormField
                  control={form.control}
                  name='enabled'
                  render={({ field }) => (
                    <FormItem className={sideDrawerSwitchItemClassName()}>
                      <FormLabel className='!mt-0'>
                        {t('Enabled Status')}
                      </FormLabel>
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
                  name='is_recommended'
                  render={({ field }) => (
                    <FormItem className={sideDrawerSwitchItemClassName()}>
                      <FormLabel className='!mt-0'>
                        {t('Recommended')}
                      </FormLabel>
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
                  name='allow_balance_pay'
                  render={({ field }) => (
                    <FormItem className={sideDrawerSwitchItemClassName()}>
                      <FormLabel className='!mt-0'>
                        {t('Allow balance redemption')}
                      </FormLabel>
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
                  name='allow_wallet_overflow'
                  render={({ field }) => (
                    <FormItem className={sideDrawerSwitchItemClassName()}>
                      <FormLabel className='!mt-0'>
                        {t('Allow wallet balance after quota used up')}
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </SideDrawerSection>

            {/* Duration Settings */}
            <SideDrawerSection>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='chart-4' size='xs'>
                  <CalendarClock />
                </IconBadge>
                {t('Duration Settings')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='duration_unit'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Duration Unit')}</FormLabel>
                      <Select
                        items={durationUnitOpts.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {durationUnitOpts.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {durationUnit === 'custom' ? (
                  <FormField
                    control={form.control}
                    name='custom_seconds'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Custom Seconds')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={1}
                            onChange={(e) =>
                              field.onChange(
                                Number.parseInt(e.target.value, 10) || 0
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name='duration_value'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Duration Value')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={1}
                            onChange={(e) =>
                              field.onChange(
                                Number.parseInt(e.target.value, 10) || 0
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </SideDrawerSection>

            {/* Quota Reset */}
            <SideDrawerSection>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='success' size='xs'>
                  <RefreshCw />
                </IconBadge>
                {t('Quota Reset')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='quota_reset_period'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Reset Cycle')}</FormLabel>
                      <Select
                        items={resetPeriodOpts.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {resetPeriodOpts.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='quota_reset_custom_seconds'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Custom Seconds')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          disabled={resetPeriod !== 'custom'}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name='reset_amount_limit'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Per-Cycle Quota Limit ({{currency}})', {
                        currency: currencyLabel,
                      })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='number'
                        min={0}
                        step={tokensOnly ? 1 : 0.01}
                        placeholder={
                          tokensOnly
                            ? t('Enter quota in tokens')
                            : t('Enter quota in {{currency}}', {
                                currency: currencyLabel,
                              })
                        }
                        onChange={(e) =>
                          field.onChange(
                            Number.parseFloat(e.target.value) || 0
                          )
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Max quota usable within each reset cycle, separate from the total quota. 0 means no per-cycle cap. Requires a reset cycle to take effect.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='weekly_amount_limit'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Weekly Quota Limit ({{currency}})', {
                          currency: currencyLabel,
                        })}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          step={tokensOnly ? 1 : 0.01}
                          placeholder={
                            tokensOnly
                              ? t('Enter quota in tokens')
                              : t('Enter quota in {{currency}}', {
                                  currency: currencyLabel,
                                })
                          }
                          onChange={(e) =>
                            field.onChange(
                              Number.parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Calendar week cap (resets every Monday). Works alongside the monthly cap. 0 means no weekly cap.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='monthly_amount_limit'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Monthly Quota Limit ({{currency}})', {
                          currency: currencyLabel,
                        })}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          step={tokensOnly ? 1 : 0.01}
                          placeholder={
                            tokensOnly
                              ? t('Enter quota in tokens')
                              : t('Enter quota in {{currency}}', {
                                  currency: currencyLabel,
                                })
                          }
                          onChange={(e) =>
                            field.onChange(
                              Number.parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Calendar month cap (resets on the 1st). Works alongside the weekly cap. 0 means no monthly cap.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='max_cumulative_days'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Max Cumulative Duration (days)')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'The total remaining time cannot exceed this after renewal. Prevents stacking time indefinitely. 0 means unlimited.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SideDrawerSection>

            {/* Plan Strategy */}
            <SideDrawerSection>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='chart-4' size='xs'>
                  <Settings2 />
                </IconBadge>
                {t('Plan Strategy')}
              </h3>

              <FormField
                control={form.control}
                name='exclusive_group'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Plan Exclusive Group')}</FormLabel>
                    {newExclusiveGroup ? (
                      <div className='flex items-center gap-2'>
                        <FormControl>
                          <Input
                            autoFocus
                            value={newExclusiveGroupValue}
                            onChange={(e) =>
                              setNewExclusiveGroupValue(e.target.value)
                            }
                            placeholder={t('Enter a new exclusive group name')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                field.onChange(newExclusiveGroupValue.trim())
                                setNewExclusiveGroup(false)
                                setNewExclusiveGroupValue('')
                              }
                            }}
                          />
                        </FormControl>
                        <Button
                          type='button'
                          size='sm'
                          onClick={() => {
                            field.onChange(newExclusiveGroupValue.trim())
                            setNewExclusiveGroup(false)
                            setNewExclusiveGroupValue('')
                          }}
                        >
                          {t('Confirm')}
                        </Button>
                      </div>
                    ) : (
                      <div className='flex items-center gap-2'>
                        <div className='flex-1'>
                          <Select
                            items={[
                              {
                                value: '__none__',
                                label: t('No exclusive group'),
                              },
                              ...exclusiveGroupOptions.map((g) => ({
                                value: g,
                                label: g,
                              })),
                            ]}
                            value={field.value || '__none__'}
                            onValueChange={(v) => {
                              if (v === '__none__' || v == null) {
                                field.onChange('')
                              } else {
                                field.onChange(v)
                              }
                            }}
                          >
                            <FormControl>
                              <SelectTrigger className='w-full'>
                                <SelectValue
                                  placeholder={t('No exclusive group')}
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                <SelectItem value='__none__'>
                                  {t('No exclusive group')}
                                </SelectItem>
                                {exclusiveGroupOptions.map((g) => (
                                  <SelectItem key={g} value={g}>
                                    {g}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type='button'
                          variant='outline'
                          size='icon'
                          className='shrink-0'
                          onClick={() => setNewExclusiveGroup(true)}
                          title={t('Create new group...')}
                        >
                          <Plus className='size-4' />
                        </Button>
                      </div>
                    )}
                    <FormDescription>
                      {t(
                        'Mutual exclusion: plans in the same group cannot be held at the same time. Buying another plan in the group triggers a prorated upgrade/downgrade switch. Different from the purchase-gate group below.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='allowed_groups'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Allowed Subscription Groups')}</FormLabel>
                    <FormControl>
                      <div className='flex max-h-40 flex-wrap gap-x-4 gap-y-2 overflow-y-auto rounded-md border p-2.5'>
                        {groupOptions.length === 0 ? (
                          <span className='text-muted-foreground text-xs'>
                            {t('No groups available')}
                          </span>
                        ) : (
                          groupOptions.map((g) => {
                            const checked = (field.value || []).includes(g)
                            return (
                              <label
                                key={g}
                                className='flex cursor-pointer items-center gap-1.5 text-sm'
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) => {
                                    const cur = field.value || []
                                    field.onChange(
                                      v
                                        ? [...cur, g]
                                        : cur.filter((x) => x !== g)
                                    )
                                  }}
                                />
                                <span>{g}</span>
                              </label>
                            )
                          })
                        )}
                      </div>
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Purchase gate: only users in the selected groups can subscribe to this plan. Leave empty to allow all groups.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='subscription-form'
            type='submit'
            disabled={isSubmitting}
          >
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
