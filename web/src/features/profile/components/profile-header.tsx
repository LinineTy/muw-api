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
import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatCompactNumber, formatQuota } from '@/lib/format'
import { getRoleLabel } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { uploadAvatar } from '../api'
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
        <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5'>
          <div className='flex items-center gap-3 sm:gap-4'>
            <Skeleton className='h-12 w-12 rounded-xl sm:h-16 sm:w-16 sm:rounded-2xl' />
            <div className='space-y-2'>
              <Skeleton className='h-6 w-40' />
              <Skeleton className='h-4 w-24' />
            </div>
          </div>
          <div className='flex items-center gap-5'>
            {['balance', 'usage', 'requests'].map((key) => (
              <div key={key} className='space-y-1.5'>
                <Skeleton className='h-3 w-16' />
                <Skeleton className='h-6 w-14' />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!profile) return null

  const displayName = getDisplayName(profile)
  const avatarName = profile.username || displayName
  const avatarFallback = getUserAvatarFallback(avatarName)
  const avatarFallbackStyle = getUserAvatarStyle(avatarName)
  const roleLabel = getRoleLabel(profile.role)
  const stats: { label: string; value: string }[] = [
    {
      label: t('Current Balance'),
      value: formatQuota(profile.quota),
    },
    {
      label: t('Total Usage'),
      value: formatQuota(profile.used_quota),
    },
    {
      label: t('API Requests'),
      value: formatCompactNumber(profile.request_count),
    },
  ]

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5'>
        <div className='flex items-center gap-3 text-left sm:gap-4'>
          <div className='group/avatar-edit relative shrink-0'>
            <Avatar className='ring-background h-12 w-12 rounded-xl text-sm ring-2 sm:h-14 sm:w-14 sm:rounded-2xl sm:text-base sm:ring-4'>
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

          <div className='min-w-0 space-y-1'>
            <div className='flex min-w-0 flex-wrap items-center gap-2'>
              <h1 className='truncate text-lg font-semibold tracking-tight'>
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
            <div className='text-muted-foreground truncate text-xs'>
              @{profile.username}
            </div>
          </div>
        </div>

        {/* 统计横排右置：与身份同行,整卡单行紧凑(2026-09-10 改版,对照既定 mock) */}
        <div className='flex items-center gap-5 sm:gap-6'>
          {stats.map((item) => (
            <div key={item.label} className='min-w-0'>
              <div className='text-muted-foreground truncate text-[11px] font-medium tracking-wider uppercase'>
                {item.label}
              </div>
              <div className='text-foreground mt-0.5 truncate font-mono text-lg font-bold tracking-tight tabular-nums'>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
