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
// @muw-owned
// 「分组与固定」卡：用户页右栏展示当前分组的来源分解（固定分组钉 + 订阅升级）
// 与到期回落预告。数据 = /api/group_pin/self（钉）+ /api/subscription/self（订阅锚）。
import { Pin } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestamp } from '@/lib/format'

import { getMyGroupPin, getSelfSubscriptionFull } from '@/features/subscriptions/api'
import type { UserProfile } from '../types'

interface GroupPinCardProps {
  profile: UserProfile | null
  loading: boolean
}

interface AnchorRow {
  key: string
  group: string
  label: string
  detail: string
}

export function GroupPinCard({ profile, loading }: GroupPinCardProps) {
  const { t } = useTranslation()
  const pinQuery = useQuery({
    queryKey: ['group-pin', 'self'],
    queryFn: getMyGroupPin,
    retry: false,
  })
  const subsQuery = useQuery({
    queryKey: ['self-subscriptions'],
    queryFn: getSelfSubscriptionFull,
    retry: false,
  })

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardContent className='space-y-3 p-3 sm:p-5'>
          <Skeleton className='h-4 w-28' />
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-10 w-full' />
        </CardContent>
      </Card>
    )
  }

  const pin =
    pinQuery.data?.data && pinQuery.data.data.status === 'active'
      ? pinQuery.data.data
      : null
  const records = subsQuery.data?.data?.subscriptions ?? []
  // 订阅锚：active 且套餐配置了 upgrade_group（与 settle 的 subscriptionAnchorGroup 口径一致）
  const activeSubAnchors = records.filter(
    (r) =>
      r.subscription.status === 'active' &&
      !!r.plan?.upgrade_group &&
      r.plan.upgrade_group !== ''
  )

  if (!pin && activeSubAnchors.length === 0) return null

  const currentGroup = profile?.group ?? ''
  const pinnedActive = !!pin && currentGroup === pin.group
  const viaSubscription =
    !pinnedActive &&
    activeSubAnchors.some((r) => r.plan?.upgrade_group === currentGroup)

  const rows: AnchorRow[] = []
  if (pin) {
    const sourceLabel =
      pin.source === 'purchase'
        ? t('Purchased "{{item}}"', { item: pin.note || '' })
        : t('Set by admin')
    rows.push({
      key: 'pin',
      group: pin.group,
      label: t('Pinned group'),
      detail: `${sourceLabel} · ${t('Permanent')}`,
    })
  }
  for (const r of activeSubAnchors) {
    rows.push({
      key: `sub-${r.subscription.id}`,
      group: r.plan?.upgrade_group ?? '',
      label: t('Subscription upgrade'),
      detail: `${r.plan?.title ?? ''} · ${t('Expires {{time}}', { time: formatTimestamp(r.subscription.end_time) })}`,
    })
  }

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <CardContent className='space-y-3 p-3 sm:p-5'>
        <div className='space-y-0.5'>
          <div className='text-sm font-semibold'>{t('Group & Pin')}</div>
          <div className='text-muted-foreground text-xs'>
            {t('Group sources and expiry fallback')}
          </div>
        </div>

        <div className='bg-muted/40 flex items-center justify-between rounded-lg p-3'>
          <div>
            <div className='text-muted-foreground text-xs'>
              {t('Current group')}
            </div>
            <div className='text-lg font-bold'>{currentGroup || '-'}</div>
          </div>
          {pinnedActive ? (
            <span className='bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-medium'>
              {t('Pinned group active')}
            </span>
          ) : viaSubscription ? (
            <span className='bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-medium'>
              {t('Active via subscription')}
            </span>
          ) : null}
        </div>

        <div className='space-y-2'>
          {rows.map((row) => (
            <div
              key={row.key}
              className='bg-background/60 flex items-center justify-between rounded-md border p-2.5'
            >
              <div className='flex min-w-0 items-center gap-2'>
                <span className='bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium'>
                  {row.key === 'pin' ? <Pin className='size-3' /> : null}
                  {row.group}
                </span>
                <span className='text-xs'>{row.label}</span>
              </div>
              <div className='text-muted-foreground shrink-0 text-right text-xs'>
                {row.detail}
              </div>
            </div>
          ))}
        </div>

        {pin && !pinnedActive && (
          <div className='border-primary/20 bg-primary/5 text-muted-foreground rounded-md border p-2.5 text-xs'>
            {t(
              'Falls back to pinned group {{group}} when the subscription expires',
              { group: pin.group }
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
