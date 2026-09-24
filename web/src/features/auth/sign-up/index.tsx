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
import {
  hasThirdPartyLogin,
  isPasswordSignUpAvailable,
} from '../lib/sign-in-capabilities'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()
  const { status } = useStatus()
  // 注册总开关 / 自用模式 / 密码注册任一关掉都别开注册页（与后端 controller/user.go 的拦截一致，
  // 否则会出现「能填表、提交必失败」）；关掉时回登录页，新账号走 OAuth 首登自动建号。
  if (status && !isPasswordSignUpAvailable(status)) {
    return <Navigate to='/sign-in' replace />
  }
  // 第三方（OAuth / 微信…）统一走登录页；注册页只留账号密码。没配任何第三方时不给这条入口。
  const hasThirdParty = hasThirdPartyLogin(status)

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
            hasThirdParty ? (
              <Link
                to='/sign-in'
                className={cn(
                  AUTH_MINOR_TEXT,
                  'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('Sign in with a third-party account')}
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
