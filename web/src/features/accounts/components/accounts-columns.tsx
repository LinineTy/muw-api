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
import type { ColumnDef } from '@tanstack/react-table'
import { KeyRound, Pencil, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { CHANNEL_TYPE_OPTIONS } from '@/features/channels/constants'
import { formatCurrencyUSD } from '@/lib/format'

import { ACCOUNT_STATUS, type AccountListItem } from '../types'
import { CodingPlanQuotaCell } from './coding-plan-quota-cell'

function typeLabel(type: number): string {
  const option = CHANNEL_TYPE_OPTIONS.find((o) => o.value === type)
  return option?.label ?? String(type)
}

function AccountStatusCell({ status }: { status: number }) {
  const { t } = useTranslation()
  const enabled = status === ACCOUNT_STATUS.ENABLED
  return (
    <span className='inline-flex items-center gap-1.5 text-xs'>
      <span
        className={
          enabled ? 'size-1.5 rounded-full bg-emerald-500' : 'bg-destructive size-1.5 rounded-full'
        }
      />
      {enabled
        ? t('Enabled')
        : status === ACCOUNT_STATUS.AUTO_DISABLED
          ? t('Auto Disabled')
          : t('Manually Disabled')}
    </span>
  )
}

/**
 * 引用渠道单元格：显示渠道名（超过两个折叠成 +N），悬停看全量。
 * 账户 N:N 后一个账户可被多个渠道引用，这里给出反查视图。
 */
function ReferencedChannelsCell({ item }: { item: AccountListItem }) {
  const { t } = useTranslation()
  const channels = item.channels ?? []
  if (channels.length === 0) {
    return <span className='text-muted-foreground text-xs'>{t('Not referenced')}</span>
  }
  const shown = channels.slice(0, 2)
  const rest = channels.length - shown.length
  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={<span className='cursor-default text-xs' />}
        >
          {shown.map((ch) => ch.name).join('、')}
          {rest > 0 ? ` +${rest}` : ''}
        </TooltipTrigger>
        <TooltipContent>
          <div className='flex flex-col gap-0.5'>
            {channels.map((ch) => (
              <span key={ch.id} className='text-xs'>
                #{ch.id} {ch.name}
              </span>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function useAccountsColumns(options: {
  onEdit: (id: number) => void
  onDelete: (id: number) => void
}): ColumnDef<AccountListItem>[] {
  const { t } = useTranslation()
  const { onEdit, onDelete } = options
  return useMemo(
    () => [
      {
        id: 'name',
        accessorFn: (item) => item.account.name,
        header: () => t('Name'),
        cell: ({ row }) => (
          <div className='flex items-center gap-1.5'>
            <span className='font-medium'>{row.original.account.name}</span>
            {row.original.account.auto_generated && (
              <Badge variant='secondary' className='text-[10px]'>
                {t('Auto')}
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: 'type',
        accessorFn: (item) => item.account.type,
        header: () => t('Provider'),
        cell: ({ row }) => (
          <span className='text-xs'>{typeLabel(row.original.account.type)}</span>
        ),
      },
      {
        id: 'key',
        header: () => t('Key'),
        cell: ({ row }) => {
          const info = row.original.account.channel_info
          return (
            <span className='inline-flex items-center gap-1 font-mono text-xs'>
              <KeyRound className='text-muted-foreground size-3' />
              {row.original.account.key_masked || '-'}
              {info?.is_multi_key && (
                <Badge variant='secondary' className='text-[10px]'>
                  {t('Multi')} {info.multi_key_size ?? ''}
                </Badge>
              )}
            </span>
          )
        },
      },
      {
        id: 'status',
        header: () => t('Status'),
        cell: ({ row }) => (
          <AccountStatusCell status={row.original.account.status} />
        ),
      },
      {
        id: 'balance',
        header: () => t('Balance'),
        cell: ({ row }) => (
          <span className='tabular-nums text-xs'>
            {formatCurrencyUSD(row.original.account.balance)}
          </span>
        ),
      },
      {
        id: 'channels',
        header: () => t('Referenced by'),
        cell: ({ row }) => <ReferencedChannelsCell item={row.original} />,
      },
      {
        id: 'coding_plan',
        header: () => t('Coding plan quota'),
        cell: ({ row }) => <CodingPlanQuotaCell account={row.original.account} />,
      },
      {
        id: 'actions',
        header: () => <span className='sr-only'>{t('Actions')}</span>,
        cell: ({ row }) => {
          const referenced = row.original.channel_count > 0
          return (
            <div className='flex justify-end gap-1'>
              <TooltipProvider delay={100}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('Edit')}
                        onClick={() => onEdit(row.original.account.id)}
                      />
                    }
                  >
                    <Pencil className='size-3.5' />
                  </TooltipTrigger>
                  <TooltipContent>{t('Edit')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('Delete')}
                        disabled={referenced}
                        onClick={() => onDelete(row.original.account.id)}
                      />
                    }
                  >
                    <Trash2 className='size-3.5' />
                  </TooltipTrigger>
                  <TooltipContent>
                    {referenced ? t('Account is referenced by channels') : t('Delete')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )
        },
      },
    ],
    [t, onEdit, onDelete]
  )
}
