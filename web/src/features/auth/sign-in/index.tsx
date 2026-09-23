import { Link, useSearch } from '@tanstack/react-router'
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
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import { MOTION_TRANSITION } from '@/lib/motion'
import { cn } from '@/lib/utils'

import { AuthLayout } from '../auth-layout'
import { AuthCard } from '../components/auth-card'
import { AUTH_MINOR_TEXT } from '../lib/auth-styles'
import {
  getSignInCapabilities,
  type SignInMode,
} from '../lib/sign-in-capabilities'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const shouldReduce = useReducedMotion()
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()
  const caps = getSignInCapabilities(status)
  // 默认主位 = OAuth（L1）；没有替代登录方式时只剩账号密码，直接落到密码模式。
  const [mode, setMode] = useState<SignInMode>(
    caps.hasAlternativeLogin ? 'oauth' : 'password'
  )
  useEffect(() => {
    if (!caps.hasAlternativeLogin) setMode('password')
  }, [caps.hasAlternativeLogin])
  const canSwitchMode = caps.hasAlternativeLogin && caps.passwordLoginEnabled

  return (
    <AuthLayout>
      <div className='w-full space-y-6'>
        <AuthCard
          title={t('Sign in')}
          subtitle={
            !status?.self_use_mode_enabled &&
            status?.register_enabled !== false &&
            // 密码注册关掉时注册页会回跳登录页，这里就不再引导去注册
            status?.password_register_enabled !== false ? (
              <>
                {t("Don't have an account?")}{' '}
                <Link
                  to='/sign-up'
                  className='hover:text-primary font-medium underline underline-offset-4'
                >
                  {t('Sign up')}
                </Link>
                .
              </>
            ) : null
          }
          badge='secure'
          badgeLabel={t('Connection secure')}
          footer={
            canSwitchMode ? (
              <button
                type='button'
                className={cn(
                  AUTH_MINOR_TEXT,
                  'text-muted-foreground hover:text-foreground'
                )}
                onClick={() =>
                  setMode((current) =>
                    current === 'oauth' ? 'password' : 'oauth'
                  )
                }
              >
                <AnimatePresence mode='wait' initial={false}>
                  <motion.span
                    key={mode}
                    initial={shouldReduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduce ? undefined : { opacity: 0, y: -4 }}
                    transition={MOTION_TRANSITION.fast}
                    className='inline-block'
                  >
                    {mode === 'oauth'
                      ? t('Sign in with username and password')
                      : t('Sign in with OAuth')}
                  </motion.span>
                </AnimatePresence>
              </button>
            ) : null
          }
        >
          <UserAuthForm redirectTo={redirect} mode={mode} />
        </AuthCard>
      </div>
    </AuthLayout>
  )
}
