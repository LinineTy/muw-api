// @muw-owned
import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { isSettingsUrl } from './os-open'
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
  const { windows, activeId, openWindow, restoreWindows, activateWindow } =
    useOsWindowsStore()
  const booted = useRef(false)

  // 点击 iframe 内部时,事件落在子文档里不会冒泡到父层;焦点转移的可见信号:
  // - focusin(target=iframe):主→iframe 及 iframeA→iframeB 都会触发
  // - focusout 后 activeElement 变为 iframe:focusin 缺失时兜底
  // - window blur + activeElement:最老牌的 hack,覆盖个别不派发 focusin 的环境
  useEffect(() => {
    const activateFromElement = () => {
      const el = document.activeElement
      if (el instanceof HTMLIFrameElement) {
        const id = el.dataset.osWindowId
        if (id) activateWindow(id)
      }
    }
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      if (el instanceof HTMLIFrameElement && el.dataset.osWindowId) {
        activateWindow(el.dataset.osWindowId)
      }
    }
    const onFocusOut = () => {
      setTimeout(activateFromElement, 0)
    }
    const onBlur = () => {
      setTimeout(activateFromElement, 0)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('blur', onBlur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (booted.current) return
    booted.current = true

    const path = window.location.pathname
    if (path !== '/console') {
      // 设置页已退出多窗口:回桌面壳空态,不开窗
      if (isSettingsUrl(path)) {
        navigate({ to: '/console', replace: true })
        return
      }
      // 深链:该页面开成窗口,主层回到桌面
      const nav = matchOsNavItem(items, path)
      openWindow(
        nav ? { url: nav.url, title: nav.title } : { url: path, title: path }
      )
      navigate({ to: '/console', replace: true })
    } else {
      // 恢复上次窗口(标题/图标用当前 nav 数据回填)
      const persisted = readPersistedWindows().filter(
        (p) => !isSettingsUrl(p.url)
      )
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
