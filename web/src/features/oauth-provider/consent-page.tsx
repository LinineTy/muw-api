// @muw-owned
import { Check, Globe, PlugZap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AuthLayout } from '@/features/auth/auth-layout'
import { AuthCard } from '@/features/auth/components/auth-card'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  getConsentPreview,
  submitConsentDecision,
  type OAuthConsentPreview,
} from './api'
import { SCOPE_LABELS } from './scopes'

/** 同意页排布：card=单卡（默认）；stacked=居中分卡；split=宽屏双栏 */
export type ConsentLayout = 'card' | 'stacked' | 'split'

// 授权确认页：第三方应用拿本站账号登录时，用户在这里决定给不给。
// 独立成页（不进桌面壳），顶/底与登录页同一套；默认每次都会问，
// 用户勾了「以后不再询问」才会静默放行，且应用新增 scope 时仍会回来问。
export function OAuthConsentPage({
  request,
  layout = 'card',
}: {
  request: string
  layout?: ConsentLayout
}) {
  const { t } = useTranslation()
  const { auth } = useAuthStore()
  const [preview, setPreview] = useState<OAuthConsentPreview | null>(null)
  const [error, setError] = useState('')
  const [silent, setSilent] = useState(false)
  const [busy, setBusy] = useState(false)

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

  const username = auth.user?.username ?? ''

  // 加载/出错时没有预览数据：仍按同一套骨架给一句话，别让页面跳版。
  if (!preview) {
    const message = error ? error : t('Checking the authorization request…')
    return (
      <AuthLayout>
        <AuthCard
          title={error ? t('Authorize application') : message}
          subtitle={
            error
              ? undefined
              : t('Start the sign-in from the application that sent you here.')
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
      <span className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium uppercase'>
        {username.slice(0, 1)}
      </span>
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
          {t('Requested by {{username}}', {
            username: preview.owner_username,
          })}
        </p>
      ) : null}
    </div>
  )

  const permissions = (
    <div className='space-y-2'>
      <p className='text-sm font-medium'>
        {t('This application will be able to:')}
      </p>
      <ul className='bg-muted/40 space-y-2 rounded-xl p-3'>
        {preview.scopes.map((scope) => (
          <li key={scope} className='flex items-center gap-2 text-sm'>
            <Check className='text-success size-4 shrink-0' />
            {t(SCOPE_LABELS[scope] ?? scope)}
          </li>
        ))}
      </ul>
    </div>
  )

  const silentSwitch = (
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
          {t('New permissions always ask again, even when this is enabled.')}
        </p>
      </div>
    </div>
  )

  const actions = (stacked: boolean) => (
    <div className={cn('flex gap-2', stacked ? 'flex-col' : 'flex-row')}>
      <Button className='flex-1' disabled={busy} onClick={() => decide(true)}>
        {t('Allow')}
      </Button>
      <Button
        variant='outline'
        className='flex-1'
        disabled={busy}
        onClick={() => decide(false)}
      >
        {t('Deny')}
      </Button>
    </div>
  )

  const hero = (
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
          {t('{{name}} wants to sign you in', { name: preview.client_name })}
        </h2>
        <p className='text-muted-foreground text-sm'>
          {t('You will return to {{host}} after confirming.', {
            host: preview.redirect_host,
          })}
        </p>
      </div>
    </div>
  )

  if (layout === 'stacked') {
    return (
      <AuthLayout>
        <div className='flex flex-col gap-5'>
          {hero}
          <Card data-card-hover='false' className='gap-0 py-0'>
            <CardContent className='grid gap-3.5 px-[22px] pt-6 pb-6'>
              {identity}
              {appInfo}
              {permissions}
              {silentSwitch}
            </CardContent>
          </Card>
          {actions(true)}
          {error ? (
            <p className='text-destructive text-sm' role='alert'>
              {error}
            </p>
          ) : null}
        </div>
      </AuthLayout>
    )
  }

  if (layout === 'split') {
    return (
      <AuthLayout contentWidthClassName='sm:w-[720px]'>
        <div className='flex flex-col gap-5'>
          {hero}
          <div className='grid gap-3.5 lg:grid-cols-2'>
            <Card data-card-hover='false' className='gap-0 py-0'>
              <CardContent className='grid gap-3.5 px-[22px] pt-6 pb-6'>
                {identity}
                {appInfo}
              </CardContent>
            </Card>
            <Card data-card-hover='false' className='gap-0 py-0'>
              <CardContent className='grid gap-3.5 px-[22px] pt-6 pb-6'>
                {permissions}
                {silentSwitch}
              </CardContent>
            </Card>
          </div>
          {actions(false)}
          {error ? (
            <p className='text-destructive text-sm' role='alert'>
              {error}
            </p>
          ) : null}
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthCard
        title={
          <span className='flex items-center gap-3'>
            {preview.client_icon_url ? (
              <img
                src={preview.client_icon_url}
                alt=''
                className='size-7 rounded-lg object-cover'
              />
            ) : null}
            <span>
              {t('{{name}} wants to sign you in', {
                name: preview.client_name,
              })}
            </span>
          </span>
        }
        subtitle={t('You will return to {{host}} after confirming.', {
          host: preview.redirect_host,
        })}
      >
        {error ? (
          <p className='text-destructive text-sm' role='alert'>
            {error}
          </p>
        ) : null}
        {identity}
        {appInfo}
        {permissions}
        {silentSwitch}
        {actions(true)}
      </AuthCard>
    </AuthLayout>
  )
}
