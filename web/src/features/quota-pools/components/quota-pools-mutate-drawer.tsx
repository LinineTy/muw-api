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

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'

import { createQuotaPool, updateQuotaPool } from '../api'
import {
  ERROR_MESSAGES,
  QUOTA_POOL_AMOUNT_TYPE_OPTIONS,
  QUOTA_POOL_BALANCE_MODE_OPTIONS,
  QUOTA_POOL_PERIOD_OPTIONS,
  SUCCESS_MESSAGES,
} from '../constants'
import {
  QUOTA_POOL_FORM_DEFAULT_VALUES,
  getQuotaPoolFormSchema,
  transformFormDataToPayload,
  transformQuotaPoolToFormDefaults,
  type QuotaPoolFormValues,
} from '../lib/quota-pool-form'
import type { QuotaPool } from '../types'
import { useQuotaPools } from './quota-pools-provider'

type QuotaPoolsMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: QuotaPool
}

export function QuotaPoolsMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: QuotaPoolsMutateDrawerProps) {
  const { t } = useTranslation()
  const isUpdate = !!currentRow
  const { triggerRefresh } = useQuotaPools()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<QuotaPoolFormValues>({
    resolver: zodResolver(getQuotaPoolFormSchema(t)),
    defaultValues: QUOTA_POOL_FORM_DEFAULT_VALUES,
  })

  const amountType = form.watch('amount_type')

  useEffect(() => {
    if (open && isUpdate && currentRow) {
      form.reset(transformQuotaPoolToFormDefaults(currentRow))
    } else if (open && !isUpdate) {
      form.reset(QUOTA_POOL_FORM_DEFAULT_VALUES)
    }
  }, [open, isUpdate, currentRow, form])

  const onSubmit = async (data: QuotaPoolFormValues) => {
    setIsSubmitting(true)
    try {
      const payload = transformFormDataToPayload(data)

      if (isUpdate && currentRow) {
        const result = await updateQuotaPool(currentRow.id, payload)
        if (result.success) {
          toast.success(t(SUCCESS_MESSAGES.QUOTA_POOL_UPDATED))
          onOpenChange(false)
          triggerRefresh()
        } else {
          toast.error(result.message || t(ERROR_MESSAGES.UPDATE_FAILED))
        }
      } else {
        const result = await createQuotaPool(payload)
        if (result.success) {
          toast.success(t(SUCCESS_MESSAGES.QUOTA_POOL_CREATED))
          onOpenChange(false)
          triggerRefresh()
        } else {
          toast.error(result.message || t(ERROR_MESSAGES.CREATE_FAILED))
        }
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('w-full sm:max-w-lg')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Edit Quota Pool') : t('Create Quota Pool')}
          </SheetTitle>
          <SheetDescription>
            {t('Configure the pool grant amount and claiming rules.')}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            id='quota-pool-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className={sideDrawerFormClassName()}
          >
            <SideDrawerSection>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Name')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Description')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='enabled'
                render={({ field }) => (
                  <FormItem className='flex items-center justify-between'>
                    <FormLabel>{t('Enabled')}</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </SideDrawerSection>

            <SideDrawerSection>
              <FormField
                control={form.control}
                name='period'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Period')}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(QUOTA_POOL_PERIOD_OPTIONS).map(
                            (opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t('Caps and limits reset each period.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='amount_type'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Amount Type')}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(QUOTA_POOL_AMOUNT_TYPE_OPTIONS).map(
                            (opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {amountType === 'fixed' ? (
                <FormField
                  control={form.control}
                  name='amount_dollars'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Amount')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          step='any'
                          {...field}
                          onChange={(e) =>
                            field.onChange(Number(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name='min_dollars'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Min Amount')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step='any'
                            {...field}
                            onChange={(e) =>
                              field.onChange(Number(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='max_dollars'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Max Amount')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step='any'
                            {...field}
                            onChange={(e) =>
                              field.onChange(Number(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </SideDrawerSection>

            <SideDrawerSection>
              <FormField
                control={form.control}
                name='pool_period_cap_dollars'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Pool Period Cap')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='any'
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Total quota all users can claim this period. 0 = unlimited')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='user_period_cap_dollars'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('User Period Cap')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='any'
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Total quota one user can claim this period. 0 = unlimited')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='user_period_count_limit'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Claim Count Limit')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Times one user can claim this period. 0 = unlimited')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='balance_mode'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Balance Rule')}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(QUOTA_POOL_BALANCE_MODE_OPTIONS).map(
                            (opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='balance_limit_dollars'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Balance Limit')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='any'
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Threshold used by the balance rule.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='time_rule'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Time Rule')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder='[{ "dates": ["2026-08-01"], "weekdays": [1,2,3,4,5], "periods": [{ "start": "09:00", "end": "18:00" }] }]'
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Whitelist windows as JSON: dates (YYYY-MM-DD), weekdays (0=Sun..6=Sat), periods (HH:MM). Empty = no restriction.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>

            <SheetFooter className={sideDrawerFooterClassName()}>
              <SheetClose render={<Button variant='outline' />}>
                {t('Cancel')}
              </SheetClose>
              <Button
                form='quota-pool-form'
                type='submit'
                disabled={isSubmitting}
              >
                {isSubmitting ? t('Saving...') : t('Save')}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
