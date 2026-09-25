// @muw-owned
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  getMyApplications,
  getMyConsents,
  revokeConsent,
  setConsentSilent,
  submitApplication,
  type OAuthApplication,
  type OAuthConsent,
} from './api'
import { SCOPE_LABELS, SUPPORTED_SCOPES } from './scopes'

// 站内用户自助页：申请第三方应用接入本站身份 + 管理自己已给出的授权。
// 申请提交后是 pending（管理员审核通过才生效）；「以后不再询问」的开关在这里改。
export function OAuthApplicationsPage() {
  const { t } = useTranslation()
  const [applications, setApplications] = useState<OAuthApplication[]>([])
  const [consents, setConsents] = useState<OAuthConsent[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [redirectUris, setRedirectUris] = useState('')
  const [scopes, setScopes] = useState<string[]>(['openid', 'profile'])
  const [clientType, setClientType] = useState('public')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [mine, mineConsents] = await Promise.all([
        getMyApplications(),
        getMyConsents(),
      ])
      setApplications(mine)
      setConsents(mineConsents)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggleScope = (scope: string, checked: boolean) => {
    setScopes((current) =>
      checked
        ? Array.from(new Set([...current, scope]))
        : current.filter((item) => item !== scope)
    )
  }

  const submit = async () => {
    setBusy(true)
    try {
      await submitApplication({
        name,
        description,
        redirect_uris: redirectUris
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        scopes,
        client_type: clientType,
        apply_reason: reason,
      })
      toast.success(t('Application submitted, waiting for review'))
      setName('')
      setDescription('')
      setRedirectUris('')
      setReason('')
      await reload()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const toggleSilent = async (clientId: string, silent: boolean) => {
    try {
      await setConsentSilent(clientId, silent)
      await reload()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const revoke = async (clientId: string) => {
    try {
      await revokeConsent(clientId)
      toast.success(t('Authorization revoked'))
      await reload()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Apply for a new application')}</CardTitle>
          <CardDescription>
            {t(
              'Applications stay unusable until an administrator approves them.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='oidc-name'>{t('Application name')}</Label>
            <Input
              id='oidc-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='oidc-description'>{t('Description')}</Label>
            <Input
              id='oidc-description'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='oidc-redirects'>
              {t('Redirect URIs, one per line')}
            </Label>
            <Textarea
              id='oidc-redirects'
              rows={3}
              value={redirectUris}
              placeholder='https://app.example.com/callback'
              onChange={(event) => setRedirectUris(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label>{t('Application type')}</Label>
            <div className='flex flex-col gap-2 text-sm'>
              <label className='flex items-center gap-2'>
                <Checkbox
                  checked={clientType === 'public'}
                  onCheckedChange={() => setClientType('public')}
                />
                {t('Public client (no secret, uses PKCE)')}
              </label>
              <label className='flex items-center gap-2'>
                <Checkbox
                  checked={clientType === 'confidential'}
                  onCheckedChange={() => setClientType('confidential')}
                />
                {t('Confidential client (server side, with a secret)')}
              </label>
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            <Label>{t('Requested scopes')}</Label>
            <div className='flex flex-col gap-2 text-sm'>
              {SUPPORTED_SCOPES.map((scope) => (
                <label key={scope} className='flex items-center gap-2'>
                  <Checkbox
                    checked={scopes.includes(scope)}
                    disabled={scope === 'openid'}
                    onCheckedChange={(checked) =>
                      toggleScope(scope, checked === true)
                    }
                  />
                  {t(SCOPE_LABELS[scope])}
                </label>
              ))}
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='oidc-reason'>{t('Reason for the request')}</Label>
            <Textarea
              id='oidc-reason'
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className='flex justify-end'>
            <Button disabled={busy || !name || !redirectUris} onClick={submit}>
              {t('Submit application')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('My applications')}</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          {applications.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t('No applications yet')}
            </p>
          ) : (
            applications.map((application) => (
              <div
                key={application.id}
                className='flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0'
              >
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-medium'>
                    {application.name}
                  </span>
                  <Badge variant='secondary'>
                    {t(STATUS_LABELS[application.status] ?? application.status)}
                  </Badge>
                </div>
                <span className='text-muted-foreground font-mono text-xs'>
                  {application.client_id}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {application.redirect_uris.join(' · ')}
                </span>
                {application.review_note ? (
                  <span className='text-destructive text-xs'>
                    {application.review_note}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('My authorizations')}</CardTitle>
          <CardDescription>
            {t(
              'Applications you signed in to. Revoking stops future sign-ins.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          {consents.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t('No authorizations yet')}
            </p>
          ) : (
            consents.map((consent) => (
              <div
                key={consent.client_id}
                className='flex flex-wrap items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0'
              >
                <span className='text-sm font-medium'>
                  {consent.client_name}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {consent.scopes
                    .map((scope) => t(SCOPE_LABELS[scope] ?? scope))
                    .join(' · ')}
                </span>
                <label className='flex items-center gap-2 text-xs'>
                  <Checkbox
                    checked={consent.silent}
                    onCheckedChange={(checked) =>
                      toggleSilent(consent.client_id, checked === true)
                    }
                  />
                  {t('Do not ask me again')}
                </label>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => revoke(consent.client_id)}
                >
                  {t('Revoke')}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  disabled: 'Disabled',
}
