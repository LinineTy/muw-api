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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWatch, type UseFormReturn } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Switch } from '@/components/ui/switch'
import { getAccounts } from '@/features/accounts/api'

import { CHANNEL_TYPE_OPTIONS } from '../../constants'

/** 渠道侧只需要账户的这几个字段（列表接口是打码的摘要视图）。 */
type BoundAccountMeta = {
  id: number
  name?: string | null
  base_url?: string | null
  type?: number
  status?: number
}

type BindingMeta = {
  account_id: number
  name?: string | null
  base_url?: string | null
}

type ChannelBoundAccountsProps = {
  /** 抽屉的 react-hook-form 实例：本组件只按名读写 account_id / account_bindings。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>
  isEditing: boolean
  channelData?: {
    data?: {
      account?: BoundAccountMeta | null
      account_bindings?: BindingMeta[] | null
    } | null
  } | null
  open: boolean
}

/**
 * fork 自研：渠道侧账户体系（凭证来源 + 绑定账户列表）。
 *
 * 账户是凭证的唯一真相源；「手动填写」只是给还没有账户的人快速建渠道的入口——
 * 保存时后端会为该渠道自动创建一个私有账户。编辑已有渠道不出现来源切换：
 * 凭证始终挂在账户上。
 *
 * 抽成独立组件是为了与上游的抽屉分节重构（ChannelConfiguration 的五个 slot）
 * 解耦：抽屉只挂一行，账户相关的查询/状态/交互全部内聚在这里。
 */
export function ChannelBoundAccounts(props: ChannelBoundAccountsProps) {
  const { t } = useTranslation()
  const { form, isEditing, channelData, open } = props

  const originalBoundAccount = channelData?.data?.account
  const hasBoundAccount = isEditing && Boolean(originalBoundAccount)

  const { data: bindableAccountsData } = useQuery({
    queryKey: ['accounts', 'bindable'],
    queryFn: () => getAccounts({ page_size: 200 }),
    enabled: !isEditing || hasBoundAccount,
    staleTime: 60_000,
  })

  const bindableAccounts = useMemo(() => {
    const list = (bindableAccountsData?.items ?? [])
      .map((item) => item.account as BoundAccountMeta)
      .filter((acc) => acc.status === 1)
    // 当前已绑账户即使被停用也保留在候选里，否则编辑时选中值没有对应选项
    if (
      originalBoundAccount &&
      !list.some((acc) => acc.id === originalBoundAccount.id)
    ) {
      return [...list, originalBoundAccount]
    }
    return list
  }, [bindableAccountsData, originalBoundAccount])

  const accountMetaById = useMemo(
    () =>
      new Map<number, BoundAccountMeta>(
        bindableAccounts.map((acc) => [acc.id, acc])
      ),
    [bindableAccounts]
  )
  const bindingMetaById = useMemo(
    () =>
      new Map<number, BindingMeta>(
        (channelData?.data?.account_bindings ?? []).map((b) => [
          b.account_id,
          b,
        ])
      ),
    [channelData]
  )

  const boundBindings: { account_id: number; enabled: boolean }[] =
    useWatch({ control: form.control, name: 'account_bindings' }) ?? []
  const accountIdValue = useWatch({ control: form.control, name: 'account_id' })

  const [credentialMode, setCredentialMode] = useState<'account' | 'manual'>(
    'account'
  )
  const [accountsExpanded, setAccountsExpanded] = useState<boolean | null>(null)
  const accountsOpen = accountsExpanded ?? boundBindings.length <= 3

  // 抽屉关闭时忘掉本次手动展开/收起与来源选择，下次打开回到默认态
  useEffect(() => {
    if (!open) {
      setAccountsExpanded(null)
      setCredentialMode('account')
    }
  }, [open])

  const addableAccounts = useMemo(
    () =>
      bindableAccounts.filter(
        (acc) => !boundBindings.some((b) => b.account_id === acc.id)
      ),
    [bindableAccounts, boundBindings]
  )

  const boundAccountId = boundBindings.length
    ? boundBindings[0].account_id
    : ((accountIdValue as number | null) ?? null)

  // 上游地址归账户：绑了账户的渠道，渠道侧地址控件不再生效
  const addressFromAccount = isEditing
    ? hasBoundAccount
    : credentialMode === 'account'
  const boundAccountAddress =
    (boundAccountId !== null
      ? (accountMetaById.get(boundAccountId)?.base_url ??
        bindingMetaById.get(boundAccountId)?.base_url)
      : undefined) ??
    (isEditing ? channelData?.data?.account?.base_url : undefined) ??
    ''
  const boundAccountNames = boundBindings
    .map(
      (b) =>
        accountMetaById.get(b.account_id)?.name ??
        bindingMetaById.get(b.account_id)?.name ??
        `#${b.account_id}`
    )
    .join(' · ')

  const channelTypeLabelOf = (type: number) =>
    CHANNEL_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? String(type)

  const setBoundBindings = (
    next: { account_id: number; enabled: boolean }[]
  ) => {
    form.setValue('account_bindings', next, { shouldDirty: true })
    // 兼容保留的单值字段跟随列表首项
    form.setValue('account_id', next[0]?.account_id ?? null, {
      shouldDirty: true,
    })
  }
  const addBoundAccount = (id: number) => {
    if (!id || boundBindings.some((b) => b.account_id === id)) return
    setBoundBindings([...boundBindings, { account_id: id, enabled: true }])
    setAccountsExpanded(true)
  }
  const removeBoundAccount = (id: number) =>
    setBoundBindings(boundBindings.filter((b) => b.account_id !== id))
  const toggleBoundAccount = (id: number, enabled: boolean) =>
    setBoundBindings(
      boundBindings.map((b) => (b.account_id === id ? { ...b, enabled } : b))
    )
  const moveBoundAccount = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= boundBindings.length) return
    const next = [...boundBindings]
    ;[next[index], next[target]] = [next[target], next[index]]
    setBoundBindings(next)
  }

  if (isEditing ? !hasBoundAccount : false) return null

  return (
    <div className='flex flex-col gap-3'>
      {/* 凭证来源：默认账户（唯一真相源）；手动填写只是快速建渠道的入口 */}
      {!isEditing && (
        <div className='flex flex-col gap-1.5'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Credential source')}
            </span>
            <div className='flex items-center gap-1.5'>
              <Button
                type='button'
                size='sm'
                variant={credentialMode === 'account' ? 'default' : 'outline'}
                onClick={() => setCredentialMode('account')}
              >
                {t('Use accounts')}
              </Button>
              <Button
                type='button'
                size='sm'
                variant={credentialMode === 'manual' ? 'default' : 'outline'}
                onClick={() => {
                  setCredentialMode('manual')
                  // 两个模式互斥：切到手动填写就清掉已选账户
                  setBoundBindings([])
                }}
              >
                {t('Manual entry')}
              </Button>
            </div>
          </div>
          <p className='text-muted-foreground text-xs'>
            {credentialMode === 'account'
              ? t(
                  'Share credentials from existing accounts. Keys are managed on the account page.'
                )
              : t('An account will be created for this channel on save.')}
          </p>
        </div>
      )}

      {/* 账户绑定（N:N）：顺序即轮询顺序，每个绑定可在本渠道单独停用 */}
      {(!isEditing || hasBoundAccount) &&
        (isEditing || credentialMode === 'account') && (
          <div className='border-border/60 bg-muted/10 flex flex-col gap-2 rounded-lg border p-3'>
            <button
              type='button'
              onClick={() => setAccountsExpanded(!accountsOpen)}
              className='flex items-center justify-between gap-2 text-start'
            >
              <span className='flex min-w-0 items-center gap-2'>
                <span className='text-sm font-medium'>
                  {t('Bound accounts')}
                </span>
                {!accountsOpen && boundAccountNames && (
                  <span className='text-muted-foreground min-w-0 truncate text-xs'>
                    {boundAccountNames}
                  </span>
                )}
              </span>
              <span className='text-muted-foreground shrink-0 text-xs'>
                {boundBindings.length}
              </span>
            </button>

            {accountsOpen && (
              <>
                {boundBindings.length === 0 && (
                  <p className='text-muted-foreground text-xs'>
                    {t('No account bound yet.')}
                  </p>
                )}
                {boundBindings.map((binding, index) => (
                  <div
                    key={binding.account_id}
                    className='flex items-center gap-2'
                  >
                    <span className='min-w-0 flex-1 truncate text-sm'>
                      {accountMetaById.get(binding.account_id)?.name ??
                        bindingMetaById.get(binding.account_id)?.name ??
                        `#${binding.account_id}`}
                    </span>
                    <Switch
                      checked={binding.enabled}
                      onCheckedChange={(value) =>
                        toggleBoundAccount(binding.account_id, value)
                      }
                    />
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      disabled={index === 0}
                      onClick={() => moveBoundAccount(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      disabled={index === boundBindings.length - 1}
                      onClick={() => moveBoundAccount(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      onClick={() => removeBoundAccount(binding.account_id)}
                    >
                      {t('Remove')}
                    </Button>
                  </div>
                ))}
                {addableAccounts.length > 0 && (
                  <Combobox
                    options={addableAccounts.map((acc) => ({
                      value: String(acc.id),
                      label: `${acc.name ?? `#${acc.id}`}（${channelTypeLabelOf(
                        acc.type ?? 0
                      )}）`,
                    }))}
                    value={''}
                    onValueChange={(value: string | null) => {
                      if (value) addBoundAccount(Number(value))
                    }}
                    placeholder={t('Add account')}
                    searchPlaceholder={t('Search accounts')}
                    emptyText={t('No matching accounts')}
                  />
                )}
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Bound accounts rotate like multi-key: in list order, and each binding can be disabled per channel.'
                  )}
                </p>
              </>
            )}

            {addressFromAccount && boundAccountAddress && (
              <div className='text-xs'>
                <span className='text-muted-foreground'>
                  {t('Upstream address')}:{' '}
                </span>
                <span className='truncate font-mono'>
                  {boundAccountAddress}
                </span>
              </div>
            )}
          </div>
        )}
    </div>
  )
}
