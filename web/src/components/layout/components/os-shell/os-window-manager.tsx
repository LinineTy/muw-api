// @muw-owned
import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { useOsNavItems, matchOsNavItem } from './use-os-nav'
import {
  useOsWindowsStore,
  readPersistedWindows,
} from '@/stores/os-windows-store'
import { OsWindowFrame } from './os-window'
import { OsDesktopPlaceholder } from './os-desktop-placeholder'

/**
 * OS 桌面壳 · 窗口层:
 * - 渲染全部窗口(含最小化保活),点击置顶逻辑在窗口内
 * - 挂载时:深链访问(pathname 非 /console)→ 开成首窗并回 /console;
 *   普通进入 → 恢复 sessionStorage 持久化窗口(全部最小化,Dock 唤起)
 * - 无可见窗口时渲染空桌面态
 */
export function OsWindowManager() {
  const navigate = useNavigate()
  const items = useOsNavItems()
  const { windows, activeId, openWindow, restoreWindows } = useOsWindowsStore()
  const booted = useRef(false)

  useEffect(() => {
    if (booted.current) return
    booted.current = true

    const path = window.location.pathname
    if (path !== '/console') {
      // 深链:该页面开成窗口,主层回到桌面
      const nav = matchOsNavItem(items, path)
      openWindow(
        nav ? { url: nav.url, title: nav.title } : { url: path, title: path }
      )
      navigate({ to: '/console', replace: true })
    } else {
      // 恢复上次窗口(标题/图标用当前 nav 数据回填)
      const persisted = readPersistedWindows()
      if (persisted.length > 0) {
        restoreWindows(
          persisted.map((p) => {
            const nav = matchOsNavItem(items, p.url)
            return { url: p.url, title: nav?.title ?? p.title }
          })
        )
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = windows.filter((w) => !w.minimized)

  return (
    <>
      {windows.map((w) => {
        const nav = matchOsNavItem(items, w.url)
        return (
          <OsWindowFrame
            key={w.id}
            win={w}
            active={w.id === activeId}
            icon={nav?.icon}
          />
        )
      })}
      {visible.length === 0 ? <OsDesktopPlaceholder /> : null}
    </>
  )
}
