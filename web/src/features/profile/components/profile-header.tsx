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
import { Activity, BarChart3, Camera, Pin, WalletCards } from 'lucide-react'
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatCompactNumber, formatQuota } from '@/lib/format'
import { getRoleLabel } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { uploadAvatar } from '../api'
import { getMyGroupPin } from '@/features/subscriptions/api'
import { getDisplayName } from '../lib'
import type { UserProfile } from '../types'

// ============================================================================
// Profile Header Component
// ============================================================================

interface ProfileHeaderProps {
  profile: UserProfile | null
  loading: boolean
  onProfileUpdate?: () => void
}

export function ProfileHeader({
  profile,
  loading,
  onProfileUpdate,
}: ProfileHeaderProps) {
  const { t } = useTranslation()
  const currentUser = useAuthStore((s) => s.auth.user)
  const setUser = useAuthStore((s) => s.auth.setUser)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // 固定分组钉：有 active 钉时组名旁显示"📌 钉组名"徽标——徽标必须携带钉组名，
  // 否则"组 v3（订阅发的）+ 钉 v2"会显示成 "v3 · Pinned"，被读成钉的是 v3（歧义）。
  const pinnedQuery = useQuery({
    queryKey: ['group-pin', 'self'],
    queryFn: getMyGroupPin,
    retry: false,
  })
  const pinnedGroup =
    pinnedQuery.data?.data?.status === 'active'
      ? pinnedQuery.data.data.group
      : null

  const handleAvatarChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      const res = await uploadAvatar(file)
      if (res.success && res.data?.url) {
        toast.success(t('Avatar updated'))
        // Sync the avatar into the auth store so every header renders it right
        // away; the profile refetch keeps the server value authoritative.
        if (currentUser) {
          setUser({ ...currentUser, avatar: res.data.url })
        }
        await onProfileUpdate?.()
      } else {
        toast.error(res.message || t('Avatar upload failed'))
      }
    } catch {
      toast.error(t('Avatar upload failed'))
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardContent className='p-4 sm:p-5'>
          <div className='flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left'>
            <Skeleton className='h-16 w-16 rounded-2xl' />
            <div className='space-y-3'>
              <div className='flex flex-col items-center gap-2 sm:flex-row sm:justify-start'>
                <Skeleton className='h-8 w-48' />
                <Skeleton className='h-5 w-16' />
              </div>
              <div className='flex flex-col items-center gap-1 sm:flex-row sm:justify-start sm:gap-4'>
                <Skeleton className='h-4 w-24' />
                <Skeleton className='h-4 w-40' />
                <Skeleton className='h-4 w-20' />
              </div>
            </div>
          </div>
        </CardContent>
        <div className='border-t'>
          <div className='divide-border/60 grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0'>
            {['balance', 'usage', 'requests'].map((key) => (
              <div key={key} className='px-4 py-3.5 sm:px-5 sm:py-4'>
                <Skeleton className='h-3.5 w-20' />
                <Skeleton className='mt-2 h-7 w-28' />
                <Skeleton className='mt-1.5 h-3.5 w-24' />
              </div>
            ))}
          </div>
        </div>
      </Card>
    )
  }

  if (!profile) return null

  const displayName = getDisplayName(profile)
  const avatarName = profile.username || displayName
  const avatarFallback = getUserAvatarFallback(avatarName)
  const avatarFallbackStyle = getUserAvatarStyle(avatarName)
  const roleLabel = getRoleLabel(profile.role)
  const stats: {
    label: string
    value: string
    description: string
    icon: typeof WalletCards
    tone: IconBadgeTone
  }[] = [
    {
      label: t('Current Balance'),
      value: formatQuota(profile.quota),
      description: t('Remaining quota'),
      icon: WalletCards,
      tone: 'success',
    },
    {
      label: t('Total Usage'),
      value: formatQuota(profile.used_quota),
      description: t('Total consumed quota'),
      icon: BarChart3,
      tone: 'info',
    },
    {
      label: t('API Requests'),
      value: formatCompactNumber(profile.request_count),
      description: t('Total requests made'),
      icon: Activity,
      tone: 'chart-4',
    },
  ]

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <CardContent className='p-3 sm:p-5'>
        <div className='flex items-center gap-3 text-left sm:gap-4'>
          <div className='group/avatar-edit relative shrink-0'>
            <Avatar className='ring-background h-12 w-12 rounded-xl text-sm ring-2 sm:h-16 sm:w-16 sm:rounded-2xl sm:text-lg sm:ring-4'>
              {profile.avatar ? (
                <AvatarImage src={profile.avatar} alt={displayName} />
              ) : null}
              <AvatarFallback
                className='rounded-xl font-semibold text-white sm:rounded-2xl'
                style={avatarFallbackStyle}
              >
                {avatarFallback}
              </AvatarFallback>
            </Avatar>
            <button
              type='button'
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title={t('Change avatar')}
              aria-label={t('Change avatar')}
              className='bg-background/60 ring-background absolute inset-0 flex items-center justify-center rounded-xl text-white opacity-0 ring-2 transition-opacity group-hover/avatar-edit:opacity-100 sm:rounded-2xl'
            >
              <Camera className='size-5' />
            </button>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/png,image/jpeg,image/gif'
              className='hidden'
              onChange={handleAvatarChange}
            />
          </div>

          <div className='min-w-0 flex-1 space-y-1.5 sm:space-y-3'>
            <div className='flex min-w-0 items-center gap-2'>
              <h1 className='truncate text-xl font-semibold tracking-tight sm:text-2xl'>
                {displayName}
              </h1>
              <StatusBadge
                label={roleLabel}
                variant='neutral'
                copyable={false}
              />
              <StatusBadge
                label={`${t('User ID')} ${profile.id}`}
                variant='info'
                copyText={String(profile.id)}
              />
            </div>

            <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:gap-x-4 sm:text-sm'>
              <span className='truncate'>@{profile.username}</span>
              {profile.email && (
                <>
                  <span>•</span>
                  <span className='truncate'>{profile.email}</span>
                </>
              )}
              {profile.group && (
                <>
                  <span>•</span>
                  <span className='truncate'>{profile.group}</span>
                </>
              )}
              {pinnedGroup && (
                <>
                  <span>•</span>
                  <span
                    className='inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary'
                    title={t('Pinned')}
                  >
                    <Pin className='size-3' />
                    {pinnedGroup}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
      <div className='border-t'>
        <div className='divide-border/60 grid grid-cols-3 divide-x'>
          {stats.map((item) => (
            <div key={item.label} className='min-w-0 px-3 py-3 sm:px-5 sm:py-4'>
              <div className='flex items-center gap-2'>
                <IconBadge tone={item.tone} size='stat'>
                  <item.icon />
                </IconBadge>
                <div className='text-muted-foreground truncate text-xs font-medium tracking-wider uppercase'>
                  {item.label}
                </div>
              </div>

              <div className='text-foreground mt-1.5 truncate font-mono text-lg font-bold tracking-tight tabular-nums sm:mt-2 sm:text-2xl'>
                {item.value}
              </div>
              <div className='text-muted-foreground/60 mt-1 hidden text-xs md:block'>
                {item.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
