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

import { StatusBadge } from '@/components/status-badge'

/**
 * 偏好键名,必须与后端 common.PreferenceKey* 一致。
 * 管理员策略(强制开启/禁止修改)由后端下发在 profile.preference_policy 上。
 */
export const PREFERENCE_KEY_ACCEPT_UNPRICED = 'accept_unset_model_ratio_model'
export const PREFERENCE_KEY_RECORD_IP_LOG = 'record_ip_log'
export const PREFERENCE_KEY_UPSTREAM_NOTIFY =
  'upstream_model_update_notify_enabled'

export type PreferencePolicy = {
  force_on?: string[]
  locked?: string[]
}

/** 把后端下发的策略转成查表集合,供各偏好开关判断 forced/locked。 */
export function usePreferencePolicy(policy?: PreferencePolicy) {
  return {
    forceOnSet: new Set(policy?.force_on ?? []),
    lockedSet: new Set(policy?.locked ?? []),
  }
}

/** 管理员强制开启 / 禁止修改 的标记,开关旁边展示。 */
export function PolicyBadge({
  forced,
  locked,
}: {
  forced: boolean
  locked: boolean
}) {
  const { t } = useTranslation()
  if (forced) {
    return (
      <StatusBadge
        label={t('Admin Enforced')}
        variant='warning'
        copyable={false}
        className='shrink-0'
      />
    )
  }
  if (locked) {
    return (
      <StatusBadge
        label={t('Locked by Admin')}
        variant='neutral'
        copyable={false}
        className='shrink-0'
      />
    )
  }
  return null
}
