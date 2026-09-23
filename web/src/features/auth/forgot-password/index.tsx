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
            {t("Don't have an account?")} {t('Sign up')}.
          </Link>
        }
      >
        <ForgotPasswordForm />
      </AuthCard>
    </AuthLayout>
  )
}
