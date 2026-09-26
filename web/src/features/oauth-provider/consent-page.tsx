// @muw-owned
import { Check, ChevronDown, Globe, PlugZap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AuthLayout } from '@/features/auth/auth-layout'
import { AuthCard } from '@/features/auth/components/auth-card'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  getConsentPreview,
  submitConsentDecision,
  type OAuthConsentPreview,
} from './api'
import { SCOPE_LABELS } from './scopes'

// 授权确认页：第三方应用拿本站账号登录时，用户在这里决定给不给。
// 独立成页（不进桌面壳），顶/底与登录页同一套。
// 默认只给"应用 + 授权身份"这一张居中的卡；权限明细收在「查看更多」里，
// 展开后变成左右双卡（窄屏在下方堆叠）。默认每次都会问，
// 用户勾了「以后不再询问」才会静默放行，且应用新增 scope 时仍会回来问。
export function OAuthConsentPage({ request }: { request: string }) {
  const { t } = useTranslation()
  const { auth } = useAuthStore()
  const [preview, setPreview] = useState<OAuthConsentPreview | null>(null)
  const [error, setError] = useState('')
  const [silent, setSilent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // 已经替用户自动决策过的授权请求（静默同意 / prompt=none），避免重复提交
  const autoDecided = useRef('')

  useEffect(() => {
    let active = true
    if (!request) {
      setError(t('Authorization request is missing or has expired'))
      return
    }
    getConsentPreview(request)
      .then((data) => {
        if (!active) {
          return
        }
        // 两种不需要用户动手的情况：
        // ① 之前同意过、开了「以后不再询问」且这次没有新增权限 ⇒ 直接放行（静默同意）；
        // ② 客户端要求 prompt=none ⇒ 不能弹界面，需要确认就按规范把 interaction_required 回给应用。
        if (
          autoDecided.current !== request &&
          (!data.needs_consent || data.prompt === 'none')
        ) {
          autoDecided.current = request
          setBusy(true)
          submitConsentDecision({
            request,
            approve: !data.needs_consent,
            silent: data.remember_silent && !data.needs_consent,
          })
            .then((redirectUrl) => window.location.assign(redirectUrl))
            .catch((cause: unknown) => {
              if (active) {
                setError(cause instanceof Error ? cause.message : String(cause))
                setBusy(false)
              }
            })
          return
        }
        setPreview(data)
        setSilent(data.remember_silent)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => {
      active = false
    }
  }, [request, t])

  const username = auth.user?.username ?? ''
  const avatarFallback = useMemo(
    () => getUserAvatarFallback(username || '?'),
    [username]
  )
  const avatarFallbackStyle = useMemo(
    () => getUserAvatarStyle(username || '?'),
    [username]
  )

  const decide = async (approve: boolean) => {
    setBusy(true)
    setError('')
    try {
      const redirectUrl = await submitConsentDecision({
        request,
        approve,
        silent: approve && silent,
      })
      // 回到第三方应用（带上授权码或拒绝原因），当前页面使命结束。
      window.location.assign(redirectUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  if (!preview) {
    return (
      <AuthLayout>
        <AuthCard
          title={
            error ? t('Authorize application') : t('Authorize application')
          }
          subtitle={
            error ? undefined : t('Checking the authorization request…')
          }
        >
          {error ? (
            <p className='text-destructive text-sm' role='alert'>
              {error}
            </p>
          ) : null}
        </AuthCard>
      </AuthLayout>
    )
  }

  const identity = username ? (
    <div className='border-border/70 flex items-center gap-3 rounded-xl border px-4 py-3'>
      <Avatar className='size-9'>
        {auth.user?.avatar ? (
          <AvatarImage src={auth.user.avatar} alt={username} />
        ) : null}
        <AvatarFallback
          className='text-xs font-semibold text-white'
          style={avatarFallbackStyle}
        >
          {avatarFallback}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium'>{username}</p>
        <p className='text-muted-foreground text-xs'>
          {t('Authorizing as @{{username}}', { username })}
        </p>
      </div>
    </div>
  ) : null

  const appInfo = (
    <div className='border-border/70 space-y-2 rounded-xl border p-4'>
      <p className='text-muted-foreground text-xs'>{t('Application info')}</p>
      <p className='flex items-center gap-2 text-sm'>
        <Globe className='size-4 shrink-0' />
        <span className='truncate'>{preview.redirect_host}</span>
      </p>
      {preview.description ? (
        <p className='text-muted-foreground text-sm'>{preview.description}</p>
      ) : null}
      {preview.owner_username ? (
        <p className='text-muted-foreground text-sm'>
          {t('Requested by {{username}}', { username: preview.owner_username })}
        </p>
      ) : null}
    </div>
  )

  const permissionList = (
    <ul className='bg-muted/40 space-y-2 rounded-xl p-3'>
      {preview.scopes.map((scope) => (
        <li key={scope} className='flex items-center gap-2 text-sm'>
          <Check className='text-success size-4 shrink-0' />
          {t(SCOPE_LABELS[scope] ?? scope)}
        </li>
      ))}
    </ul>
  )

  const actions = (
    <div className='flex justify-end gap-2 pt-1'>
      <Button
        variant='outline'
        size='sm'
        disabled={busy}
        onClick={() => decide(false)}
      >
        {t('Deny')}
      </Button>
      <Button size='sm' disabled={busy} onClick={() => decide(true)}>
        {t('Allow')}
      </Button>
    </div>
  )

  return (
    <AuthLayout contentWidthClassName={expanded ? 'sm:w-[720px]' : undefined}>
      <div className='flex flex-col gap-5'>
        <div className='flex flex-col items-center gap-3 text-center'>
          {preview.client_icon_url ? (
            <img
              src={preview.client_icon_url}
              alt=''
              className='size-12 rounded-2xl object-cover'
            />
          ) : (
            <span className='bg-muted flex size-12 items-center justify-center rounded-2xl'>
              <PlugZap className='size-6' />
            </span>
          )}
          <div className='space-y-1'>
            <h2 className='text-xl font-semibold tracking-tight'>
              {t('{{name}} wants to sign you in', {
                name: preview.client_name,
              })}
            </h2>
            <p className='text-muted-foreground text-sm'>
              {t('You will return to {{host}} after confirming.', {
                host: preview.redirect_host,
              })}
            </p>
          </div>
        </div>

        {/* 收起时只有左卡（居中）；展开后桌面上变左右双卡，窄屏在下方堆叠 */}
        <div className={cn('grid gap-3.5', expanded && 'lg:grid-cols-2')}>
          <Card data-card-hover='false' className='gap-0 py-0'>
            <CardContent className='grid gap-3.5 px-[22px] pt-6 pb-6'>
              {identity}
              {appInfo}
              <div className='flex items-center justify-between gap-3'>
                <p className='text-muted-foreground text-xs'>
                  {t('{{count}} permissions requested', {
                    count: preview.scopes.length,
                  })}
                </p>
                <Button
                  variant='ghost'
                  size='sm'
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? t('Show less') : t('Show more')}
                  <ChevronDown
                    className={cn(
                      'size-4 transition-transform',
                      expanded && 'rotate-180'
                    )}
                  />
                </Button>
              </div>
              {actions}
            </CardContent>
          </Card>

          {expanded ? (
            <Card data-card-hover='false' className='gap-0 py-0'>
              <CardContent className='grid gap-3.5 px-[22px] pt-6 pb-6'>
                <div className='space-y-2'>
                  <p className='text-sm font-medium'>
                    {t('This application will be able to:')}
                  </p>
                  {permissionList}
                </div>
                <div className='flex items-start gap-3'>
                  <Switch
                    id='oauth-consent-silent'
                    checked={silent}
                    onCheckedChange={setSilent}
                    disabled={busy}
                  />
                  <div className='space-y-1'>
                    <Label
                      htmlFor='oauth-consent-silent'
                      className='cursor-pointer text-sm'
                    >
                      {t('Do not ask me again for this application')}
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'New permissions always ask again, even when this is enabled.'
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {error ? (
          <p className='text-destructive text-sm' role='alert'>
            {error}
          </p>
        ) : null}
      </div>
    </AuthLayout>
  )
}
