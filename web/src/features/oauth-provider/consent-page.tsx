// @muw-owned
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'

import {
  getConsentPreview,
  submitConsentDecision,
  type OAuthConsentPreview,
} from './api'

// 授权确认页：第三方应用拿本站账号登录时，用户在这里决定给不给。
// 默认每次都会问；用户勾了「以后不再询问」才会静默放行，且应用新增 scope 时仍会回来问。
const SCOPE_LABELS: Record<string, string> = {
  openid: 'Confirm that you are signed in to this site',
  profile: 'Read your username, display name and avatar',
  email: 'Read your email address',
  group: 'Read your group and subscription tier',
  offline_access: 'Keep access while the application refreshes it in the background',
}

export function OAuthConsentPage({ request }: { request: string }) {
  const { t } = useTranslation()
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

  return (
    <div className='flex min-h-[60vh] items-center justify-center p-4'>
      <Card className='w-full max-w-lg'>
        <CardHeader>
          <CardTitle>
            {preview
              ? t('{{name}} wants to sign you in', { name: preview.client_name })
              : t('Authorize application')}
          </CardTitle>
          <CardDescription>
            {preview
              ? t('You will return to {{host}} after confirming.', {
                  host: preview.redirect_host,
                })
              : t('Checking the authorization request…')}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          {error ? (
            <p className='text-destructive text-sm' role='alert'>
              {error}
            </p>
          ) : null}

          {preview ? (
            <>
              {preview.description ? (
                <p className='text-muted-foreground text-sm'>
                  {preview.description}
                </p>
              ) : null}
              {preview.owner_username ? (
                <p className='text-muted-foreground text-sm'>
                  {t('Requested by {{username}}', {
                    username: preview.owner_username,
                  })}
                </p>
              ) : null}
              <div className='flex flex-col gap-2'>
                <p className='text-sm font-medium'>
                  {t('This application will be able to:')}
                </p>
                <ul className='flex flex-col gap-1.5'>
                  {preview.scopes.map((scope) => (
                    <li key={scope} className='text-sm'>
                      {t(SCOPE_LABELS[scope] ?? scope)}
                    </li>
                  ))}
                </ul>
              </div>
              <label className='flex items-center gap-2 text-sm'>
                <Checkbox
                  checked={silent}
                  onCheckedChange={(checked) => setSilent(checked === true)}
                  disabled={busy}
                />
                {t('Do not ask me again for this application')}
              </label>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'New permissions always ask again, even when this is enabled.'
                )}
              </p>
            </>
          ) : null}
        </CardContent>
        <CardFooter className='flex justify-end gap-2'>
          <Button
            variant='outline'
            disabled={busy || !preview}
            onClick={() => decide(false)}
          >
            {t('Deny')}
          </Button>
          <Button disabled={busy || !preview} onClick={() => decide(true)}>
            {t('Allow')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
