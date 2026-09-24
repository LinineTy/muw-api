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
import { Link, Navigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import { AuthLayout } from '../auth-layout'
import { AuthCard } from '../components/auth-card'
import { AUTH_MINOR_TEXT } from '../lib/auth-styles'
import { hasOAuthProvider } from '../lib/sign-in-capabilities'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()
  const { status } = useStatus()
  // 密码注册关掉时注册页自动关闭（回到登录页；新账号走 OAuth 首登自动建号）
  if (status && status.password_register_enabled === false) {
    return <Navigate to='/sign-in' replace />
  }
  // OAuth 出口只在真的配了提供方时给；文案也不写死 LinuxDO（可能是 GitHub / Telegram / 自定义 OAuth）
  const hasOAuth = hasOAuthProvider(status)

  return (
    <AuthLayout>
      <div className='w-full space-y-6'>
        <AuthCard
          title={t('Create an account')}
          subtitle={
            <>
              {t('Already have an account?')}{' '}
              <Link
                to='/sign-in'
                className='hover:text-primary font-medium underline underline-offset-4'
              >
                {t('Sign in')}
              </Link>
              .
            </>
          }
          badge='secure'
          badgeLabel={t('Connection secure')}
          footer={
            hasOAuth ? (
              <Link
                to='/sign-in'
                className={cn(
                  AUTH_MINOR_TEXT,
                  'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('Sign in with OAuth')}
              </Link>
            ) : null
          }
        >
          <SignUpForm />
        </AuthCard>
      </div>
    </AuthLayout>
  )
}
