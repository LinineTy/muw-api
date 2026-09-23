// @muw-owned
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { activateAccount } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/auth-layout'
import { AuthCard } from '@/features/auth/components/auth-card'
import {
  AUTH_INPUT,
  AUTH_MINOR_TEXT,
  AUTH_PRIMARY_BUTTON,
} from '@/features/auth/lib/auth-styles'
import { isAuthUser } from '@/lib/auth-session'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

export function Activate() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.auth.setUser)
  const [inviteCode, setInviteCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = inviteCode.trim()
    if (!code) {
      toast.error(t('Enter your invitation code'))
      return
    }
    setIsSubmitting(true)
    try {
      const res = await activateAccount(code)
      if (res?.success && isAuthUser(res.data)) {
        setUser(res.data)
        toast.success(t('Activated successfully'))
        navigate({ to: '/os-desktop', replace: true })
      } else {
        toast.error(res?.message || t('Activation failed'))
      }
    } catch {
      // 错误由全局拦截器处理
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <AuthCard
        title={t('Activate Account')}
        subtitle={t(
          'This site requires an invitation code to activate your account'
        )}
        badge='activate'
        badgeLabel={t('Activation required')}
        footer={
          <button
            type='button'
            onClick={() => navigate({ to: '/sign-in', replace: true })}
            className={cn(
              AUTH_MINOR_TEXT,
              'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('Sign in with a different account')}
          </button>
        }
      >
        <form onSubmit={handleSubmit} className='grid gap-4'>
          <div className='grid gap-2'>
            <Label htmlFor='invite-code' className='sr-only'>
              {t('Invitation Code')}
            </Label>
            <Input
              id='invite-code'
              placeholder={t('Invitation Code')}
              className={AUTH_INPUT}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete='off'
              disabled={isSubmitting}
            />
          </div>
          <Button
            type='submit'
            disabled={isSubmitting}
            className={cn(AUTH_PRIMARY_BUTTON, 'mt-1')}
          >
            {isSubmitting ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
            {t('Activate')}
          </Button>
        </form>
      </AuthCard>
    </AuthLayout>
  )
}
