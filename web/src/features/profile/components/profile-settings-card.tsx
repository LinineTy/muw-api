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
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TitledCard } from '@/components/ui/titled-card'
import { handleServerError } from '@/lib/handle-server-error'

import { updateUserSettings } from '../api'
import {
  normalizeUserSettings,
  type UserSettingsForm,
} from '../lib/user-settings'
import type { UserProfile } from '../types'
import { LanguageFields } from './tabs/language-fields'
import { NotificationFields } from './tabs/notification-fields'
import { PreferenceFields } from './tabs/preference-fields'

// ============================================================================
// Profile Settings Card Component
// ============================================================================

type SettingsTab = 'notifications' | 'preferences' | 'language'

interface ProfileSettingsCardProps {
  profile: UserProfile | null
  loading: boolean
  onProfileUpdate: () => void
}

/**
 * 账号设置：通知 / 偏好 / 语言三个页签共用一张卡与一个保存按钮
 * （语言是独立接口、改完即存，故该页签不显示保存按钮）。
 */
export function ProfileSettingsCard({
  profile,
  loading,
  onProfileUpdate,
}: ProfileSettingsCardProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>('notifications')
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<UserSettingsForm>(() =>
    normalizeUserSettings()
  )

  useEffect(() => {
    if (profile?.setting) {
      setSettings(normalizeUserSettings(profile.setting))
    }
  }, [profile])

  const updateField = useCallback(
    <K extends keyof UserSettingsForm>(field: K, value: UserSettingsForm[K]) => {
      setSettings((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const handleSave = async () => {
    try {
      setSaving(true)
      const { record_ip_log: _recordIpLog, ...notificationSettings } = settings
      const response = await updateUserSettings(notificationSettings)

      if (response.success) {
        toast.success(t('Settings updated successfully'))
        onProfileUpdate()
      } else {
        handleServerError(response, t('Failed to update settings'))
      }
    } catch (error) {
      handleServerError(error, t('Failed to update settings'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-5 w-32' />
          <Skeleton className='mt-2 h-4 w-48' />
        </CardHeader>
        <CardContent className='space-y-4 p-3 sm:p-5'>
          {['notifications', 'threshold', 'preferences'].map((key) => (
            <Skeleton key={key} className='h-20 w-full' />
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <TitledCard
      title={t('Settings')}
      description={t('Configure your account preferences and integrations')}
      disableHoverEffect
    >
      <div className='space-y-4 sm:space-y-6'>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as SettingsTab)}
          className='flex flex-col gap-4'
        >
          <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
            <TabsTrigger value='notifications'>{t('Notifications')}</TabsTrigger>
            <TabsTrigger value='preferences'>{t('Preferences')}</TabsTrigger>
            <TabsTrigger value='language'>
              {t('Language Preferences')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value='notifications'>
            <NotificationFields settings={settings} onFieldChange={updateField} />
          </TabsContent>
          <TabsContent value='preferences'>
            <PreferenceFields
              profile={profile}
              settings={settings}
              onFieldChange={updateField}
            />
          </TabsContent>
          <TabsContent value='language'>
            <LanguageFields
              profile={profile}
              onProfileUpdate={onProfileUpdate}
            />
          </TabsContent>
        </Tabs>

        {tab !== 'language' && (
          <div className='flex justify-end'>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              {saving ? t('Saving...') : t('Save Settings')}
            </Button>
          </div>
        )}
      </div>
    </TitledCard>
  )
}
