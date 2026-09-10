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
import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import {
  CHANNEL_TYPE_OPTIONS,
  CODING_PLAN_PROVIDER_DISABLED,
  CODING_PLAN_PROVIDER_OPTIONS,
} from '@/features/channels/constants'

import {
  createAccount,
  deleteAccount,
  getAccount,
  getAccountChannelRefs,
  updateAccount,
} from '../api'

const DEFAULT_DISABLE_THRESHOLD = 95
const DEFAULT_ENABLE_THRESHOLD = 80

export function AccountMutateDrawer({
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
  const queryClient = useQueryClient()
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
  // 编码套餐监控（凭证自带状态，随账户走）
  const [planEnabled, setPlanEnabled] = useState(false)
  const [planProvider, setPlanProvider] = useState('zhipu')
  const [planKey, setPlanKey] = useState('')
  const [planKeyTouched, setPlanKeyTouched] = useState(false)
  const [planAutoControl, setPlanAutoControl] = useState(false)
  const [planDisableThreshold, setPlanDisableThreshold] = useState(
    DEFAULT_DISABLE_THRESHOLD
  )
  const [planEnableThreshold, setPlanEnableThreshold] = useState(
    DEFAULT_ENABLE_THRESHOLD
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || accountId === null) return
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
        const provider = account.coding_plan_provider ?? ''
        setPlanEnabled(provider !== '' && provider !== CODING_PLAN_PROVIDER_DISABLED)
        if (provider && provider !== CODING_PLAN_PROVIDER_DISABLED) {
          setPlanProvider(provider)
        }
        setPlanAutoControl(Boolean(account.coding_plan_auto_control))
        setPlanDisableThreshold(
          account.coding_plan_disable_threshold ?? DEFAULT_DISABLE_THRESHOLD
        )
        setPlanEnableThreshold(
          account.coding_plan_enable_threshold ?? DEFAULT_ENABLE_THRESHOLD
        )
        setPlanKey('')
        setPlanKeyTouched(false)
      } catch {
        // 加载失败保持空表单；保存会整体覆盖，此处不阻断
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, accountId])

  // 引用渠道（反查）：账户被哪些渠道用着，删除前能一眼看到
  const { data: refs } = useQuery({
    queryKey: ['account-channel-refs', accountId],
    queryFn: () => getAccountChannelRefs(accountId as number),
    enabled: open && accountId !== null,
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const provider = planEnabled ? planProvider : CODING_PLAN_PROVIDER_DISABLED
      if (isEdit) {
        const payload: Parameters<typeof updateAccount>[0] = {
          id: accountId,
          name,
          base_url: baseURL,
          remark,
          status,
          multi_key_mode: isMultiKey ? multiKeyMode : undefined,
          coding_plan_provider: provider,
          coding_plan_auto_control: planEnabled ? planAutoControl : false,
          coding_plan_disable_threshold: planEnabled
            ? planDisableThreshold
            : undefined,
          coding_plan_enable_threshold: planEnabled ? planEnableThreshold : undefined,
        }
        if (keyTouched && key !== '') {
          payload.key = key
        }
        if (planKeyTouched) {
          payload.coding_plan_key = planKey.trim()
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
          coding_plan_provider: provider,
          coding_plan_key: planEnabled ? planKey.trim() : undefined,
          coding_plan_auto_control: planEnabled ? planAutoControl : false,
          coding_plan_disable_threshold: planEnabled ? planDisableThreshold : undefined,
          coding_plan_enable_threshold: planEnabled ? planEnableThreshold : undefined,
        })
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? t('Account updated') : t('Account created'))
      onSaved()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('Save failed'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
    onSuccess: () => {
      toast.success(t('Account deleted'))
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('Delete failed'))
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
          <SheetTitle>{isEdit ? t('Edit Account') : t('Add Account')}</SheetTitle>
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
              <Label>{t('Type')}</Label>
              <Select
                items={CHANNEL_TYPE_OPTIONS.map((option) => ({
                  value: String(option.value),
                  label: option.label,
                }))}
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
                  {t(
                    'Poll or randomly pick among keys, status shared across channels'
                  )}
                </p>
              </div>
              <div className='flex items-center gap-2'>
                {isMultiKey && (
                  <Select
                    items={[
                      { value: 'polling', label: t('Polling') },
                      { value: 'random', label: t('Random') },
                    ]}
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
                  aria-label={t('Multi-key mode')}
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

            {/* 编码套餐监控：开关 + 厂商，查询地址固定走厂商官方，与 base_url 无关 */}
            <div className='space-y-3 rounded-lg border p-3'>
              <div className='flex items-center justify-between'>
                <div className='space-y-0.5'>
                  <p className='text-sm font-medium'>
                    {t('Coding plan quota monitoring')}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Query the plan quota of this account from the provider official endpoint.'
                    )}
                  </p>
                </div>
                <Switch
                  aria-label={t('Coding plan quota monitoring')}
                  checked={planEnabled}
                  onCheckedChange={setPlanEnabled}
                />
              </div>
              {planEnabled && (
                <div className='space-y-3'>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>{t('Plan provider')}</Label>
                    <Select
                      items={CODING_PLAN_PROVIDER_OPTIONS.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                      value={planProvider}
                      onValueChange={(v) => v && setPlanProvider(v)}
                    >
                      <SelectTrigger size='sm' className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        {CODING_PLAN_PROVIDER_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>{t('Plan key (optional)')}</Label>
                    <Input
                      value={planKey}
                      onChange={(e) => {
                        setPlanKey(e.target.value)
                        setPlanKeyTouched(true)
                      }}
                      placeholder={t('Leave empty to use this account key')}
                      className='font-mono text-xs'
                    />
                  </div>
                  <div className='flex items-center justify-between'>
                    <div className='space-y-0.5'>
                      <p className='text-sm font-medium'>{t('Auto control')}</p>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Disable the account when quota runs out, restore when it recovers.'
                        )}
                      </p>
                    </div>
                    <Switch
                      aria-label={t('Auto control')}
                      checked={planAutoControl}
                      onCheckedChange={setPlanAutoControl}
                    />
                  </div>
                  {planAutoControl && (
                    <div className='grid grid-cols-2 gap-3'>
                      <div className='space-y-1.5'>
                        <Label className='text-xs'>{t('Disable threshold (%)')}</Label>
                        <Input
                          type='number'
                          value={planDisableThreshold}
                          onChange={(e) =>
                            setPlanDisableThreshold(Number(e.target.value))
                          }
                        />
                      </div>
                      <div className='space-y-1.5'>
                        <Label className='text-xs'>{t('Restore threshold (%)')}</Label>
                        <Input
                          type='number'
                          value={planEnableThreshold}
                          onChange={(e) =>
                            setPlanEnableThreshold(Number(e.target.value))
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {isEdit && (
              <div className='flex items-center justify-between rounded-lg border p-3'>
                <div className='space-y-0.5'>
                  <p className='text-sm font-medium'>{t('Status')}</p>
                  <p className='text-muted-foreground text-xs'>
                    {t('Disabled accounts are skipped by every bound channel.')}
                  </p>
                </div>
                <Select
                  items={[
                    { value: '1', label: t('Enabled') },
                    { value: '2', label: t('Manually Disabled') },
                  ]}
                  value={String(status)}
                  onValueChange={(v) => setStatus(Number(v))}
                >
                  <SelectTrigger size='sm' className='w-32'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value='1'>{t('Enabled')}</SelectItem>
                    <SelectItem value='2'>{t('Manually Disabled')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {isEdit && (
              <div className='space-y-1.5 rounded-lg border p-3'>
                <div className='flex items-center justify-between'>
                  <p className='text-sm font-medium'>{t('Referenced by')}</p>
                  <Link
                    to='/channels'
                    className='text-primary inline-flex items-center gap-1 text-xs hover:underline'
                  >
                    <ExternalLink className='size-3' />
                    {t('Manage in Channels')}
                  </Link>
                </div>
                {refs && refs.length > 0 ? (
                  <div className='flex flex-col gap-0.5'>
                    {refs.map((ref) => (
                      <span key={ref.id} className='text-muted-foreground text-xs'>
                        #{ref.id} {ref.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className='text-muted-foreground text-xs'>
                    {t('No channel references this account yet.')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div className='flex justify-between gap-2 border-t px-4 py-3'>
          <div>
            {isEdit && (
              <Button
                variant='ghost'
                className='text-destructive hover:text-destructive'
                disabled={deleteMutation.isPending}
                onClick={() => {
                  const count = refs?.length ?? 0
                  if (count > 0) {
                    toast.error(t('Account is referenced by channels'))
                    return
                  }
                  deleteMutation.mutate(accountId)
                }}
              >
                {t('Delete')}
              </Button>
            )}
          </div>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                !name.trim() ||
                (!isEdit && key.trim() === '')
              }
            >
              {saveMutation.isPending ? t('Saving...') : t('Save')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
