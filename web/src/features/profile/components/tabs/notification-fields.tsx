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
import { Bell, Mail, MessageSquareText, Server, Webhook } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PasswordInput } from '@/components/password-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { NOTIFICATION_METHODS } from '../../constants'
import type { UserSettingsForm } from '../../lib/user-settings'
import type { NotifyType } from '../../types'

const NOTIFICATION_ICONS: Record<NotifyType, typeof Mail> = {
  email: Mail,
  webhook: Webhook,
  bark: Bell,
  gotify: Server,
  // 站内消息：用「消息气泡」。原先是收件箱（Inbox）——小尺寸下和邮箱的 Mail 信封
  // 太像，五个选项里两个几乎分不出来（2026-09-21）
  web: MessageSquareText,
}

type NotificationFieldsProps = {
  settings: UserSettingsForm
  onFieldChange: <K extends keyof UserSettingsForm>(
    field: K,
    value: UserSettingsForm[K]
  ) => void
}

/** 通知方式与各渠道参数（「设置」卡的通知页签）。 */
export function NotificationFields(props: NotificationFieldsProps) {
  const { t } = useTranslation()
  const { settings, onFieldChange } = props
  const notifyType = settings.notify_type

  return (
    <div className='space-y-4 sm:space-y-6'>
      {/* Notification Type */}
      <div className='space-y-2.5'>
        <Label>{t('Notification Method')}</Label>
        <ToggleGroup
          value={[notifyType]}
          onValueChange={(value) => {
            const nextValue = value.find((item) => item !== notifyType)
            if (nextValue) {
              onFieldChange('notify_type', nextValue as NotifyType)
            }
          }}
          aria-label={t('Notification Method')}
          variant='outline'
          size='lg'
          spacing={2}
          className='grid w-full grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3'
        >
          {NOTIFICATION_METHODS.map((method) => {
            const Icon = NOTIFICATION_ICONS[method.value]
            return (
              <ToggleGroupItem
                key={method.value}
                value={method.value}
                className='h-auto min-h-14 w-full flex-col gap-1.5 px-3 py-3 sm:min-h-16'
              >
                <Icon className='h-4 w-4 sm:h-5 sm:w-5' />
                <span className='max-w-full truncate text-xs font-medium sm:text-sm'>
                  {t(method.label)}
                </span>
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </div>

      {/* Warning Threshold */}
      <div className='space-y-1.5'>
        <Label htmlFor='threshold'>{t('Quota Warning Threshold')}</Label>
        <Input
          id='threshold'
          type='number'
          className='h-9'
          value={settings.quota_warning_threshold}
          onChange={(e) =>
            onFieldChange('quota_warning_threshold', Number(e.target.value))
          }
          placeholder={t('Enter threshold')}
        />
        <p className='text-muted-foreground text-xs'>
          {t('Get notified when balance falls below this value')}
        </p>
      </div>

      {/* Email Settings */}
      {notifyType === 'email' && (
        <div className='space-y-1.5'>
          <Label htmlFor='notifyEmail'>{t('Notification Email')}</Label>
          <Input
            id='notifyEmail'
            type='email'
            className='h-9'
            value={settings.notification_email}
            onChange={(e) =>
              onFieldChange('notification_email', e.target.value)
            }
            placeholder={t('Leave empty to use account email')}
          />
        </div>
      )}

      {/* Webhook Settings */}
      {notifyType === 'webhook' && (
        <>
          <div className='space-y-1.5'>
            <Label htmlFor='webhookUrl'>{t('Webhook URL')}</Label>
            <Input
              id='webhookUrl'
              type='url'
              className='h-9'
              value={settings.webhook_url}
              onChange={(e) => onFieldChange('webhook_url', e.target.value)}
              placeholder={t('https://example.com/webhook')}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='webhookSecret'>{t('Webhook Secret')}</Label>
            <PasswordInput
              id='webhookSecret'
              value={settings.webhook_secret}
              onChange={(e) => onFieldChange('webhook_secret', e.target.value)}
              placeholder={t('Enter secret key')}
            />
          </div>
        </>
      )}

      {/* Bark Settings */}
      {notifyType === 'bark' && (
        <div className='space-y-1.5'>
          <Label htmlFor='barkUrl'>{t('Bark Push URL')}</Label>
          <Input
            id='barkUrl'
            type='url'
            className='h-9'
            value={settings.bark_url}
            onChange={(e) => onFieldChange('bark_url', e.target.value)}
            placeholder={t('https://api.day.app/yourkey/{{title}}/{{content}}')}
          />
          <p className='text-muted-foreground text-xs'>
            {t('Template variables:')} {'{{title}}'}, {'{{content}}'}
          </p>
        </div>
      )}

      {/* Gotify Settings */}
      {notifyType === 'gotify' && (
        <>
          <div className='space-y-1.5'>
            <Label htmlFor='gotifyUrl'>{t('Gotify Server URL')}</Label>
            <Input
              id='gotifyUrl'
              type='url'
              className='h-9'
              value={settings.gotify_url}
              onChange={(e) => onFieldChange('gotify_url', e.target.value)}
              placeholder={t('https://gotify.example.com')}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Enter the full URL of your Gotify server')}
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='gotifyToken'>{t('Gotify Application Token')}</Label>
            <PasswordInput
              id='gotifyToken'
              value={settings.gotify_token}
              onChange={(e) => onFieldChange('gotify_token', e.target.value)}
              placeholder={t('Enter application token')}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Token obtained from your Gotify application')}
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='gotifyPriority'>{t('Message Priority')}</Label>
            <Input
              id='gotifyPriority'
              type='number'
              className='h-9'
              min='0'
              max='10'
              value={settings.gotify_priority}
              onChange={(e) =>
                onFieldChange('gotify_priority', Number(e.target.value))
              }
              placeholder='5'
            />
            <p className='text-muted-foreground text-xs'>
              {t('Priority level from 0 (lowest) to 10 (highest), default is 5')}
            </p>
          </div>
          <div className='bg-muted/50 rounded-lg border p-3 sm:p-4'>
            <h5 className='mb-1.5 text-sm font-medium sm:mb-2'>
              {t('Setup Instructions')}
            </h5>
            <ol className='text-muted-foreground space-y-1 text-xs'>
              <li>{t('1. Create an application in your Gotify server')}</li>
              <li>{t('2. Copy the application token')}</li>
              <li>{t('3. Enter your Gotify server URL and token above')}</li>
            </ol>
            <p className='text-muted-foreground mt-3 text-xs'>
              {t('Learn more:')}{' '}
              <a
                href='https://gotify.net/'
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary underline underline-offset-4'
              >
                {t('Gotify Documentation')}
              </a>
            </p>
          </div>
        </>
      )}
    </div>
  )
}
