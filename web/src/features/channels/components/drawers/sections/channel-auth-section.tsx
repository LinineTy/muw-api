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
import { ExternalLink, KeyRound } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CHANNEL_TYPE_OPTIONS } from '@/features/channels/constants'

type ChannelAuthSectionProps = {
  children: ReactNode
}

export function ChannelAuthSection(props: ChannelAuthSectionProps) {
  const { t } = useTranslation()

  return (
    <div className='border-border/60 flex flex-col gap-3 border-t pt-4'>
      <div className='flex items-center gap-2'>
        <KeyRound
          className='text-muted-foreground h-3.5 w-3.5'
          aria-hidden='true'
        />
        <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
          {t('Authentication')}
        </h4>
      </div>
      {props.children}
    </div>
  )
}

// ── 账户绑定面板 ─────────────────────────────────────────────────

export type BoundAccountSummary = {
  id: number
  name: string
  type: number
  key_masked: string
  status: number
  base_url?: string | null
}

/**
 * AccountBoundPanel 渠道已绑定账户时的凭证展示面板。凭证真相源在账户
 * （多渠道共享同一份 key/base_url/多key状态），渠道侧不再提供凭证输入，
 * 跳转账户管理页统一编辑。
 */
export function AccountBoundPanel({
  account,
}: {
  account: BoundAccountSummary
}) {
  const { t } = useTranslation()
  const typeLabel =
    CHANNEL_TYPE_OPTIONS.find((o) => o.value === account.type)?.label ??
    String(account.type)

  return (
    <div className='border-border/60 bg-muted/20 space-y-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <KeyRound className='text-muted-foreground size-4 shrink-0' />
          <span className='truncate text-sm font-medium'>{account.name}</span>
          <span className='bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs'>
            {typeLabel}
          </span>
          <span className='text-muted-foreground font-mono text-xs'>
            {account.key_masked || '-'}
          </span>
        </div>
        <Link
          to='/accounts'
          className='text-primary inline-flex items-center gap-1 text-xs hover:underline'
        >
          <ExternalLink className='size-3' />
          {t('Manage in Accounts')}
        </Link>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Credentials live on the bound account and are shared by its channels. Edit the key on the account page.'
        )}
      </p>
      {account.base_url ? (
        <p className='text-muted-foreground truncate font-mono text-xs'>
          Base URL: {account.base_url}
        </p>
      ) : null}
    </div>
  )
}
