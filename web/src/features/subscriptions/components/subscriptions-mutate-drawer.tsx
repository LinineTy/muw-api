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
import { CalendarClock, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'

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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'

import {
  createPlan,
  updatePlan,
  getGroups,
  getAdminPlans,
  adminSaveGroupPinProduct,
} from '../api'
import { getDurationUnitOptions } from '../constants'
import {
  getPlanFormSchema,
  PLAN_FORM_DEFAULTS,
  planToFormValues,
  formValuesToPlanPayload,
  groupPinToFormValues,
  planValuesToGroupPinPayload,
  planValiditySeconds,
  resetWindowsRawEqual,
  windowRowDurationSeconds,
  type PlanFormValues,
  type ResetWindowFormRow,
} from '../lib'
import type { PlanKind, PlanRecord } from '../types'
import { useSubscriptions } from './subscriptions-provider'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: PlanRecord
  /** 新建对象的类型（套餐 / 固定分组商品）；编辑时以 currentRow.kind 为准。 */
  createKind?: PlanKind
}

/**
 * 订阅套餐与固定分组商品的唯一配置抽屉。两者共用同一套表单控件与校验，
 * 由 kind 决定字段显隐与提交去向 —— 不再有两套表单/类型切换 Tabs。
 */
export function SubscriptionsMutateDrawer({
  open,
  onOpenChange,
  currentRow,
  createKind = 'plan',
}: Props) {
  const { t } = useTranslation()
  const { triggerRefresh } = useSubscriptions()
  const kind: PlanKind = currentRow?.kind ?? createKind
  const isGroupPin = kind === 'group_pin'
  const isEdit = !!currentRow?.plan?.id
  const { meta: currencyMeta } = getCurrencyDisplay()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const currencyLabel = getCurrencyLabel()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [groupOptions, setGroupOptions] = useState<string[]>([])
  const [exclusiveGroupOptions, setExclusiveGroupOptions] = useState<string[]>([])
  const [newExclusiveGroup, setNewExclusiveGroup] = useState(false)
  const [newExclusiveGroupValue, setNewExclusiveGroupValue] = useState('')

  const schema = getPlanFormSchema(t, kind)
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PlanFormValues>,
    defaultValues: PLAN_FORM_DEFAULTS,
  })

  useEffect(() => {
    if (!open) return
    if (currentRow?.kind === 'group_pin' && currentRow.groupPin) {
      form.reset(groupPinToFormValues(currentRow.groupPin))
    } else if (currentRow?.plan) {
      form.reset(planToFormValues(currentRow.plan))
    } else {
      form.reset(PLAN_FORM_DEFAULTS)
    }
    // resolver 随 kind 变化，RHF 不会自动清掉上一类型的报错。
    form.clearErrors()
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
  }, [open, currentRow, form])

  const durationUnit = form.watch('duration_unit')
  const resetWindows = form.watch('reset_windows')

  // 严格递增校验的违规行索引（用于红色高亮与错误提示）。
  const windowOrderBad = (() => {
    const bad = new Set<number>()
    let prev = -1
    for (const [i, row] of (resetWindows || []).entries()) {
      const secs = windowRowDurationSeconds(row)
      if (i > 0 && secs <= prev) bad.add(i)
      prev = secs
    }
    return bad
  })()

  // "改动即重置"：编辑模式且窗口列表有变化时，保存前弹确认。
  const originalWindowsRaw = currentRow?.plan?.reset_windows || ''
  const [confirmResetSave, setConfirmResetSave] = useState(false)
  const [pendingSubmit, setPendingSubmit] = useState<PlanFormValues | null>(null)

  const windowUnitOpts = [
    { value: 'hour', label: t('Hours') },
    { value: 'day', label: t('Days') },
    { value: 'week', label: t('Weeks') },
    { value: 'month', label: t('Months') },
  ]

  const addWindow = () => {
    const rows = form.getValues('reset_windows') || []
    // id 为表单内稳定行 key，编辑期间不变，避免"每次按键重挂载导致输入框失焦"。
    form.setValue(
      'reset_windows',
      [...rows, { id: nanoid(), unit: 'day', value: 1, limit: 0 }],
      { shouldValidate: true }
    )
  }

  const updateWindow = (index: number, patch: Partial<ResetWindowFormRow>) => {
    const rows = [...(form.getValues('reset_windows') || [])]
    rows[index] = { ...rows[index], ...patch }
    form.setValue('reset_windows', rows, { shouldValidate: true })
  }

  const removeWindow = (index: number) => {
    const rows = form.getValues('reset_windows') || []
    form.setValue('reset_windows', rows.filter((_, i) => i !== index), {
      shouldValidate: true,
    })
  }

  const submitGroupPin = async (values: PlanFormValues) => {
    setIsSubmitting(true)
    try {
      const res = await adminSaveGroupPinProduct(
        planValuesToGroupPinPayload(values, currentRow?.plan.id)
      )
      if (res.success) {
        toast.success(isEdit ? t('Update succeeded') : t('Create succeeded'))
        onOpenChange(false)
        triggerRefresh()
      } else {
        toast.error(res.message || t('Request failed'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const doSubmit = async (values: PlanFormValues) => {
    // 动态窗口是唯一额度模型：不允许空列表（全部额度 0 = 无限额度，仍须至少一个窗口）。
    if (!values.reset_windows || values.reset_windows.length === 0) {
      toast.error(
        t('At least one window is required in the dynamic window model.')
      )
      return
    }
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

  const onSubmit = async (values: PlanFormValues) => {
    // 固定分组商品没有额度窗口，也就没有"改动即重置"确认。
    if (isGroupPin) {
      await submitGroupPin(values)
      return
    }
    // 编辑模式且窗口列表有变化 → 先弹"改动即重置"确认（后端会重置该套餐全部活跃
    // 订阅的窗口计数）。判等用语义比较（resetWindowsRawEqual），键序/浮点往返差异
    // 不算变化。
    if (isEdit) {
      const payload = formValuesToPlanPayload(values)
      const newRaw = payload.plan.reset_windows || ''
      const windowsChanged = !resetWindowsRawEqual(newRaw, originalWindowsRaw)
      if (windowsChanged) {
        setPendingSubmit(values)
        setConfirmResetSave(true)
        return
      }
    }
    await doSubmit(values)
  }

  // zod 对 reset_windows 的 superRefine（全 0 额度 / 非严格递增）在自定义窗口编辑器上
  // 没有可挂靠的 FormMessage，handleSubmit 静默拦截提交会"点了没反应"——这里把该字段
  // 的校验错误以 toast 显式反馈。
  const onInvalid = (errors: FieldErrors<PlanFormValues>) => {
    const message = errors.reset_windows?.message ?? errors.upgrade_group?.message
    if (message) {
      toast.error(String(message))
    }
  }

  const durationUnitOpts = getDurationUnitOptions(t)

  let sheetTitle = isEdit ? t('Update plan info') : t('Create new subscription plan')
  let sheetDescription = isEdit
    ? t('Modify existing subscription plan configuration')
    : t('Fill in the following info to create a new subscription plan')
  if (isGroupPin) {
    sheetTitle = isEdit
      ? t('Update fixed group product')
      : t('Create fixed group product')
    sheetDescription = t(
      'Fixed group products: one-time purchase pins the user to the group permanently'
    )
  }

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
          <SheetTitle>{sheetTitle}</SheetTitle>
          <SheetDescription>{sheetDescription}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='subscription-form'
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
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
              </div>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='upgrade_group'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {isGroupPin ? t('Pinned Group') : t('Upgrade Group')}
                      </FormLabel>
                      <Select
                        items={[
                          ...(isGroupPin
                            ? []
                            : [{ value: '__none__', label: t('No Upgrade') }]),
                          ...groupOptions.map((g) => ({ value: g, label: g })),
                          // 历史配置的目标组可能已从分组倍率里删掉，补一项保证可回显。
                          ...(field.value &&
                          !groupOptions.includes(field.value) &&
                          field.value !== '__none__'
                            ? [{ value: field.value, label: field.value }]
                            : []),
                        ]}
                        onValueChange={(v) =>
                          field.onChange(v === '__none__' ? '' : v)
                        }
                        value={field.value || ''}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                isGroupPin
                                  ? t('Please select a group')
                                  : t('No Upgrade')
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {!isGroupPin && (
                              <SelectItem value='__none__'>
                                {t('No Upgrade')}
                              </SelectItem>
                            )}
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

                {!isGroupPin && (
                  <>
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
                              ...groupOptions.map((g) => ({
                                value: g,
                                label: g,
                              })),
                            ]}
                            onValueChange={(v) =>
                              field.onChange(v === '__none__' ? '' : v)
                            }
                            value={field.value || ''}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t(
                                    'Downgrade to pre-purchase group'
                                  )}
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
                  </>
                )}
              </div>

              {!isGroupPin && (
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
              )}

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

                {!isGroupPin && (
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
                )}
              </div>
            </SideDrawerSection>

            {/* Duration Settings：固定分组商品无时长概念 */}
            {!isGroupPin && (
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
            )}

            {/* Quota Reset：固定分组商品无额度 */}
            {!isGroupPin && (
              <SideDrawerSection>
                <h3 className='flex items-center gap-2 text-sm font-medium'>
                  <IconBadge tone='success' size='xs'>
                    <RefreshCw />
                  </IconBadge>
                  {t('Quota Reset')}
                </h3>

                {/* 续费时间上限：与额度模型无关，两种模型都可用 */}
                <FormField
                  control={form.control}
                  name='max_cumulative_days'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Max Cumulative Duration (days)')}
                      </FormLabel>
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

                <TooltipProvider delay={100}>
                  <div className='space-y-2'>
                    {(resetWindows || []).map((row, index) => {
                      const isCap =
                        windowRowDurationSeconds(row) >
                        planValiditySeconds(form.getValues())
                      return (
                        <div key={row.id} className='space-y-1'>
                          <div className='grid grid-cols-[minmax(0,80px)_minmax(0,64px)_minmax(0,1fr)_auto] items-center gap-2'>
                            <Tooltip>
                              <TooltipTrigger render={<div className='min-w-0' />}>
                                <Select
                                  items={windowUnitOpts}
                                  value={row.unit}
                                  onValueChange={(v) =>
                                    v !== null &&
                                    updateWindow(index, {
                                      unit: v as ResetWindowFormRow['unit'],
                                    })
                                  }
                                >
                                  <SelectTrigger className='w-full'>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent alignItemWithTrigger={false}>
                                    <SelectGroup>
                                      {windowUnitOpts.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                          {o.label}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t(
                                  'Window period unit. E.g. hour / day / week / month.'
                                )}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={<div className='min-w-0' />}>
                                <Input
                                  type='number'
                                  min={1}
                                  value={row.value}
                                  aria-invalid={windowOrderBad.has(index)}
                                  onChange={(e) =>
                                    updateWindow(index, {
                                      value:
                                        Number.parseInt(e.target.value, 10) ||
                                        1,
                                    })
                                  }
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {t(
                                  'How many units the window spans before refreshing. E.g. 5 hours = refreshes every 5 hours.'
                                )}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={<div className='min-w-0' />}>
                                <Input
                                  type='number'
                                  min={0}
                                  step={tokensOnly ? 1 : 0.01}
                                  value={row.limit}
                                  placeholder={
                                    tokensOnly
                                      ? t('Enter quota in tokens')
                                      : t('Enter quota in {{currency}}', {
                                          currency: currencyLabel,
                                        })
                                  }
                                  onChange={(e) =>
                                    updateWindow(index, {
                                      limit:
                                        Number.parseFloat(e.target.value) || 0,
                                    })
                                  }
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {t(
                                  'Quota usable inside this window; refreshes at each window boundary. 0 means no cap for this window.'
                                )}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={<div />}>
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon-sm'
                                  className='text-destructive hover:text-destructive'
                                  onClick={() => removeWindow(index)}
                                  aria-label={t('Delete')}
                                >
                                  <Trash2 />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('Delete')}</TooltipContent>
                            </Tooltip>
                          </div>
                          {isCap && (
                            <span className='text-amber-700 dark:text-amber-300 text-xs'>
                              {t(
                                'Covers the whole validity · acts as the subscription total cap'
                              )}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {windowOrderBad.size > 0 && (
                    <p className='text-destructive text-xs'>
                      {t(
                        'Windows must be ordered by duration: each window must be strictly longer than the previous one.'
                      )}
                    </p>
                  )}
                  <Tooltip>
                    <TooltipTrigger render={<div className='w-fit' />}>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={addWindow}
                      >
                        <Plus className='size-3.5' />
                        {t('Add window')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t(
                        'Add a new window. Each window caps its own quota independently.'
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {resetWindows.length > 0 &&
                  resetWindows.every((w) => Number(w.limit || 0) <= 0) && (
                    <p className='text-emerald-700 dark:text-emerald-300 text-xs'>
                      {t(
                        'All windows have zero quota: this plan is unlimited until it expires.'
                      )}
                    </p>
                  )}
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Renewal only extends time; each window refreshes on its own schedule.'
                  )}
                </p>
              </SideDrawerSection>
            )}

            {/* Plan Strategy */}
            <SideDrawerSection>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='chart-4' size='xs'>
                  <Settings2 />
                </IconBadge>
                {t('Plan Strategy')}
              </h3>

              {!isGroupPin && (
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
                                  field.onChange(
                                    newExclusiveGroupValue.trim()
                                  )
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
              )}

              <FormField
                control={form.control}
                name='allowed_groups'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isGroupPin
                        ? t('Allowed Groups')
                        : t('Allowed Subscription Groups')}
                    </FormLabel>
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

      <ConfirmDialog
        open={confirmResetSave}
        onOpenChange={(v) => {
          setConfirmResetSave(v)
          if (!v) setPendingSubmit(null)
        }}
        title={t('Reset active subscription quotas?')}
        desc={t(
          'Saving these quota changes will reset the quotas of all active subscriptions under this plan (usage counters restart from zero). Continue?'
        )}
        confirmText={t('Save & reset')}
        isLoading={isSubmitting}
        handleConfirm={async () => {
          if (pendingSubmit) await doSubmit(pendingSubmit)
          setConfirmResetSave(false)
          setPendingSubmit(null)
        }}
      />
    </Sheet>
  )
}
