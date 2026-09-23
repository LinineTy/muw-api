// @muw-owned
import { LaptopIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useNavigate } from '@tanstack/react-router'
import { CircleAlert, Clock, Globe, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import {
  loginMethodLabel,
  sessionDevice,
} from '@/features/security/components/login-session-utils'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import dayjs from '@/lib/dayjs'
import { useAuthStore } from '@/stores/auth-store'

import { AuthCardBadge } from '../components/auth-card-badge'
import { CountdownRing } from '../components/countdown-ring'
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
      navigate({ href: successTarget ?? '/os-desktop', replace: true })
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

  // 设计稿：成功页标题不带用户名（用户名在卡内账号行），失败页用状态标题
  const title = isSuccess ? t('Welcome back') : statusTitle

  return (
    <div className='w-full'>
      {/* 卡外标题区：标题 + 副标题；成功态在副标题右侧挂倒计时圆环 */}
      <div className='mb-4'>
        <h2 className='text-2xl font-semibold tracking-tight'>{title}</h2>
        <div className='mt-1.5 flex items-center gap-3'>
          <p className='text-muted-foreground text-sm'>
            {isSuccess
              ? t('Signed in successfully, entering the console')
              : t('This account is currently disabled')}
          </p>
          {isSuccess ? (
            <CountdownRing
              secondsLeft={secondsLeft}
              totalSeconds={LOGIN_RESULT_REDIRECT_SECONDS}
            />
          ) : null}
        </div>
      </div>

      <div className='relative'>
        <Card data-card-hover='false' className='gap-0 py-0'>
          <CardContent className='grid gap-3.5 px-5 pt-6'>
            {/* 账号行：头像 + 双排（用户名 / @用户名 · LD 等级） */}
            {isSuccess && user ? (
              <div className='flex items-center gap-3'>
                <Avatar className='ring-background size-10 shrink-0 rounded-full text-sm ring-1'>
                  {user.avatar ? (
                    <AvatarImage src={user.avatar} alt={displayName} />
                  ) : null}
                  <AvatarFallback
                    className='rounded-full text-white'
                    style={getUserAvatarStyle(avatarName)}
                  >
                    {getUserAvatarFallback(avatarName)}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0'>
                  <p className='min-w-0 truncate text-base leading-snug font-semibold'>
                    {displayName}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    @{user.username}
                    {user.linux_do_id ? ` · L${ldLevel ?? 0}` : null}
                  </p>
                </div>
              </div>
            ) : null}

            {/* 登录会话：设备 / 来源 / IP / 时间 四行，各带图标 */}
            {isSuccess && session ? (
              <div className='border-border bg-muted/30 grid gap-2.5 rounded-xl border px-3.5 py-3'>
                <div className='flex items-center gap-2.5'>
                  <HugeiconsIcon
                    icon={LaptopIcon}
                    className='text-muted-foreground size-4 shrink-0'
                    strokeWidth={2}
                  />
                  <p className='min-w-0 truncate text-xs font-medium'>
                    {device}
                  </p>
                </div>
                <div className='flex items-center gap-2.5'>
                  <ShieldCheck
                    className='text-muted-foreground size-4 shrink-0'
                    aria-hidden='true'
                  />
                  <p className='text-muted-foreground min-w-0 truncate text-xs'>
                    {methodLabel}
                  </p>
                </div>
                <div className='flex items-start gap-2.5'>
                  <Globe
                    className='text-muted-foreground mt-0.5 size-4 shrink-0'
                    aria-hidden='true'
                  />
                  <p className='text-muted-foreground min-w-0 font-mono text-xs break-all'>
                    {session.ip || t('Unknown')}
                  </p>
                </div>
                <div className='flex items-center gap-2.5'>
                  <Clock
                    className='text-muted-foreground size-4 shrink-0'
                    aria-hidden='true'
                  />
                  <p className='text-muted-foreground min-w-0 truncate text-xs'>
                    {dayjs.unix(session.created_at).format('YYYY-MM-DD HH:mm')}
                  </p>
                </div>
              </div>
            ) : null}

            {/* 失败原因 */}
            {!isSuccess && failDetail ? (
              <div className='border-border bg-muted/30 flex items-start gap-2.5 rounded-xl border px-3.5 py-3'>
                <CircleAlert
                  className='text-destructive mt-0.5 size-4 shrink-0'
                  aria-hidden='true'
                />
                <span className='break-anywhere text-xs leading-5'>
                  {failDetail}
                </span>
              </div>
            ) : null}
          </CardContent>

          {/* 底部次要入口：成功 = 手动跳转；失败 = 返回首页（无主按钮） */}
          <div
            className='flex min-h-11 items-center px-5'
            style={{ paddingRight: 136 }}
          >
            <button
              type='button'
              onClick={isSuccess ? navigateAway : () => navigate({ to: '/' })}
              className='text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors'
            >
              {isSuccess
                ? t('Not redirected automatically? Continue to the dashboard')
                : t('Back to home')}
            </button>
          </div>
        </Card>

        <AuthCardBadge
          kind={isSuccess ? 'success' : 'fail'}
          label={
            isSuccess ? t('Status: signed in') : t('Status: sign-in failed')
          }
        />
      </div>
    </div>
  )
}
