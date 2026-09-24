// @muw-owned
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { activateAccount, getActivationDeadline } from '@/features/auth/api'
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

/** 剩余秒数格式化成 m:ss，倒计时提示用。 */
function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function Activate() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.auth.setUser)
  const [inviteCode, setInviteCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)

  // 提交过钓鱼邀请码的账号会有一条宽限记录（后端只读接口），据此显示倒计时：
  // 宽限期内用有效邀请码激活即免于停用。读不到就不提示，不阻断激活流程。
  const refreshDeadline = useCallback(async () => {
    try {
      const info = await getActivationDeadline()
      if (info.pending && info.remaining_seconds) {
        setDeadline(Date.now() + info.remaining_seconds * 1000)
        setRemaining(info.remaining_seconds)
        return
      }
    } catch {
      // 忽略：没有提示不影响激活本身
    }
    setDeadline(null)
    setRemaining(0)
  }, [])

  useEffect(() => {
    void refreshDeadline()
  }, [refreshDeadline])

  useEffect(() => {
    if (deadline === null) return
    const tick = () =>
      setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [deadline])

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
        // 失败后立刻重取一次：若这次提交的正是钓鱼码，提示当场出现（不用刷新页面）。
        void refreshDeadline()
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
          {deadline !== null ? (
            <p
              role='status'
              className='text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5'
            >
              {remaining > 0
                ? t(
                    'Your account will be disabled in {{time}} unless you activate with a valid invitation code.',
                    { time: formatCountdown(remaining) }
                  )
                : t(
                    'The activation deadline has passed; this account will be disabled shortly.'
                  )}
            </p>
          ) : null}
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
