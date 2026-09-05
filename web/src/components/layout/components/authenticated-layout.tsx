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
import { useLocation } from '@tanstack/react-router'
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
import {
  isSettingsUrl,
  type OsShellOpenWindow,
} from './os-shell/os-open'
import { matchOsNavItem, useOsNavItems } from './os-shell/use-os-nav'
import { useOsWindowsStore } from '@/stores/os-windows-store'
import { OsDock } from './os-shell/os-dock'
import { OsNavBall } from './os-shell/os-nav-ball'
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
  // 设置页退出多窗口:始终主层完整布局(侧栏分区导航复杂度高,窗口化收益低,
  // 且仅管理员可见)——多窗口只对非设置页生效
  const isSettingsRoute = isSettingsUrl(
    useLocation({ select: (s) => s.pathname })
  )
  useIframeTransparentBackground(IN_OS_WINDOW)

  // 主层(OS 壳 PC 分支)安装认证桥:窗口 iframe 的 session 刷新委托主层,
  // N 窗共享一次 /api/user/auth/refresh,避免烧穿 CriticalRateLimit(429)
  useEffect(() => {
    if (!IN_OS_WINDOW && !isMobile) installParentAuthBridge()
  }, [isMobile])

  // iframe 内容模式:OS 窗口内的页面 = 原布局去顶栏。
  // AppSidebar 只给系统设置类页面(/settings)——侧栏分区导航仅设置页需要,
  // 其他页面全宽铺窗口,避免每页都顶一条侧栏
  if (IN_OS_WINDOW) {
    return (
      <LayoutProvider>
        <SearchProvider>
          <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
            <OsWindowContent>{props.children ?? <AnimatedOutlet />}</OsWindowContent>
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
          {isMobile || isSettingsRoute ? (
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
            // 左下导航球,底部一段式 Dock [ 固定功能区 | 已打开页面 ]
            <OsShellDesktopHost />
          )}
          <MobileNavFab />
        </SidebarProvider>
      </SearchProvider>
    </LayoutProvider>
  )
}

/**
 * OS 桌面壳宿主:挂载 window.__osShellOpenWindow 注入开窗能力,
 * 供头像菜单/搜索结果等全局组件把"路由跳转"转成"开新窗口"
 * (见 os-shell/os-open.ts 的说明)
 */
function OsShellDesktopHost() {
  const items = useOsNavItems()
  const openWindow = useOsWindowsStore((s) => s.openWindow)

  useEffect(() => {
    ;(
      window as unknown as {
        __osShellOpenWindow?: OsShellOpenWindow
      }
    ).__osShellOpenWindow = (url: string) => {
      if (isSettingsUrl(url)) return false
      const nav = matchOsNavItem(items, url)
      openWindow({ url, title: nav?.title ?? url })
      return true
    }
    return () => {
      delete (
        window as unknown as { __osShellOpenWindow?: unknown }
      ).__osShellOpenWindow
    }
  }, [items, openWindow])

  return (
    <div className='relative h-svh w-full overflow-hidden'>
      <OsWindowManager />
      <OsNavBall />
      {/* 一段式 Dock:[ 搜索 公告 语言 主题 头像 连接组 | 已打开页面 ] */}
      <OsDock />
    </div>
  )
}

/** OS 窗口内容:仅系统设置页保留侧栏(分区导航需要),其余页面全宽铺窗口 */
function OsWindowContent({ children }: { children: React.ReactNode }) {
  const pathname = useLocation({ select: (s) => s.pathname })
  const isSettings =
    pathname.startsWith('/settings') || pathname.startsWith('/system-settings')
  if (!isSettings) {
    return (
      <div className='@container/content h-svh w-full overflow-y-auto overscroll-contain'>
        {children}
      </div>
    )
  }
  return (
    <div className='flex min-h-0 w-full flex-1'>
      <AppSidebar />
      <SidebarInset className='@container/content h-svh min-h-0 flex-1 overflow-hidden peer-data-[variant=inset]:h-svh'>
        <div className='h-svh w-full overflow-y-auto overscroll-contain'>
          {children}
        </div>
      </SidebarInset>
    </div>
  )
}
