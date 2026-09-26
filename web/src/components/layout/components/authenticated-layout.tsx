import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'
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
import { useEffect, useRef } from 'react'

import { AnimatedOutlet } from '@/components/page-transition'
import { SkipToMain } from '@/components/skip-to-main'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { useIsMobile } from '@/hooks/use-mobile'
import { installParentAuthBridge } from '@/lib/auth-session'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { useOsWindowsStore } from '@/stores/os-windows-store'

import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'
import { MobileNavFab } from './mobile-nav-fab'
import { OsDock } from './os-shell/os-dock'
import {
  isSettingsUrl,
  isShellHomeUrl,
  isStandaloneProtocolUrl,
  type OsShellOpenWindow,
} from './os-shell/os-open'
import { OsSideStrip } from './os-shell/os-side-strip'
import { OsWhale } from './os-shell/os-whale'
import { OsWindowManager } from './os-shell/os-window-manager'
import {
  getOsWindowSyncBridge,
  rememberOsWindowHref,
  resolveOsWindowAction,
  SHELL_ROUTE_SUBTREE_ID,
  splitOsShellUrl,
  type OsWindowNavigationBridge,
  type OsWindowSyncBridge,
} from './os-shell/os-window-policy'
import { matchOsNavItem, useOsNavItems } from './os-shell/use-os-nav'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

/** OS 壳多窗口的 iframe 内容检测:子应用退化为纯内容模式(无壳) */
const IN_OS_WINDOW = typeof window !== 'undefined' && window.self !== window.top

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

/**
 * 窗口 iframe 内:每次跳转后把当前地址回填给主层,让窗口标题栏与 Dock 跟着走
 * (否则窗口内跳到别的页面后,标题/图标仍停在打开时那一页)。
 * 窗口 id 取自宿主 iframe 元素上由 os-window.tsx 写入的 data-os-window-id。
 */
function useOsWindowUrlReport() {
  const href = useLocation({ select: (s) => s.href })
  const router = useRouter()
  // 本窗口访问过的最大历史下标:当前下标藏在自己的 history.state 里,
  // @tanstack/history 只公开 canGoBack,判断"还能不能前进"得靠它
  const furthest = useRef(0)
  useEffect(() => {
    if (!IN_OS_WINDOW) return
    // 导航守卫要用"上一次渲染出来的地址"判同址重入(popstate 时 location 已变)
    rememberOsWindowHref(href)
    const id = (window.frameElement as HTMLElement | null)?.dataset.osWindowId
    if (!id) return
    const index = window.history.state?.__TSR_index ?? 0
    if (index > furthest.current) furthest.current = index
    getOsWindowSyncBridge()?.(id, href, {
      canBack: router.history.canGoBack(),
      canForward: index < furthest.current,
    })
  }, [href, router])
}

export function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const isMobile = useIsMobile()
  // 设置页退出多窗口:始终主层完整布局(侧栏分区导航复杂度高,窗口化收益低,
  // 且仅管理员可见)——多窗口只对非设置页生效
  const pathname = useLocation({ select: (s) => s.pathname })
  const isSettingsRoute = isSettingsUrl(pathname)
  // 协议端点(授权同意页/回调)独立成页:不挂壳、不留侧栏与顶栏
  const isProtocolRoute = isStandaloneProtocolUrl(pathname)
  useIframeTransparentBackground(IN_OS_WINDOW)
  useOsWindowUrlReport()

  // 主层(OS 壳 PC 分支)安装认证桥:窗口 iframe 的 session 刷新委托主层,
  // N 窗共享一次 /api/user/auth/refresh,避免烧穿 CriticalRateLimit(429)
  useEffect(() => {
    if (!IN_OS_WINDOW && !isMobile) installParentAuthBridge()
  }, [isMobile])

  // iframe 内容模式:OS 窗口内的页面 = 原布局去顶栏。
  // AppSidebar 只给系统设置类页面(/settings)——侧栏分区导航仅设置页需要,
  // 其他页面全宽铺窗口,避免每页都顶一条侧栏
  if (isProtocolRoute) {
    return (
      <LayoutProvider>
        <SearchProvider>
          <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
            {props.children ?? <AnimatedOutlet />}
          </SidebarProvider>
        </SearchProvider>
      </LayoutProvider>
    )
  }

  if (IN_OS_WINDOW) {
    return (
      <LayoutProvider>
        <SearchProvider>
          <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
            <OsWindowContent>
              {props.children ?? <AnimatedOutlet />}
            </OsWindowContent>
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
 * OS 桌面壳宿主:把壳的能力挂到 window 上,供壳内各处(以及窗口 iframe)取用 —
 * `__osShellOpenWindow` 给主层入口(头像菜单/搜索/磁贴)把"路由跳转"转成"开窗",
 * `__osShellWindowNavigation` 给窗口 iframe 裁决其中的页面跳转,
 * `__osShellSyncWindowUrl` 接收窗口内的地址变化回填标题。
 * (见 os-shell/os-open.ts 与 os-shell/os-window-policy.ts)
 */
function OsShellDesktopHost() {
  const items = useOsNavItems()
  const router = useRouter()
  const navigate = useNavigate()
  const openWindow = useOsWindowsStore((s) => s.openWindow)
  const syncWindowUrl = useOsWindowsStore((s) => s.syncWindowUrl)
  const setWindowHistory = useOsWindowsStore((s) => s.setWindowHistory)

  useEffect(() => {
    const host = window as unknown as {
      __osShellOpenWindow?: OsShellOpenWindow
      __osShellWindowNavigation?: OsWindowNavigationBridge
      __osShellSyncWindowUrl?: OsWindowSyncBridge
    }

    host.__osShellOpenWindow = (url: string) => {
      if (isSettingsUrl(url) || isStandaloneProtocolUrl(url)) return false
      const nav = matchOsNavItem(items, url)
      openWindow({ url, title: nav?.title ?? url })
      return true
    }

    host.__osShellWindowNavigation = (url: string) => {
      const action = resolveOsWindowAction(url, {
        isShellHome: isShellHomeUrl,
        routeScope: (pathname) => {
          const { matchedRoutes, foundRoute } =
            router.getMatchedRoutes(pathname)
          return {
            exists: Boolean(foundRoute),
            inShell: matchedRoutes.some(
              (route) => route.id === SHELL_ROUTE_SUBTREE_ID
            ),
          }
        },
        hasNavItem: (pathname) => Boolean(matchOsNavItem(items, pathname)),
      })
      if (action === 'host') {
        // 交回主层:设置页走完整布局、协议页独立成页、其余(公开页/404)
        // 由主层路由自己渲染,壳随之卸载
        void navigate({ href: url } as never)
      } else if (action === 'open') {
        // 走到这里说明导航项里没有它,标题先落到路径上
        const { pathname } = splitOsShellUrl(url)
        openWindow({ url, title: pathname })
      }
      return action
    }

    host.__osShellSyncWindowUrl = (id: string, url: string, history) => {
      const { pathname } = splitOsShellUrl(url)
      syncWindowUrl(id, url, matchOsNavItem(items, pathname)?.title ?? pathname)
      setWindowHistory(id, history.canBack, history.canForward)
    }

    return () => {
      delete host.__osShellOpenWindow
      delete host.__osShellWindowNavigation
      delete host.__osShellSyncWindowUrl
    }
  }, [items, navigate, openWindow, router, setWindowHistory, syncWindowUrl])

  return (
    <div className='relative h-svh w-full overflow-hidden'>
      <OsWindowManager />
      {/* 左侧细竖条:[ 品牌 … 语言·主题·头像 ─── 快速导航·公告·第三方接入 ] */}
      <OsSideStrip />
      {/* 底部 Dock(整体居中、视觉分两节):[ 搜索 | 开始磁贴 ] [ 已打开窗口 ] */}
      <OsDock />
      {/* 右下角小鲸鱼挂件(装饰件,纯手感:压扁/音效/台词气泡) */}
      <OsWhale />
    </div>
  )
}

/** OS 窗口内容:仅系统设置页保留侧栏(分区导航需要),其余页面全宽铺窗口 */
function OsWindowContent({ children }: { children: React.ReactNode }) {
  const pathname = useLocation({ select: (s) => s.pathname })
  // 需要侧栏的页面:仅设置页(分区导航)。
  // 聊天预设是独立模块,走 Dock 预设球,不在聊天窗里塞全量导航
  const needsSidebar =
    pathname.startsWith('/settings') || pathname.startsWith('/system-settings')
  if (!needsSidebar) {
    return (
      // flex-col:让页面 Main 的 flex-1 生效撑满,分页器 footer 才能置底
      <div className='@container/content flex h-svh w-full flex-col overflow-y-auto overscroll-contain'>
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
