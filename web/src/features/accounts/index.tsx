/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { CHANNEL_TYPE_OPTIONS } from '@/features/channels/constants'
import { formatCurrencyUSD } from '@/lib/format'

import {
  createAccount,
  deleteAccount,
  getAccount,
  getAccounts,
  updateAccount,
} from './api'
import { ACCOUNT_STATUS, type AccountListItem } from './types'

const ACCOUNTS_QUERY_KEY = ['accounts'] as const
const PAGE_SIZE = 20

function typeLabel(type: number): string {
  const option = CHANNEL_TYPE_OPTIONS.find((o) => o.value === type)
  return option?.label ?? String(type)
}

function StatusBadge({ status }: { status: number }) {
  const { t } = useTranslation()
  if (status === ACCOUNT_STATUS.ENABLED) {
    return (
      <span className='inline-flex items-center gap-1.5 text-xs'>
        <span className='size-1.5 rounded-full bg-emerald-500' />
        {t('Enabled')}
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1.5 text-xs'>
      <span className='bg-destructive size-1.5 rounded-full' />
      {status === ACCOUNT_STATUS.AUTO_DISABLED
        ? t('Auto Disabled')
        : t('Manually Disabled')}
    </span>
  )
}

export function Accounts() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: [...ACCOUNTS_QUERY_KEY, page, keyword],
    queryFn: () => getAccounts({ p: page, page_size: PAGE_SIZE, keyword }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
    onSuccess: () => invalidate(),
  })

  const items: AccountListItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const openCreate = () => {
    setEditingId(null)
    setDrawerOpen(true)
  }
  const openEdit = (id: number) => {
    setEditingId(id)
    setDrawerOpen(true)
  }

  const ACCOUNTS_SKELETON_IDS = Array.from(
    { length: 5 },
    (_, index) => `accounts-skeleton-${index + 1}`
  )

  const renderSkeletonRows = () =>
    ACCOUNTS_SKELETON_IDS.map((id) => (
      <tr key={id}>
        <td className='px-3 py-2' colSpan={7}>
          <Skeleton className='h-6 w-full' />
        </td>
      </tr>
    ))

  const renderEmptyRow = () => (
    <tr>
      <td className='text-muted-foreground px-3 py-8 text-center' colSpan={7}>
        {t('No accounts yet')}
      </td>
    </tr>
  )

  const renderItemRows = () =>
    items.map(({ account, channel_count: channelCount }) => (
      <tr key={account.id} className='hover:bg-muted/30'>
        <td className='max-w-48 truncate px-3 py-2 font-medium'>
          {account.name}
          {account.auto_generated && (
            <span className='text-muted-foreground ml-1 text-xs'>
              ({t('Auto')})
            </span>
          )}
        </td>
        <td className='px-3 py-2'>{typeLabel(account.type)}</td>
        <td className='max-w-44 truncate px-3 py-2'>
          <span className='inline-flex items-center gap-1 font-mono text-xs'>
            <KeyRound className='text-muted-foreground size-3' />
            {account.key_masked || '-'}
            {account.channel_info?.is_multi_key && (
              <span className='bg-muted rounded px-1 text-[10px]'>
                {t('Multi')} {account.channel_info.multi_key_size}
              </span>
            )}
          </span>
        </td>
        <td className='px-3 py-2'>
          <StatusBadge status={account.status} />
        </td>
        <td className='px-3 py-2 tabular-nums'>
          {formatCurrencyUSD(account.balance)}
        </td>
        <td className='px-3 py-2 tabular-nums'>{channelCount}</td>
        <td className='px-3 py-2 text-right'>
          <div className='flex justify-end gap-1'>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => openEdit(account.id)}
              title={t('Edit')}
            >
              <Pencil className='size-3.5' />
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              disabled={channelCount > 0}
              onClick={() => deleteMutation.mutate(account.id)}
              title={
                channelCount > 0
                  ? t('Account is referenced by channels')
                  : t('Delete')
              }
            >
              <Trash2 className='size-3.5' />
            </Button>
          </div>
        </td>
      </tr>
    ))

  const renderBody = () => {
    if (isLoading) return renderSkeletonRows()
    if (items.length === 0) return renderEmptyRow()
    return renderItemRows()
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Accounts')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <div className='flex items-center gap-2'>
            <Input
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value)
                setPage(1)
              }}
              placeholder={t('Search accounts...')}
              className='h-8 w-56'
            />
            <Button size='sm' onClick={openCreate}>
              <Plus className='size-4' />
              {t('Add Account')}
            </Button>
          </div>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='border-border overflow-hidden rounded-lg border'>
            <table className='w-full text-sm'>
              <thead className='bg-muted/50 text-muted-foreground'>
                <tr>
                  <th className='px-3 py-2 text-left font-medium'>
                    {t('Name')}
                  </th>
                  <th className='px-3 py-2 text-left font-medium'>
                    {t('Provider')}
                  </th>
                  <th className='px-3 py-2 text-left font-medium'>
                    {t('Key')}
                  </th>
                  <th className='px-3 py-2 text-left font-medium'>
                    {t('Status')}
                  </th>
                  <th className='px-3 py-2 text-left font-medium'>
                    {t('Balance')}
                  </th>
                  <th className='px-3 py-2 text-left font-medium'>
                    {t('Channels')}
                  </th>
                  <th className='px-3 py-2 text-right font-medium'>
                    {t('Actions')}
                  </th>
                </tr>
              </thead>
              <tbody className='divide-border divide-y'>
                {renderBody()}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className='flex items-center justify-end gap-2 px-1 py-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('Previous')}
              </Button>
              <span className='text-muted-foreground text-xs'>
                {page} / {totalPages}
              </span>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <AccountMutateDrawer
        open={drawerOpen}
        onOpenChange={(isOpen) => !isOpen && setDrawerOpen(false)}
        accountId={editingId}
        onSaved={() => {
          setDrawerOpen(false)
          invalidate()
        }}
      />
    </>
  )
}

// ── 创建/编辑抽屉 ───────────────────────────────────────────────

function AccountMutateDrawer({
  open,
  onOpenChange,
  accountId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: number | null
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const isEdit = accountId !== null

  const [name, setName] = useState('')
  const [type, setType] = useState(1)
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [baseURL, setBaseURL] = useState('')
  const [remark, setRemark] = useState('')
  const [isMultiKey, setIsMultiKey] = useState(false)
  const [multiKeyMode, setMultiKeyMode] = useState('polling')
  const [status, setStatus] = useState(1)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (accountId === null) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const account = await getAccount(accountId)
        if (cancelled) return
        setName(account.name)
        setType(account.type)
        setBaseURL(account.base_url ?? '')
        setRemark(account.remark ?? '')
        setIsMultiKey(Boolean(account.channel_info?.is_multi_key))
        setMultiKeyMode(account.channel_info?.multi_key_mode ?? 'polling')
        setStatus(account.status)
      } catch {
        // 加载失败保持空表单；抽屉保存时会覆盖保存全部字段，此处不阻断。
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accountId])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const payload: Parameters<typeof updateAccount>[0] = {
          id: accountId,
          name,
          base_url: baseURL,
          remark,
          status,
          multi_key_mode: isMultiKey ? multiKeyMode : undefined,
        }
        if (keyTouched && key !== '') {
          payload.key = key
        }
        await updateAccount(payload)
      } else {
        await createAccount({
          name,
          type,
          key,
          base_url: baseURL,
          remark,
          is_multi_key: isMultiKey,
          multi_key_mode: multiKeyMode,
        })
      }
    },
    onSuccess: () => {
      toast.success(
        isEdit ? t('Account updated') : t('Account created')
      )
      onSaved()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Save failed')
      )
    },
  })

  const keyCount = key
    .split('\n')
    .map((k) => k.trim())
    .filter(Boolean).length

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col gap-4 sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle>
            {isEdit ? t('Edit Account') : t('Add Account')}
          </SheetTitle>
          <SheetDescription>
            {t(
              'Accounts hold credentials shared by channels; edit keys here instead of in each channel.'
            )}
          </SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className='space-y-3 px-4'>
            <Skeleton className='h-8 w-full' />
            <Skeleton className='h-8 w-full' />
            <Skeleton className='h-20 w-full' />
          </div>
        ) : (
          <div className='flex-1 space-y-4 overflow-y-auto px-4 pb-4'>
            <div className='space-y-1.5'>
              <Label>{t('Name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className='space-y-1.5'>
              <Label>{t('Provider')}</Label>
              <Select
                value={String(type)}
                onValueChange={(v) => setType(Number(v))}
                disabled={isEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {CHANNEL_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <Label>{t('Key')}</Label>
              <Textarea
                value={key}
                onChange={(e) => {
                  setKey(e.target.value)
                  setKeyTouched(true)
                }}
                placeholder={
                  isEdit
                    ? t('Leave empty to keep current key')
                    : t('One key per line for multi-key accounts')
                }
                rows={isMultiKey ? 5 : 2}
                className='font-mono text-xs'
              />
              {isMultiKey && keyCount > 0 && (
                <p className='text-muted-foreground text-xs'>
                  {t('{{count}} keys detected', { count: keyCount })}
                </p>
              )}
            </div>
            <div className='flex items-center justify-between rounded-lg border p-3'>
              <div className='space-y-0.5'>
                <p className='text-sm font-medium'>{t('Multi-key mode')}</p>
                <p className='text-muted-foreground text-xs'>
                  {t('Poll or randomly pick among keys, status shared across channels')}
                </p>
              </div>
              <div className='flex items-center gap-2'>
                {isMultiKey && (
                  <Select
                    value={multiKeyMode}
                    onValueChange={(v) => v && setMultiKeyMode(v)}
                  >
                    <SelectTrigger className='h-8 w-28'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectItem value='polling'>{t('Polling')}</SelectItem>
                      <SelectItem value='random'>{t('Random')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Switch
                  checked={isMultiKey}
                  onCheckedChange={setIsMultiKey}
                />
              </div>
            </div>
            <div className='space-y-1.5'>
              <Label>{t('Base URL')}</Label>
              <Input
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder={t('Optional, overrides the provider default')}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>{t('Remark')}</Label>
              <Input value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
            {isEdit && (
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <p className='text-sm font-medium'>{t('Status')}</p>
                <Select
                  value={String(status)}
                  onValueChange={(v) => setStatus(Number(v))}
                >
                  <SelectTrigger className='h-8 w-28'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value='1'>{t('Enabled')}</SelectItem>
                    <SelectItem value='2'>{t('Manually Disabled')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
        <div className='flex justify-end gap-2 border-t px-4 py-3'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !name.trim() || (!isEdit && key.trim() === '')}
          >
            {saveMutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
