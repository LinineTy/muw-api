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
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  deleteApplication,
  deleteMyApplication,
  getApplicationUsage,
  getMyApplications,
  getMyConsents,
  getOAuthStats,
  listApplicationsForReview,
  reviewApplication,
  revealApplicationSecret,
  revokeConsent,
  rotateApplicationSecret,
  setConsentSilent,
  submitApplication,
  updateApplication,
  updateApplicationStatus,
  type OAuthApplication,
  type OAuthApplicationUsageRow,
  type OAuthConsent,
  type OAuthStats,
} from './api'
import { SCOPE_LABELS, SUPPORTED_SCOPES } from './scopes'

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  disabled: 'Disabled',
}

const REVIEW_FILTERS = [
  { value: 'pending', label: 'Pending review' },
  { value: 'approved', label: 'Approved' },
  { value: 'disabled', label: 'Disabled' },
  { value: '', label: 'All' },
] as const

const emptyStats: OAuthStats = {
  applications: 0,
  authorizations: 0,
  token_issued: 0,
  last_issued_at: 0,
  active_users: 0,
}

// 第三方应用（OIDC 服务端）单页控制台：统计 + 我的应用 + 授权记录；
// 管理员在同一页多一段审核队列。应用详情（密钥/端点/资料/使用记录）走弹窗。
export function OAuthApplicationsPage() {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const isAdmin = role >= ROLE.ADMIN

  const [stats, setStats] = useState<OAuthStats>(emptyStats)
  const [statsScope, setStatsScope] = useState<'self' | 'all'>('self')
  const [applications, setApplications] = useState<OAuthApplication[]>([])
  const [consents, setConsents] = useState<OAuthConsent[]>([])
  const [reviewItems, setReviewItems] = useState<OAuthApplication[]>([])
  const [reviewFilter, setReviewFilter] = useState('pending')
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<OAuthApplication | null>(null)
  const [busy, setBusy] = useState(false)

  // 申请表单
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [redirectUris, setRedirectUris] = useState('')
  const [scopes, setScopes] = useState<string[]>(['openid', 'profile'])
  const [clientType, setClientType] = useState('public')
  const [reason, setReason] = useState('')

  // 详情弹窗
  const [secret, setSecret] = useState('')
  const [secretShown, setSecretShown] = useState(false)
  const [usageRows, setUsageRows] = useState<OAuthApplicationUsageRow[]>([])
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editHomepage, setEditHomepage] = useState('')
  const [editIcon, setEditIcon] = useState('')
  const [editRedirects, setEditRedirects] = useState('')

  const reload = useCallback(
    async (scope: 'self' | 'all', filter: string) => {
      try {
        const [summary, mine, mineConsents] = await Promise.all([
          getOAuthStats(scope),
          getMyApplications(),
          getMyConsents(),
        ])
        setStats(summary)
        setApplications(mine)
        setConsents(mineConsents)
        if (isAdmin) {
          setReviewItems(await listApplicationsForReview(filter))
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [isAdmin]
  )

  useEffect(() => {
    void reload(statsScope, reviewFilter)
  }, [reload, statsScope, reviewFilter])

  const copy = (value: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t('Copied')))
      .catch(() => toast.error(t('Copy failed')))
  }

  const openDetail = async (application: OAuthApplication) => {
    setDetail(application)
    setSecret('')
    setSecretShown(false)
    setUsageRows([])
    setEditName(application.name)
    setEditDescription(application.description)
    setEditHomepage(application.homepage_url ?? '')
    setEditIcon(application.icon_url ?? '')
    setEditRedirects(application.redirect_uris.join('\n'))
    try {
      setUsageRows(await getApplicationUsage(application.id))
    } catch {
      setUsageRows([])
    }
  }

  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await task()
      toast.success(done)
      await reload(statsScope, reviewFilter)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    await run(async () => {
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
      setCreateOpen(false)
      setName('')
      setDescription('')
      setRedirectUris('')
      setReason('')
    }, t('Application submitted, waiting for review'))
  }

  const saveProfile = async () => {
    if (!detail) {
      return
    }
    const status = await updateApplication(detail.id, {
      name: editName,
      description: editDescription,
      homepage_url: editHomepage,
      icon_url: editIcon,
      redirect_uris: editRedirects
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    })
    setDetail({ ...detail, status })
    toast.success(t('Saved'))
  }

  const endpoints = [
    { label: 'Authorization Endpoint', value: '/oauth/authorize' },
    { label: 'Token Endpoint', value: '/oauth/token' },
    { label: 'User Endpoint', value: '/oauth/userinfo' },
    { label: 'OIDC Discovery', value: '/.well-known/openid-configuration' },
  ]
  const issuer =
    typeof window === 'undefined' ? '' : window.location.origin

  return (
    <div className='flex flex-col gap-4 p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='text-lg font-semibold'>{t('Third-party applications')}</h1>
        <div className='flex items-center gap-2'>
          {isAdmin ? (
            <>
              <Button
                size='sm'
                variant={statsScope === 'self' ? 'default' : 'outline'}
                onClick={() => setStatsScope('self')}
              >
                {t('Only mine')}
              </Button>
              <Button
                size='sm'
                variant={statsScope === 'all' ? 'default' : 'outline'}
                onClick={() => setStatsScope('all')}
              >
                {t('Site-wide')}
              </Button>
            </>
          ) : null}
          <Button size='sm' onClick={() => setCreateOpen(true)}>
            {t('Apply for a new application')}
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
        {[
          { label: 'Applications', value: stats.applications },
          { label: 'Authorizations', value: stats.authorizations },
          { label: 'Tokens issued', value: stats.token_issued },
          { label: 'Active users', value: stats.active_users },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className='py-3'>
              <p className='text-muted-foreground text-xs'>{t(item.label)}</p>
              <p className='text-xl font-semibold'>{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('My applications')}</CardTitle>
          <CardDescription>
            {t('Apps you asked this site to sign users in with.')}
          </CardDescription>
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
                className='flex flex-wrap items-center gap-2 border-b pb-3 last:border-b-0 last:pb-0'
              >
                <span className='text-sm font-medium'>{application.name}</span>
                <Badge variant='secondary'>
                  {t(STATUS_LABELS[application.status] ?? application.status)}
                </Badge>
                <span className='text-muted-foreground font-mono text-xs'>
                  {application.client_id}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {application.last_used_at > 0
                    ? t('Last used {{time}}', {
                        time: new Date(
                          application.last_used_at * 1000
                        ).toLocaleString(),
                      })
                    : t('Never used')}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  className='ml-auto'
                  onClick={() => void openDetail(application)}
                >
                  {t('Details')}
                </Button>
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
                <span className='text-muted-foreground text-xs'>
                  {t('Last used {{time}}', {
                    time: new Date(consent.updated_at * 1000).toLocaleString(),
                  })}
                </span>
                <label className='flex items-center gap-2 text-xs'>
                  <Checkbox
                    checked={consent.silent}
                    onCheckedChange={(checked) =>
                      void run(
                        () =>
                          setConsentSilent(consent.client_id, checked === true),
                        t('Saved')
                      ).catch(() => undefined)
                    }
                  />
                  {t('Do not ask me again')}
                </label>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    void run(
                      () => revokeConsent(consent.client_id),
                      t('Authorization revoked')
                    ).catch(() => undefined)
                  }
                >
                  {t('Revoke')}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('Application review')}</CardTitle>
            <CardDescription>
              {t(
                'Applications only work after approval. Callback addresses are matched exactly.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <div className='flex flex-wrap gap-2'>
              {REVIEW_FILTERS.map((filter) => (
                <Button
                  key={filter.value}
                  size='sm'
                  variant={reviewFilter === filter.value ? 'default' : 'outline'}
                  onClick={() => setReviewFilter(filter.value)}
                >
                  {t(filter.label)}
                </Button>
              ))}
            </div>
            {reviewItems.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                {t('No applications')}
              </p>
            ) : (
              reviewItems.map((item) => (
                <div key={item.id} className='flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-sm font-medium'>{item.name}</span>
                    <Badge variant='secondary'>
                      {t(STATUS_LABELS[item.status] ?? item.status)}
                    </Badge>
                    <span className='text-muted-foreground font-mono text-xs'>
                      {item.client_id}
                    </span>
                    <span className='text-muted-foreground text-xs'>
                      {t('Requested by')}: {item.owner_username || '-'}
                    </span>
                  </div>
                  <span className='text-muted-foreground text-xs'>
                    {item.redirect_uris.join(' · ')}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {item.scopes
                      .map((scope) => t(SCOPE_LABELS[scope] ?? scope))
                      .join(' · ')}
                  </span>
                  {item.apply_reason ? (
                    <span className='text-xs'>{item.apply_reason}</span>
                  ) : null}
                  <Input
                    value={reviewNotes[item.id] ?? ''}
                    placeholder={t('Review note')}
                    onChange={(event) =>
                      setReviewNotes((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                  <div className='flex flex-wrap gap-2'>
                    {item.status === 'pending' ? (
                      <>
                        <Button
                          size='sm'
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                reviewApplication(item.id, {
                                  action: 'approve',
                                  scopes: item.scopes,
                                  redirect_uris: item.redirect_uris,
                                  allowed_groups: item.allowed_groups ?? [],
                                  note: reviewNotes[item.id] ?? '',
                                }),
                              t('Approved')
                            ).catch(() => undefined)
                          }
                        >
                          {t('Approve as applied')}
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                reviewApplication(item.id, {
                                  action: 'reject',
                                  note: reviewNotes[item.id] ?? '',
                                }),
                              t('Rejected')
                            ).catch(() => undefined)
                          }
                        >
                          {t('Reject')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              updateApplicationStatus(
                                item.id,
                                item.status === 'approved' ? 'disable' : 'approve',
                                reviewNotes[item.id] ?? ''
                              ),
                            item.status === 'approved'
                              ? t('Disabled')
                              : t('Approved')
                          ).catch(() => undefined)
                        }
                      >
                        {item.status === 'approved' ? t('Disable') : t('Enable')}
                      </Button>
                    )}
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(t('Delete this application?'))) {
                          return
                        }
                        void run(
                          () => deleteApplication(item.id),
                          t('Deleted')
                        ).catch(() => undefined)
                      }}
                    >
                      {t('Delete')}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
            <Button variant='outline' onClick={() => setCreateOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={busy || !name || !redirectUris}
              onClick={() => void create().catch(() => undefined)}
            >
              {t('Submit application')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detail !== null} onOpenChange={() => setDetail(null)}>
        <DialogContent className='max-h-[85vh] overflow-y-auto md:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            <DialogDescription>
              {t('Credentials and settings for this application.')}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className='flex flex-col gap-4'>
              <div className='flex flex-col gap-1.5'>
                <Label>Client ID</Label>
                <div className='flex items-center gap-2'>
                  <Input readOnly value={detail.client_id} />
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => copy(detail.client_id)}
                  >
                    {t('Copy')}
                  </Button>
                </div>
              </div>

              {detail.client_type === 'confidential' ? (
                <div className='flex flex-col gap-1.5'>
                  <Label>{t('Client secret')}</Label>
                  <div className='flex items-center gap-2'>
                    <Input
                      readOnly
                      type={secretShown ? 'text' : 'password'}
                      value={secret || '••••••••••••••••'}
                    />
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        if (secret) {
                          setSecretShown(!secretShown)
                          return
                        }
                        void revealApplicationSecret(detail.id)
                          .then((value) => {
                            setSecret(value)
                            setSecretShown(true)
                          })
                          .catch((cause: unknown) =>
                            toast.error(String(cause))
                          )
                      }}
                    >
                      {secretShown ? t('Hide') : t('Show')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={!secret}
                      onClick={() => copy(secret)}
                    >
                      {t('Copy')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        if (!window.confirm(t('Reset the secret? The old one stops working.'))) {
                          return
                        }
                        void rotateApplicationSecret(detail.id)
                          .then((value) => {
                            setSecret(value)
                            setSecretShown(true)
                            toast.success(
                              t('Secret reset. The old one no longer works.')
                            )
                          })
                          .catch((cause: unknown) => toast.error(String(cause)))
                      }}
                    >
                      {t('Reset secret')}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className='flex flex-col gap-1.5'>
                <Label>{t('Sign-in endpoints')}</Label>
                {endpoints.map((endpoint) => (
                  <div key={endpoint.label} className='flex items-center gap-2'>
                    <span className='text-muted-foreground w-44 shrink-0 text-xs'>
                      {endpoint.label}
                    </span>
                    <Input readOnly value={issuer + endpoint.value} />
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => copy(issuer + endpoint.value)}
                    >
                      {t('Copy')}
                    </Button>
                  </div>
                ))}
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='detail-name'>{t('Application name')}</Label>
                <Input
                  id='detail-name'
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='detail-homepage'>{t('Homepage')}</Label>
                <Input
                  id='detail-homepage'
                  value={editHomepage}
                  onChange={(event) => setEditHomepage(event.target.value)}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='detail-icon'>{t('Icon URL')}</Label>
                <Input
                  id='detail-icon'
                  value={editIcon}
                  onChange={(event) => setEditIcon(event.target.value)}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='detail-description'>{t('Description')}</Label>
                <Input
                  id='detail-description'
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='detail-redirects'>
                  {t('Redirect URIs, one per line')}
                </Label>
                <Textarea
                  id='detail-redirects'
                  rows={3}
                  value={editRedirects}
                  onChange={(event) => setEditRedirects(event.target.value)}
                />
                <span className='text-muted-foreground text-xs'>
                  {t('Changing these sends the application back to review.')}
                </span>
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label>{t('Usage by user')}</Label>
                {usageRows.length === 0 ? (
                  <span className='text-muted-foreground text-xs'>
                    {t('Never used')}
                  </span>
                ) : (
                  usageRows.map((row) => (
                    <span key={row.user_id} className='text-xs'>
                      #{row.user_id} · {row.token_count} ·{' '}
                      {new Date(row.last_issued_at * 1000).toLocaleString()}
                    </span>
                  ))
                )}
              </div>

              <div className='flex flex-wrap justify-between gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    if (!window.confirm(t('Delete this application?'))) {
                      return
                    }
                    void run(
                      () => deleteMyApplication(detail.id),
                      t('Deleted')
                    )
                      .then(() => setDetail(null))
                      .catch(() => undefined)
                  }}
                >
                  {t('Delete')}
                </Button>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setDetail(null)}
                  >
                    {t('Cancel')}
                  </Button>
                  <Button
                    size='sm'
                    disabled={busy}
                    onClick={() => void saveProfile().catch(() => undefined)}
                  >
                    {t('Save')}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
