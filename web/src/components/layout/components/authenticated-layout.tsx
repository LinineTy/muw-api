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
import { useEffect, useState } from 'react'
import { useLocation } from '@tanstack/react-router'

import { AnimatedOutlet } from '@/components/page-transition'
import { SkipToMain } from '@/components/skip-to-main'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { getCookie } from '@/lib/cookies'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'
import { MobileNavFab } from './mobile-nav-fab'
import { OsDesktopPlaceholder } from './os-shell/os-desktop-placeholder'
import { OsDock } from './os-shell/os-dock'
import { OsNavBall } from './os-shell/os-nav-ball'
import { OsTopbarBall } from './os-shell/os-topbar-ball'
import { OsWindow } from './os-shell/os-window'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const isMobile = useIsMobile()
  const pathname = useLocation({ select: (l) => l.pathname })

  // OS 壳窗口开关:红点关闭→空桌面;路由变化( Dock/导航球跳页 )→自动重开
  const [windowOpen, setWindowOpen] = useState(true)
  useEffect(() => {
    setWindowOpen(true)
  }, [pathname])

  return (
    <LayoutProvider>
      <SearchProvider>
        <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
          <SkipToMain />
          {isMobile ? (
            <>
              <AppHeader />
              <div className='flex min-h-0 w-full flex-1'>
                <AppSidebar />
                <SidebarInset
                  className={cn(
                    '@container/content',
                    'h-[calc(100svh-var(--app-header-height,0px))]',
                    'min-h-0 overflow-hidden',
                    'peer-data-[variant=inset]:h-[calc(100svh-var(--app-header-height,0px)-(var(--spacing)*4))]'
                  )}
                >
                  {props.children ?? <AnimatedOutlet />}
                </SidebarInset>
              </div>
            </>
          ) : (
            // OS 桌面壳(v1 形态试验):无顶栏无侧栏,画布→窗口,
            // 左下双球(顶栏球+导航球),底部悬浮 Dock;
            // 画布区下缘给 Dock 让位(窗口不被 Dock 遮挡)
            <div className='flex h-svh min-h-0 w-full flex-col px-4 pt-4 pb-[5.5rem]'>
              {windowOpen ? (
                <OsWindow onClose={() => setWindowOpen(false)}>
                  {props.children ?? <AnimatedOutlet />}
                </OsWindow>
              ) : (
                <OsDesktopPlaceholder />
              )}
              <OsTopbarBall />
              <OsNavBall />
              <OsDock />
            </div>
          )}
          <MobileNavFab />
        </SidebarProvider>
      </SearchProvider>
    </LayoutProvider>
  )
}
