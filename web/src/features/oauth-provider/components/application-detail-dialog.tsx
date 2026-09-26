// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { TimestampCell } from '@/components/activity-time-cell'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  getApplicationUsage,
  revealApplicationSecret,
  rotateApplicationSecret,
  updateApplication,
  type OAuthApplication,
} from '../api'
import { OAUTH_QUERY_KEY } from '../constants'

const ENDPOINTS = [
  { label: 'Authorization Endpoint', path: '/oauth/authorize' },
  { label: 'Token Endpoint', path: '/oauth/token' },
  { label: 'User Endpoint', path: '/oauth/userinfo' },
  { label: 'OIDC Discovery', path: '/.well-known/openid-configuration' },
] as const

export function ApplicationDetailDialog(props: {
  application: OAuthApplication | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const application = props.application
  const applicationId = application?.id ?? 0

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [homepage, setHomepage] = useState('')
  const [iconUrl, setIconUrl] = useState('')
  const [redirectUris, setRedirectUris] = useState('')
  // 只有通过审核的应用才持有可用凭据：待审核/驳回/禁用的应用连 Client ID 与
  // 登录端点都不展示 —— 否则看起来像"已经能用"，还会诱导申请人去重置密钥。
  const usable = application?.status === 'approved'
  const [secret, setSecret] = useState('')
  const [secretShown, setSecretShown] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  useEffect(() => {
    if (!application) return
    setName(application.name)
    setDescription(application.description)
    setHomepage(application.homepage_url ?? '')
    setIconUrl(application.icon_url ?? '')
    setRedirectUris(application.redirect_uris.join('\n'))
    setSecret('')
    setSecretShown(false)
  }, [application])

  const usageQuery = useQuery({
    queryKey: [...OAUTH_QUERY_KEY, 'usage', applicationId],
    queryFn: () => getApplicationUsage(applicationId),
    enabled: applicationId > 0,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      updateApplication(applicationId, {
        name,
        description,
        homepage_url: homepage,
        icon_url: iconUrl,
        redirect_uris: redirectUris
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    onSuccess: async (status) => {
      toast.success(t('Saved'))
      if (status !== application?.status) {
        toast.info(t('Changing these sends the application back to review.'))
      }
      await queryClient.invalidateQueries({ queryKey: OAUTH_QUERY_KEY })
    },
  })

  const revealMutation = useMutation({
    mutationFn: () => revealApplicationSecret(applicationId),
    onSuccess: (value) => {
      setSecret(value)
      setSecretShown(true)
    },
  })

  const rotateMutation = useMutation({
    mutationFn: () => rotateApplicationSecret(applicationId),
    onSuccess: (value) => {
      setSecret(value)
      setSecretShown(true)
      setResetOpen(false)
      toast.success(t('Secret reset. The old one no longer works.'))
    },
  })

  const issuer = typeof window === 'undefined' ? '' : window.location.origin
  const usageRows = usageQuery.data ?? []
  const isConfidential = application?.client_type === 'confidential'

  return (
    <>
      <Dialog
        open={application !== null}
        onOpenChange={props.onOpenChange}
        title={application?.name ?? ''}
        description={t('Credentials and settings for this application.')}
        footer={
          <>
            <Button variant='outline' onClick={() => props.onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {t('Save')}
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-4'>
          {!usable ? (
            <p className='text-muted-foreground rounded-lg border border-dashed p-3 text-sm'>
              {t(
                'Client ID, secret and sign-in endpoints appear here once an administrator approves this application.'
              )}
            </p>
          ) : null}
          {usable ? (
            <>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='oauth-detail-client-id'>Client ID</Label>
                <div className='flex items-center gap-2'>
                  <Input
                    id='oauth-detail-client-id'
                    readOnly
                    value={application?.client_id ?? ''}
                  />
                  <CopyButton value={application?.client_id ?? ''} />
                </div>
              </div>

              {isConfidential ? (
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='oauth-detail-secret'>
                    {t('Client secret')}
                  </Label>
                  <div className='flex items-center gap-2'>
                    <Input
                      id='oauth-detail-secret'
                      readOnly
                      type={secretShown ? 'text' : 'password'}
                      value={secret || '••••••••••••••••'}
                    />
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={revealMutation.isPending}
                      onClick={() => {
                        if (secret) {
                          setSecretShown(!secretShown)
                          return
                        }
                        revealMutation.mutate()
                      }}
                    >
                      {secretShown ? t('Hide') : t('Show')}
                    </Button>
                    {secret ? <CopyButton value={secret} /> : null}
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setResetOpen(true)}
                    >
                      {t('Reset secret')}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className='flex flex-col gap-1.5'>
                <Label>{t('Sign-in endpoints')}</Label>
                {ENDPOINTS.map((endpoint) => (
                  <div key={endpoint.label} className='flex items-center gap-2'>
                    <span className='text-muted-foreground w-44 shrink-0 text-xs'>
                      {t(endpoint.label)}
                    </span>
                    <Input readOnly value={issuer + endpoint.path} />
                    <CopyButton value={issuer + endpoint.path} />
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oauth-detail-name'>{t('Application name')}</Label>
            <Input
              id='oauth-detail-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oauth-detail-homepage'>{t('Homepage')}</Label>
            <Input
              id='oauth-detail-homepage'
              value={homepage}
              onChange={(event) => setHomepage(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oauth-detail-icon'>{t('Icon URL')}</Label>
            <Input
              id='oauth-detail-icon'
              value={iconUrl}
              onChange={(event) => setIconUrl(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oauth-detail-description'>{t('Description')}</Label>
            <Input
              id='oauth-detail-description'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='oauth-detail-redirects'>
              {t('Redirect URIs, one per line')}
            </Label>
            <Textarea
              id='oauth-detail-redirects'
              rows={3}
              value={redirectUris}
              onChange={(event) => setRedirectUris(event.target.value)}
            />
            <span className='text-muted-foreground text-xs'>
              {t('Changing these sends the application back to review.')}
            </span>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label>{t('Usage by user')}</Label>
            <StaticDataTable
              data={usageRows}
              getRowKey={(row) => row.user_id}
              empty={usageRows.length === 0}
              emptyContent={
                <span className='text-muted-foreground text-xs'>
                  {t('Never used')}
                </span>
              }
              columns={[
                {
                  id: 'user',
                  header: t('User'),
                  cell: (row) => `#${row.user_id}`,
                },
                {
                  id: 'tokens',
                  header: t('Tokens'),
                  cell: (row) => formatNumber(row.token_count, locale),
                },
                {
                  id: 'last_used_at',
                  header: t('Last Used'),
                  cell: (row) => (
                    <TimestampCell
                      timestamp={row.last_issued_at}
                      locale={locale}
                      justNowLabel={t('Just now')}
                    />
                  ),
                },
              ]}
            />
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t('Reset secret')}
        desc={t('Reset the secret? The old one stops working.')}
        destructive
        isLoading={rotateMutation.isPending}
        handleConfirm={() => rotateMutation.mutate()}
      />
    </>
  )
}
