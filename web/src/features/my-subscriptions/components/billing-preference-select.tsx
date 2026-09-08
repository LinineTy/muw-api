// @muw-owned
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateBillingPreference } from '@/features/subscriptions/api'

import { useMySubscriptions } from './my-subscriptions-provider'
import { getBillingPreferenceLabel } from '../lib/helpers'

export function BillingPreferenceSelect() {
  const { t } = useTranslation()
  const { selfData } = useMySubscriptions()
  const [preference, setPreference] = useState(
    selfData?.billing_preference || 'subscription_first'
  )

  // Keep local state in sync once the server value loads / refreshes.
  useEffect(() => {
    if (selfData?.billing_preference) {
      setPreference(selfData.billing_preference)
    }
  }, [selfData?.billing_preference])

  const activeCount = selfData?.subscriptions?.length || 0
  const disablePref = activeCount <= 0
  const isSubPref =
    preference === 'subscription_first' || preference === 'subscription_only'
  const displayPref = disablePref && isSubPref ? 'wallet_first' : preference

  const handlePreferenceChange = async (pref: string) => {
    if (pref === null) return
    const previous = preference
    setPreference(pref)
    try {
      const res = await updateBillingPreference(pref)
      if (res.success) {
        toast.success(t('Updated successfully'))
        const normalized = res.data?.billing_preference || pref
        setPreference(normalized)
      } else {
        toast.error(res.message || t('Update failed'))
        setPreference(previous)
      }
    } catch {
      toast.error(t('Request failed'))
      setPreference(previous)
    }
  }

  const prefOptions = [
    { value: 'subscription_first', disabled: disablePref },
    { value: 'wallet_first', disabled: false },
    { value: 'subscription_only', disabled: disablePref },
    { value: 'wallet_only', disabled: false },
  ]

  return (
    <Select
      items={prefOptions.map((opt) => ({
        value: opt.value,
        label: (
          <>
            {getBillingPreferenceLabel(opt.value, t)}
            {opt.disabled ? ` (${t('No Active')})` : ''}
          </>
        ),
      }))}
      value={displayPref}
      onValueChange={(v) => v !== null && handlePreferenceChange(v)}
    >
      <SelectTrigger className='h-8 flex-1 text-xs sm:w-[140px] sm:flex-none'>
        <SelectValue>
          {getBillingPreferenceLabel(displayPref, t)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {prefOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
              {getBillingPreferenceLabel(opt.value, t)}
              {opt.disabled ? ` (${t('No Active')})` : ''}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
