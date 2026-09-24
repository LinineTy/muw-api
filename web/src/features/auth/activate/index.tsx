// @muw-owned
/**
 * 激活页：待激活账号提交邀请码转正。
 *
 * 提交流程：勾选校验浮窗后领挑战并求解，再带邀请码与蜜罐字段提交。
 * 服务端按蜜罐、校验、邀请码的顺序处置（见 controller/user.go）。
 */
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  activateAccount,
  getActivationChallenge,
  getActivationDeadline,
} from '@/features/auth/api'
import { AUTH_INPUT, AUTH_MINOR_TEXT, AUTH_PRIMARY_BUTTON } from '@/features/auth/lib/auth-styles'
import { isAuthUser } from '@/lib/auth-session'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { AuthLayout } from '../auth-layout'
import { AuthCard } from '../components/auth-card'
import { SecurityCheckWindow } from '../components/security-check-window'
import { useSecurityCheck } from '../lib/use-security-check'

/** 服务端回的人机校验机器码（见 controller/activation_pow.go）。 */
const CODE_VERIFICATION_REQUIRED = 'ACTIVATION_VERIFICATION_REQUIRED'
const CODE_VERIFICATION_FAILED = 'ACTIVATION_VERIFICATION_FAILED'

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
  // 隐形蜜罐字段值：非空即被服务端判为自动化提交。
  const [honeypot, setHoneypot] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)
  // 人机校验：勾选后开始计算，通过后提交才能取用凭据。
  const check = useSecurityCheck(getActivationChallenge)

  // 有未结的钓鱼码宽限记录时显示倒计时；读不到则不提示。
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

  // 提交：取一份凭据（正在计算时等待其完成），带上邀请码与蜜罐字段。
  const submitOnce = useCallback(
    async (code: string) => {
      const proof = await check.ensureProof()
      return activateAccount({
        inviteCode: code,
        website: honeypot,
        challengeId: proof?.challengeId,
        nonce: proof?.nonce,
      })
    },
    [check, honeypot]
  )

  const submit = async (rawCode: string) => {
    const code = rawCode.trim()
    if (!code) {
      toast.error(t('Enter your invitation code'))
      return
    }
    if (!check.ready) {
      return
    }
    setIsSubmitting(true)
    try {
      let res = await submitOnce(code)
      // 凭据一次性消费：服务端回机器码时重算并重试一次。
      if (
        res?.code === CODE_VERIFICATION_REQUIRED ||
        res?.code === CODE_VERIFICATION_FAILED
      ) {
        res = await submitOnce(code)
      }
      if (res?.success && isAuthUser(res.data)) {
        setUser(res.data)
        toast.success(t('Activated successfully'))
        navigate({ to: '/os-desktop', replace: true })
      } else {
        toast.error(res?.message || t('Activation failed'))
        // 失败后立即重取一次宽限信息（提交的若是钓鱼码，提示当场出现）。
        void refreshDeadline()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit(inviteCode)
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
        <form onSubmit={handleSubmit} className='relative grid gap-4'>
          {/* 隐形蜜罐：不可见、不可聚焦，自动化脚本会填写；服务端据此判定 */}
          <input
            type='text'
            name='website_url'
            data-testid='activation-honeypot'
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
            tabIndex={-1}
            autoComplete='off'
            aria-hidden='true'
            className='pointer-events-none absolute -left-[9999px] top-0 h-0 w-0 opacity-0'
          />
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
            disabled={isSubmitting || !check.ready}
            className={cn(AUTH_PRIMARY_BUTTON, 'mt-1')}
          >
            {isSubmitting ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
            {t('Activate')}
          </Button>
        </form>
      </AuthCard>
      <SecurityCheckWindow {...check.windowProps} />
    </AuthLayout>
  )
}
