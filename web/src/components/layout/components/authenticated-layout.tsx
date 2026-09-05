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
import { useEffect } from 'react'
import { AnimatedOutlet } from '@/components/page-transition'
import { SkipToMain } from '@/components/skip-to-main'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { getCookie } from '@/lib/cookies'
import { useIsMobile } from '@/hooks/use-mobile'
import { installParentAuthBridge } from '@/lib/auth-session'
import { cn } from '@/lib/utils'

import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'
import { MobileNavFab } from './mobile-nav-fab'
import { OsDock } from './os-shell/os-dock'
import { OsNavBall } from './os-shell/os-nav-ball'
import { OsTopbarBall } from './os-shell/os-topbar-ball'
import { OsWindowManager } from './os-shell/os-window-manager'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

/** OS 壳多窗口的 iframe 内容检测:子应用退化为纯内容模式(无壳) */
const IN_OS_WINDOW =
  typeof window !== 'undefined' && window.self !== window.top

/** iframe 内容模式:文档背景+壁纸层透明化(class 驱动,规则在 index.css),
 * 让窗口标题栏与主体统一透出主层玻璃底(避免分体感) */
function useIframeTransparentBackground(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const html = document.documentElement
    html.classList.add('os-in-window')
    return () => {
      html.classList.remove('os-in-window')
    }
  }, [enabled])
}

export function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const isMobile = useIsMobile()
  useIframeTransparentBackground(IN_OS_WINDOW)

  // 主层(OS 壳 PC 分支)安装认证桥:窗口 iframe 的 session 刷新委托主层,
  // N 窗共享一次 /api/user/auth/refresh,避免烧穿 CriticalRateLimit(429)
  useEffect(() => {
    if (!IN_OS_WINDOW && !isMobile) installParentAuthBridge()
  }, [isMobile])

  // iframe 内容模式:OS 窗口内的页面 = 原布局去顶栏(保留 AppSidebar,
  // 否则系统设置等依赖侧栏分区导航的页面在窗口里会迷路)
  if (IN_OS_WINDOW) {
    return (
      <LayoutProvider>
        <SearchProvider>
          <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
            <div className='flex min-h-0 w-full flex-1'>
              <AppSidebar />
              <SidebarInset className='@container/content h-svh min-h-0 flex-1 overflow-hidden peer-data-[variant=inset]:h-svh'>
                <div className='h-svh w-full overflow-y-auto overscroll-contain'>
                  {props.children ?? <AnimatedOutlet />}
                </div>
              </SidebarInset>
            </div>
          </SidebarProvider>
        </SearchProvider>
      </LayoutProvider>
    )
  }

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
            // OS 桌面壳(v2 多窗口):无顶栏无侧栏,窗口=iframe 保活多开,
            // 左下双球(顶栏球+导航球),底部悬浮 Dock(macOS 行为)
            <div className='relative h-svh w-full overflow-hidden'>
              <OsWindowManager />
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
