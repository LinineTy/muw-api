// @muw-owned
import { LaptopIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useNavigate } from '@tanstack/react-router'
import { CheckCircle2, CircleAlert, Globe, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import dayjs from '@/lib/dayjs'
import {
  loginMethodLabel,
  sessionDevice,
} from '@/features/security/components/login-session-utils'
import { useAuthStore } from '@/stores/auth-store'

import { LOGIN_RESULT_REDIRECT_SECONDS } from '../constants'
import { sanitizeAuthRedirect } from '../lib/auth-redirect'

export interface LoginResultSearch {
  status?: string
  reason?: string
  message?: string
  redirect?: string
}

export function LoginResultScreen(props: { search: LoginResultSearch }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.auth.user)
  const session = useAuthStore((state) => state.auth.session)
  const [secondsLeft, setSecondsLeft] = useState(LOGIN_RESULT_REDIRECT_SECONDS)

  const status = props.search.status
  const reason = props.search.reason
  const message = props.search.message
  const redirect = props.search.redirect

  const isSuccess = !status || status.length === 0
  const successTarget = sanitizeAuthRedirect(redirect, window.location.origin)
  const signInTarget = sanitizeAuthRedirect(redirect, window.location.origin)

  const navigateAway = () => {
    if (isSuccess) {
      // 激活制兜底：登录结果页上用户仍未激活时，改去激活页而非 dashboard。
      if (user?.activated === false) {
        navigate({ to: '/activate', replace: true })
        return
      }
      navigate({ href: successTarget ?? '/dashboard', replace: true })
      return
    }
    navigate({
      to: '/sign-in',
      search: signInTarget ? { redirect: signInTarget } : undefined,
      replace: true,
    })
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSecondsLeft((seconds) => Math.max(seconds - 1, 0))
    }, 1000)
    const timeoutId = window.setTimeout(
      navigateAway,
      LOGIN_RESULT_REDIRECT_SECONDS * 1000
    )
    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
    // 导航目标由 URL query 决定，页面加载后不再变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const displayName = user?.display_name || user?.username
  const ldLevel = user?.linux_do_trust_level
  const avatarName = user?.username || user?.display_name || 'U'

  const maxTouchPoints =
    typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0
  const device = session
    ? sessionDevice(
        session.user_agent,
        t('Unknown device'),
        t('Browser'),
        maxTouchPoints
      )
    : ''
  // loginMethodLabel 对 oauth:xxx 返回「OAuth · GitHub」等具体通道。
  const methodLabel = session ? loginMethodLabel(session.login_method, t) : ''

  const redirectNote = t('Redirecting in {{seconds}} seconds', {
    seconds: secondsLeft,
  })
  const progressPercent = (secondsLeft / LOGIN_RESULT_REDIRECT_SECONDS) * 100

  let statusTitle: string
  if (status === 'user_disabled') {
    statusTitle = t('Your account has been disabled')
  } else if (status === 'linuxdo_blacklisted') {
    statusTitle = t(
      'Your account is on the blacklist and is not allowed to sign in'
    )
  } else {
    statusTitle = t('Unable to sign in or create an account')
  }

  let failDetail: string | null = null
  if (status === 'user_disabled' && reason) {
    failDetail = reason
  } else if (message) {
    failDetail = message
  }

  let title: string
  if (!isSuccess) {
    title = statusTitle
  } else if (displayName) {
    title = t('Welcome back, {{name}}', { name: displayName })
  } else {
    title = t('Signed in successfully!')
  }

  return (
    <div className='w-full space-y-6'>
      {/* 顶部：状态图标 + 标题（成功/失败共用结构） */}
      <div className='flex flex-col items-center gap-4 text-center'>
        <div
          className={
            isSuccess
              ? 'rounded-2xl bg-emerald-500/10 p-4 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300'
              : 'rounded-2xl bg-destructive/10 p-4 text-destructive dark:bg-destructive/20'
          }
        >
          {isSuccess ? (
            <CheckCircle2 className='size-8' aria-hidden='true' />
          ) : (
            <CircleAlert className='size-8' aria-hidden='true' />
          )}
        </div>
        <div className='space-y-2'>
          <h2 className='text-2xl font-semibold tracking-tight'>{title}</h2>
          {isSuccess && displayName ? (
            <p className='text-muted-foreground text-sm sm:text-base'>
              {t('Signed in successfully!')}
            </p>
          ) : null}
        </div>
      </div>

      {/* 失败原因（警示框，原因带「原因:」前缀） */}
      {!isSuccess && failDetail ? (
        <Alert variant='destructive'>
          <CircleAlert className='mt-0.5 size-4' aria-hidden='true' />
          <AlertDescription>
            <span className='font-medium'>{t('Reason:')}</span> {failDetail}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* 成功态：账户 + 登录会话合并卡 */}
      {isSuccess ? (
        <Card data-card-hover='false' className='gap-0 py-0'>
          {user ? (
            <CardContent className='p-4'>
              <p className='text-muted-foreground mb-2.5 text-xs font-medium tracking-wide uppercase'>
                {t('Account')}
              </p>
              <div className='flex items-center gap-3'>
                <Avatar className='ring-background h-11 w-11 shrink-0 rounded-lg text-sm ring-2'>
                  {user.avatar ? (
                    <AvatarImage src={user.avatar} alt={displayName} />
                  ) : null}
                  <AvatarFallback
                    className='rounded-lg text-white'
                    style={getUserAvatarStyle(avatarName)}
                  >
                    {getUserAvatarFallback(avatarName)}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0 flex-1'>
                  <p className='min-w-0 truncate text-base leading-snug font-semibold'>
                    {displayName}
                  </p>
                  {/* 有 LD 绑定时在 @用户名 后用 · 跟 L 等级；无绑定则只显示 @用户名 */}
                  <p className='text-muted-foreground text-xs'>
                    @{user.username}
                    {user.linux_do_id ? ` · L${ldLevel ?? 0}` : null}
                  </p>
                </div>
              </div>
            </CardContent>
          ) : null}

          {user && session ? <Separator /> : null}

          {session ? (
            <CardContent className='p-4'>
              <p className='text-muted-foreground mb-2.5 text-xs font-medium tracking-wide uppercase'>
                {t('Sign-in session')}
              </p>
              <div className='space-y-1'>
                <div className='flex items-center gap-2'>
                  <div className='bg-muted flex size-7 shrink-0 items-center justify-center rounded-md'>
                    <HugeiconsIcon
                      icon={LaptopIcon}
                      className='size-4'
                      strokeWidth={2}
                    />
                  </div>
                  <p className='min-w-0 truncate text-xs font-medium'>
                    {device}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <div className='bg-muted flex size-7 shrink-0 items-center justify-center rounded-md'>
                    <ShieldCheck
                      className='text-muted-foreground size-3.5'
                      aria-hidden='true'
                    />
                  </div>
                  <p className='text-muted-foreground min-w-0 truncate text-xs'>
                    {methodLabel}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <div className='bg-muted flex size-7 shrink-0 items-center justify-center rounded-md'>
                    <Globe
                      className='text-muted-foreground size-3.5'
                      aria-hidden='true'
                    />
                  </div>
                  <p className='text-muted-foreground min-w-0 truncate text-xs'>
                    {session.ip || t('Unknown')} ·{' '}
                    {dayjs
                      .unix(session.created_at)
                      .format('YYYY-MM-DD HH:mm')}
                  </p>
                </div>
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* 倒计时进度条 + 未自动跳转时的兜底链接 */}
      <div className='space-y-3'>
        <div className='space-y-2'>
          <div className='h-1 w-full overflow-hidden rounded-full bg-muted'>
            <div
              className='bg-primary h-full rounded-full transition-[width] duration-1000 ease-linear'
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className='text-muted-foreground text-center text-sm'>
            {redirectNote}
          </p>
        </div>
        <div className='text-center'>
          <button
            type='button'
            onClick={navigateAway}
            className='text-muted-foreground text-xs underline underline-offset-4 transition-colors hover:text-foreground'
          >
            {isSuccess
              ? t('Not redirected automatically? Continue to the dashboard')
              : t('Not redirected automatically? Back to sign in')}
          </button>
        </div>
      </div>
    </div>
  )
}
