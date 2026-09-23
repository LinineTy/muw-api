// @muw-owned
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { AuthLayout } from '../auth-layout'
import { AuthCard } from '../components/auth-card'
import { AUTH_MINOR_TEXT } from '../lib/auth-styles'
import { ForgotPasswordForm } from './components/forgot-password-form'

export function ForgotPassword() {
  const { t } = useTranslation()

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
          <Link
            to='/sign-up'
            className={cn(
              AUTH_MINOR_TEXT,
              'text-muted-foreground hover:text-foreground'
            )}
          >
            {t("Don't have an account?")}{' '}
            {/* 下划线只压在「注册」上，句号留在外面 */}
            <span className='underline underline-offset-4'>{t('Sign up')}</span>
            .
          </Link>
        }
      >
        <ForgotPasswordForm />
      </AuthCard>
    </AuthLayout>
  )
}
