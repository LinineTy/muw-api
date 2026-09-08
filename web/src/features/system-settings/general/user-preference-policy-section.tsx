// @muw-owned
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useUpdateOption } from '../hooks/use-update-option'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'

type PreferencePolicy = {
  force_on: string[]
  locked: string[]
}

type PreferenceEntry = {
  key: string
  label: string
  description: string
}

const PREFERENCE_ENTRIES: PreferenceEntry[] = [
  {
    key: 'accept_unset_model_ratio_model',
    label: 'Accept Unpriced Models',
    description: 'Allow using models without price configuration',
  },
  {
    key: 'record_ip_log',
    label: 'Record IP Address',
    description: 'Log IP address for usage and error logs',
  },
  {
    key: 'upstream_model_update_notify_enabled',
    label: 'Receive Upstream Model Update Notifications',
    description:
      'Only available for admins. Receive a summary notification when the scheduled model check detects upstream changes.',
  },
]

function parsePolicy(raw: string): PreferencePolicy {
  try {
    const parsed = JSON.parse(raw || '{}') as PreferencePolicy
    return {
      force_on: Array.isArray(parsed.force_on) ? parsed.force_on : [],
      locked: Array.isArray(parsed.locked) ? parsed.locked : [],
    }
  } catch {
    return { force_on: [], locked: [] }
  }
}

type PolicyFlags = Record<string, { forceOn: boolean; locked: boolean }>

function toFlags(policy: PreferencePolicy): PolicyFlags {
  const flags: PolicyFlags = {}
  for (const entry of PREFERENCE_ENTRIES) {
    flags[entry.key] = {
      forceOn: policy.force_on.includes(entry.key),
      locked: policy.locked.includes(entry.key),
    }
  }
  return flags
}

function toPolicy(flags: PolicyFlags): PreferencePolicy {
  const forceOn: string[] = []
  const locked: string[] = []
  for (const entry of PREFERENCE_ENTRIES) {
    if (flags[entry.key]?.forceOn) forceOn.push(entry.key)
    if (flags[entry.key]?.locked) locked.push(entry.key)
  }
  return { force_on: forceOn, locked }
}

export function UserPreferencePolicySection({
  defaultValues,
}: {
  defaultValues: { UserPreferencePolicy: string }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [flags, setFlags] = useState<PolicyFlags>(() =>
    toFlags(parsePolicy(defaultValues.UserPreferencePolicy))
  )

  // Sync when the settings page pushes fresh defaults (e.g. after navigation).
  useEffect(() => {
    setFlags(toFlags(parsePolicy(defaultValues.UserPreferencePolicy)))
  }, [defaultValues.UserPreferencePolicy])

  const toggle = useCallback(
    (key: string, field: 'forceOn' | 'locked', value: boolean) => {
      setFlags((prev) => ({
        ...prev,
        [key]: { ...prev[key], [field]: value },
      }))
    },
    []
  )

  const handleSave = async () => {
    const policy = toPolicy(flags)
    const json = JSON.stringify(policy)
    try {
      await updateOption.mutateAsync({
        key: 'UserPreferencePolicy',
        value: json,
      })
      toast.success(t('Settings updated successfully'))
    } catch {
      toast.error(t('Failed to update settings'))
    }
  }

  const prefTitle = useMemo(
    () => (key: string) => {
      const entry = PREFERENCE_ENTRIES.find((e) => e.key === key)
      return entry ? t(entry.label) : key
    },
    [t]
  )
  const prefDesc = useMemo(
    () => (key: string) => {
      const entry = PREFERENCE_ENTRIES.find((e) => e.key === key)
      return entry ? t(entry.description) : ''
    },
    [t]
  )

  return (
    <SettingsSection title={t('User Preference Policy')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Control which profile preference switches are force-enabled or locked for all users.'
        )}
      </p>
      <div className='min-w-0 space-y-3'>
        <div className='bg-muted/20 rounded-xl border px-3 py-2.5'>
          <div className='flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground'>
            <span>{t('Preference')}</span>
            <div className='flex items-center gap-6 pr-1'>
              <span>{t('Force Enable')}</span>
              <span>{t('Lock from User Changes')}</span>
            </div>
          </div>
        </div>

        {PREFERENCE_ENTRIES.map((entry) => {
          const state = flags[entry.key] ?? { forceOn: false, locked: false }
          return (
            <div
              key={entry.key}
              className='bg-muted/20 flex items-center justify-between gap-4 rounded-xl border px-4 py-3'
            >
              <div className='min-w-0 space-y-0.5'>
                <Label className='text-sm font-medium'>
                  {prefTitle(entry.key)}
                </Label>
                <p className='text-muted-foreground text-xs'>
                  {prefDesc(entry.key)}
                </p>
              </div>
              <div className='flex shrink-0 items-center gap-6'>
                <label className='flex items-center gap-2'>
                  <Checkbox
                    checked={state.forceOn}
                    onCheckedChange={(checked) =>
                      toggle(entry.key, 'forceOn', checked === true)
                    }
                    aria-label={t('Force Enable')}
                  />
                  <span className='text-sm'>{t('Force Enable')}</span>
                </label>
                <label className='flex items-center gap-2'>
                  <Checkbox
                    checked={state.locked}
                    onCheckedChange={(checked) =>
                      toggle(entry.key, 'locked', checked === true)
                    }
                    aria-label={t('Lock from User Changes')}
                  />
                  <span className='text-sm'>{t('Lock from User Changes')}</span>
                </label>
              </div>
            </div>
          )
        })}

        <div className='flex justify-end'>
          <SettingsPageFormActions
            onSave={handleSave}
            isSaving={updateOption.isPending}
          />
        </div>
      </div>
    </SettingsSection>
  )
}
