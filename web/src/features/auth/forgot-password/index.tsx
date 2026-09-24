// @muw-owned
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import { AuthLayout } from '../auth-layout'
import { AuthCard } from '../components/auth-card'
import { AUTH_MINOR_TEXT } from '../lib/auth-styles'
import { isPasswordSignUpAvailable } from '../lib/sign-in-capabilities'
import { ForgotPasswordForm } from './components/forgot-password-form'

export function ForgotPassword() {
  const { t } = useTranslation()
  const { status } = useStatus()
  // 注册入口只在「确实注册得进来」时才给：注册关着时 /sign-up 会把用户弹回登录页，
  // 这里的链接就是死链（登录页头部同样的判断，两处口径统一走同一个 helper）。
  const canSignUp = isPasswordSignUpAvailable(status)

  return (
    <AuthLayout>
      <AuthCard
        title={t('Forgot password')}
        subtitle={t(
          'Enter your registered email and we will send you a link to reset your password.'
        )}
        badge='secure'
        badgeLabel={t('Connection secure')}
        footer={
          canSignUp ? (
            <Link
              to='/sign-up'
              className={cn(
                AUTH_MINOR_TEXT,
                'text-muted-foreground hover:text-foreground'
              )}
            >
              {t("Don't have an account?")}{' '}
              {/* 下划线只压在「注册」上，句号留在外面 */}
              <span className='underline underline-offset-4'>
                {t('Sign up')}
              </span>
              .
            </Link>
          ) : null
        }
      >
        <ForgotPasswordForm />
      </AuthCard>
    </AuthLayout>
  )
}
