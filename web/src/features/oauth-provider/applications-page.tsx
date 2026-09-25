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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  getMyApplications,
  getMyConsents,
  revokeConsent,
  revealApplicationSecret,
  rotateApplicationSecret,
  setConsentSilent,
  submitApplication,
  type OAuthApplication,
  type OAuthConsent,
} from './api'
import { SCOPE_LABELS, SUPPORTED_SCOPES } from './scopes'

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  disabled: 'Disabled',
}

// 第三方应用自助页：主体是「我的应用」与「授权记录」，申请只是右上角的一个动作。
export function OAuthApplicationsPage() {
  const { t } = useTranslation()
  const [applications, setApplications] = useState<OAuthApplication[]>([])
  const [consents, setConsents] = useState<OAuthConsent[]>([])
  const [secrets, setSecrets] = useState<Record<number, string>>({})
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [redirectUris, setRedirectUris] = useState('')
  const [scopes, setScopes] = useState<string[]>(['openid', 'profile'])
  const [clientType, setClientType] = useState('public')
  const [reason, setReason] = useState('')

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
      setOpen(false)
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

  const reveal = async (id: number) => {
    try {
      const secret = await revealApplicationSecret(id)
      setSecrets((current) => ({ ...current, [id]: secret }))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const rotate = async (id: number) => {
    if (!window.confirm(t('Reset the secret? The old one stops working.'))) {
      return
    }
    try {
      const secret = await rotateApplicationSecret(id)
      setSecrets((current) => ({ ...current, [id]: secret }))
      toast.success(t('Secret reset. The old one no longer works.'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
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
      <div className='flex items-center justify-between'>
        <h1 className='text-lg font-semibold'>{t('Third-party applications')}</h1>
        <Button size='sm' onClick={() => setOpen(true)}>
          {t('Apply for a new application')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('My applications')}</CardTitle>
          <CardDescription>
            {t('Apps you asked this site to sign users in with.')}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          {applications.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t('No applications yet')}
            </p>
          ) : (
            applications.map((application) => (
              <div key={application.id} className='flex flex-col gap-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm font-medium'>{application.name}</span>
                  <Badge variant='secondary'>
                    {t(STATUS_LABELS[application.status] ?? application.status)}
                  </Badge>
                  <Badge variant='outline'>
                    {application.client_type === 'public'
                      ? t('Public client (no secret, uses PKCE)')
                      : t('Confidential client (server side, with a secret)')}
                  </Badge>
                  <span className='text-muted-foreground text-xs'>
                    {application.last_used_at > 0
                      ? t('Last used {{time}}', {
                          time: new Date(
                            application.last_used_at * 1000
                          ).toLocaleString(),
                        })
                      : t('Never used')}
                  </span>
                </div>
                <span className='text-muted-foreground font-mono text-xs'>
                  {application.client_id}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {application.redirect_uris.join(' · ')}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {application.scopes
                    .map((scope) => t(SCOPE_LABELS[scope] ?? scope))
                    .join(' · ')}
                </span>
                {application.review_note ? (
                  <span className='text-destructive text-xs'>
                    {application.review_note}
                  </span>
                ) : null}
                {application.status === 'approved' &&
                application.client_type === 'confidential' ? (
                  <div className='flex flex-wrap items-center gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => reveal(application.id)}
                    >
                      {t('View secret')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => rotate(application.id)}
                    >
                      {t('Reset secret')}
                    </Button>
                    {secrets[application.id] ? (
                      <code className='bg-muted rounded px-2 py-1 font-mono text-xs break-all'>
                        {secrets[application.id]}
                      </code>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Authorization records')}</CardTitle>
          <CardDescription>
            {t('Where your account was used to sign in.')}
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
                className='flex flex-wrap items-center gap-3'
              >
                <span className='text-sm font-medium'>
                  {consent.client_name}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {consent.scopes
                    .map((scope) => t(SCOPE_LABELS[scope] ?? scope))
                    .join(' · ')}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {t('Last used {{time}}', {
                    time: new Date(consent.updated_at * 1000).toLocaleString(),
                  })}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>{t('Apply for a new application')}</DialogTitle>
            <DialogDescription>
              {t(
                'Applications stay unusable until an administrator approves them.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='oidc-name'>{t('Application name')}</Label>
              <Input
                id='oidc-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='oidc-description'>{t('Description')}</Label>
              <Input
                id='oidc-description'
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
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
            <div className='flex flex-col gap-1.5'>
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
            <div className='flex flex-col gap-1.5'>
              <Label>{t('Requested scopes')}</Label>
              <div className='flex flex-col gap-2 text-sm'>
                {SUPPORTED_SCOPES.map((scope) => (
                  <label key={scope} className='flex items-center gap-2'>
                    <Checkbox
                      checked={scopes.includes(scope)}
                      disabled={scope === 'openid'}
                      onCheckedChange={(checked) =>
                        setScopes((current) =>
                          checked === true
                            ? Array.from(new Set([...current, scope]))
                            : current.filter((item) => item !== scope)
                        )
                      }
                    />
                    {t(SCOPE_LABELS[scope])}
                  </label>
                ))}
              </div>
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='oidc-reason'>{t('Reason for the request')}</Label>
              <Textarea
                id='oidc-reason'
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button disabled={busy || !name || !redirectUris} onClick={submit}>
              {t('Submit application')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
