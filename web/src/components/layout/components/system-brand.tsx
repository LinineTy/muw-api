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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useVersionBadge } from '@/features/system-update/use-version-badge'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

type SystemBrandProps = {
  defaultName?: string
  defaultVersion?: string
  /**
   * Visual layout:
   * - 'sidebar': stacked card style (used inside the sidebar header).
   * - 'inline': compact horizontal pill (used inside the top app bar).
   * - 'icon': logo only, no name (used inside the OS shell's thin left rail).
   */
  variant?: 'sidebar' | 'inline' | 'icon'
}

/**
 * System brand component
 * Displays current system logo + name.
 * - inline: compact pill in the top app bar; clicking navigates to home (/)
 * - sidebar: stacked card in the sidebar header (display only)
 */
export function SystemBrand(props: SystemBrandProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { logo } = useSystemConfig()
  const { state: versionBadgeState } = useVersionBadge()

  // fork 自研：版本角标小球——绿 = 已是最新、黄 = 有新版本、不渲染 = 检查失败或非管理员。
  const versionBadge =
    versionBadgeState === 'unknown' ? null : (
      <span
        aria-hidden='true'
        title={
          versionBadgeState === 'update' ? t('New version available') : undefined
        }
        className={cn(
          'ring-background absolute -end-0.5 -bottom-0.5 size-1.5 rounded-full ring-2',
          versionBadgeState === 'update' ? 'bg-amber-400' : 'bg-emerald-500'
        )}
      />
    )

  const name = status?.system_name || props.defaultName || 'New API'
  const variant = props.variant ?? 'sidebar'

  if (variant === 'icon') {
    // 左细条用:只留 logo,点击去站点首页(细条放不下名字)
    return (
      <Link
        to='/'
        aria-label={t('Go to home')}
        title={name}
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-lg transition-colors outline-none select-none',
          'hover:bg-accent focus-visible:ring-ring/40 focus-visible:ring-2'
        )}
      >
        <span className='relative flex size-6 items-center justify-center'>
          <span className='size-full overflow-hidden rounded-md'>
            <img
              src={logo}
              alt={t('Logo')}
              className='size-full rounded-md object-cover'
            />
          </span>
          {versionBadge}
        </span>
      </Link>
    )
  }

  if (variant === 'inline') {
    return (
      <Link
        to='/'
        aria-label={t('Go to home')}
        className={cn(
          'text-foreground inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium transition-colors outline-none select-none',
          'hover:bg-accent focus-visible:ring-ring/40 focus-visible:ring-2'
        )}
      >
        <div className='relative flex size-5 shrink-0 items-center justify-center'>
          <div className='size-full overflow-hidden rounded-md'>
            <img
              src={logo}
              alt={t('Logo')}
              className='size-full rounded-md object-cover'
            />
          </div>
          {versionBadge}
        </div>
        <span className='max-w-[12rem] truncate'>{name}</span>
      </Link>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size='lg'
          className='hover:text-sidebar-foreground active:text-sidebar-foreground cursor-default hover:bg-transparent active:bg-transparent'
          render={<div />}
        >
          <div className='relative flex aspect-square size-8 items-center justify-center'>
            <div className='size-full overflow-hidden rounded-lg'>
              <img
                src={logo}
                alt={t('Logo')}
                className='size-full rounded-lg object-cover'
              />
            </div>
            {versionBadge}
          </div>
          <div className='grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden'>
            <span className='truncate font-semibold'>{name}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
