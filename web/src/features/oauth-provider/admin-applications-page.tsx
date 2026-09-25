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
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

import {
  deleteApplication,
  listApplicationsForReview,
  reviewApplication,
  updateApplicationStatus,
  type OAuthApplication,
} from './api'
import { SCOPE_LABELS } from './scopes'

const FILTERS = [
  { value: 'pending', label: 'Waiting for review' },
  { value: 'approved', label: 'Approved' },
  { value: 'disabled', label: 'Disabled' },
  { value: '', label: 'All' },
] as const

// 管理员审核页：待审队列 + 批准（按申请内容或改过的 scope/回调地址）+ 驳回/禁用/删除。
// 批准 confidential 应用时，明文密钥只在此页显示一次，离开即不可再取。
export function OAuthAdminApplicationsPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<string>('pending')
  const [items, setItems] = useState<OAuthApplication[]>([])
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [approved, setApproved] = useState<{ clientId: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (next: string) => {
    try {
      setItems(await listApplicationsForReview(next))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void reload(status)
  }, [reload, status])

  const run = async (task: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await task()
      toast.success(done)
      await reload(status)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const approve = (item: OAuthApplication) =>
    run(async () => {
      const result = await reviewApplication(item.id, {
        action: 'approve',
        scopes: item.scopes,
        redirect_uris: item.redirect_uris,
        allowed_groups: item.allowed_groups ?? [],
        note: notes[item.id] ?? '',
      })
      setApproved({ clientId: result.client_id })
    }, t('Approved'))

  const reject = (item: OAuthApplication) =>
    run(
      () =>
        reviewApplication(item.id, {
          action: 'reject',
          note: notes[item.id] ?? '',
        }).then(() => undefined),
      t('Rejected')
    )

  const setEnabled = (item: OAuthApplication, enable: boolean) =>
    run(
      () =>
        updateApplicationStatus(
          item.id,
          enable ? 'approve' : 'disable',
          notes[item.id] ?? ''
        ),
      enable ? t('Approved') : t('Disabled')
    )

  const remove = (item: OAuthApplication) => {
    if (!window.confirm(t('Delete this application?'))) {
      return
    }
    void run(() => deleteApplication(item.id), t('Deleted'))
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
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
            {FILTERS.map((filter) => (
              <Button
                key={filter.value}
                variant={status === filter.value ? 'default' : 'outline'}
                size='sm'
                onClick={() => setStatus(filter.value)}
              >
                {t(filter.label)}
              </Button>
            ))}
          </div>

          {approved ? (
            <div className='border-primary/40 bg-primary/5 flex flex-col gap-1 rounded-md border p-3'>
              <span className='text-sm font-medium'>
                {t('Application approved')}
              </span>
              {/* client_id 必须留在这里：批准后条目会从「待审核」列表消失，不给出来就没地方看了 */}
              <code className='font-mono text-xs break-all'>
                {approved.clientId}
              </code>
              {/* 密钥不经过管理员：申请人可在「第三方应用」页自行查看/重置 */}
              <span className='text-muted-foreground text-xs'>
                {t('The applicant can view or reset the secret themselves.')}
              </span>
            </div>
          ) : null}

          {items.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t('No applications')}
            </p>
          ) : (
            items.map((item) => (
              <div key={item.id} className='flex flex-col gap-2'>
                <Separator />
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm font-medium'>{item.name}</span>
                  <Badge variant='secondary'>
                    {t(item.client_type === 'public' ? 'Public client (no secret, uses PKCE)' : 'Confidential client (server side, with a secret)')}
                  </Badge>
                  <span className='text-muted-foreground font-mono text-xs'>
                    {item.client_id}
                  </span>
                </div>
                <span className='text-muted-foreground text-xs'>
                  {t('Requested by')}: {item.owner_username || '-'} ·{' '}
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
                  value={notes[item.id] ?? ''}
                  placeholder={t('Review note')}
                  onChange={(event) =>
                    setNotes((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                />
                <div className='flex flex-wrap gap-2'>
                  {item.status === 'pending' ? (
                    <>
                      <Button size='sm' disabled={busy} onClick={() => approve(item)}>
                        {t('Approve as applied')}
                      </Button>
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={busy}
                        onClick={() => reject(item)}
                      >
                        {t('Reject')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy}
                      onClick={() => setEnabled(item, item.status !== 'approved')}
                    >
                      {item.status === 'approved' ? t('Disable') : t('Enable')}
                    </Button>
                  )}
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={busy}
                    onClick={() => remove(item)}
                  >
                    {t('Delete')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
