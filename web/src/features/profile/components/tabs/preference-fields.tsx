// @muw-owned
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
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ROLE } from '@/lib/roles'

import type { UserSettingsForm } from '../../lib/user-settings'
import type { UserProfile } from '../../types'
import {
  PolicyBadge,
  PREFERENCE_KEY_ACCEPT_UNPRICED,
  PREFERENCE_KEY_UPSTREAM_NOTIFY,
  usePreferencePolicy,
} from '../preference-policy'

type PreferenceFieldsProps = {
  profile: UserProfile | null
  settings: UserSettingsForm
  onFieldChange: <K extends keyof UserSettingsForm>(
    field: K,
    value: UserSettingsForm[K]
  ) => void
}

/**
 * 账号行为偏好（「设置」卡的偏好页签）。
 *
 * ⚠️ 开关的 checked/disabled 与「管理员强制开启 / 禁止修改」标记共用同一份策略
 * （`profile.preference_policy`）：强制开启 ⇒ 开关恒为开且不可点；禁止修改 ⇒
 * 不可点但显示用户自己保存的值。
 */
export function PreferenceFields(props: PreferenceFieldsProps) {
  const { t } = useTranslation()
  const { settings, onFieldChange, profile } = props
  const isAdmin = (profile?.role ?? 0) >= ROLE.ADMIN
  const { forceOnSet, lockedSet } = usePreferencePolicy(
    profile?.preference_policy
  )

  return (
    <div className='space-y-3'>
      <div>
        <h4 className='text-sm font-medium'>{t('Preferences')}</h4>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t('Configure your account behavior preferences')}
        </p>
      </div>

      {/* Receive Upstream Model Update Notifications (admin only) */}
      {isAdmin && (
        <div className='flex items-start justify-between gap-3 rounded-lg border p-3 sm:items-center sm:p-4'>
          <div className='space-y-0.5'>
            <div className='flex flex-wrap items-center gap-2'>
              <Label htmlFor='upstreamModelUpdateNotify'>
                {t('Receive Upstream Model Update Notifications')}
              </Label>
              <PolicyBadge
                forced={forceOnSet.has(PREFERENCE_KEY_UPSTREAM_NOTIFY)}
                locked={lockedSet.has(PREFERENCE_KEY_UPSTREAM_NOTIFY)}
              />
            </div>
            <p className='text-muted-foreground line-clamp-3 text-xs sm:line-clamp-none sm:text-sm'>
              {t(
                'Only available for admins. When enabled, you will receive a summary notification via your selected method when the scheduled model check detects upstream model changes or check failures.'
              )}
            </p>
          </div>
          <Switch
            id='upstreamModelUpdateNotify'
            className='shrink-0'
            checked={
              forceOnSet.has(PREFERENCE_KEY_UPSTREAM_NOTIFY) ||
              settings.upstream_model_update_notify_enabled
            }
            disabled={
              forceOnSet.has(PREFERENCE_KEY_UPSTREAM_NOTIFY) ||
              lockedSet.has(PREFERENCE_KEY_UPSTREAM_NOTIFY)
            }
            onCheckedChange={(checked) =>
              onFieldChange('upstream_model_update_notify_enabled', checked)
            }
          />
        </div>
      )}

      {/* Accept Unset Model Price */}
      <div className='flex items-start justify-between gap-3 rounded-lg border p-3 sm:items-center sm:p-4'>
        <div className='space-y-0.5'>
          <div className='flex flex-wrap items-center gap-2'>
            <Label htmlFor='acceptUnsetPrice'>{t('Accept Unpriced Models')}</Label>
            <PolicyBadge
              forced={forceOnSet.has(PREFERENCE_KEY_ACCEPT_UNPRICED)}
              locked={lockedSet.has(PREFERENCE_KEY_ACCEPT_UNPRICED)}
            />
          </div>
          <p className='text-muted-foreground text-xs sm:text-sm'>
            {t('Allow using models without price configuration')}
          </p>
        </div>
        <Switch
          id='acceptUnsetPrice'
          className='shrink-0'
          checked={
            forceOnSet.has(PREFERENCE_KEY_ACCEPT_UNPRICED) ||
            settings.accept_unset_model_ratio_model
          }
          disabled={
            forceOnSet.has(PREFERENCE_KEY_ACCEPT_UNPRICED) ||
            lockedSet.has(PREFERENCE_KEY_ACCEPT_UNPRICED)
          }
          onCheckedChange={(checked) =>
            onFieldChange('accept_unset_model_ratio_model', checked)
          }
        />
      </div>
    </div>
  )
}
