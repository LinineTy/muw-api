// @muw-owned
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { MOBILE_BREAKPOINT } from '@/hooks/use-mobile'
import {
  useOsWindowsStore,
  readPersistedWindows,
} from '@/stores/os-windows-store'

import { OsDesktopPlaceholder } from './os-desktop-placeholder'
import { isSettingsUrl, isStandaloneProtocolUrl } from './os-open'
import { OsWindowFrame } from './os-window'
import { useOsNavItems, matchOsNavItem } from './use-os-nav'

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

  /** 壳的桌面路径:刷新/深链/从设置返回的落点,不再是 /dashboard(概览) */
  const SHELL_HOME = '/os-desktop'
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

    // 手机视口不走 OS 壳(布局层不挂本组件):深链=普通路由渲染,
    // 不做"开窗+回桌面"。桌面窄窗口同理走手机布局。
    if (window.innerWidth < MOBILE_BREAKPOINT) return

    const { pathname: path, search } = window.location
    // 桌面自身路径:/os-desktop(= 壳的桌面)与 /console(旧别名)。
    // 这里必须放行,否则刷新落在 /dashboard 时代码会把"当前路径"当成深链
    // 开成窗口 —— 表现就是空桌面一刷新自动弹出概览窗。
    const isDesktopPath = path === SHELL_HOME || path === '/console'
    if (!isDesktopPath) {
      // 设置页已退出多窗口:回桌面壳空态,不开窗
      // 协议端点(同意页/回调)同样独立成页,不经壳
      if (isSettingsUrl(path) || isStandaloneProtocolUrl(path)) {
        navigate({ to: SHELL_HOME, replace: true })
        return
      }
      // 深链:该页面开成窗口,主层回到桌面
      // 同时恢复上次会话的窗(全部最小化藏 Dock,不打扰深链窗)
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
      const nav = matchOsNavItem(items, path)
      // 带查询串的深链要连查询串一起开窗:查询串是页面状态(如
      // /oauth/consent?request=… 的签名授权请求),只取 pathname 会让窗口
      // 拿不到参数。有查询串时也不再回退到导航项里那个不带参数的规范 URL。
      openWindow(
        nav && !search
          ? { url: nav.url, title: nav.title }
          : { url: `${path}${search}`, title: nav?.title ?? path }
      )
      navigate({ to: SHELL_HOME, replace: true })
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

  return (
    <>
      {/* 桌面导航磁贴**常显**（2026-09-11 定）：不再只在「没有可见窗口」时出现 ——
          它是普通流内元素，而窗口是 absolute 定位，按 CSS 绘制顺序窗口天然盖在它上面，
          所以常显不会挡住窗口；窗口没覆盖到的区域照样能点磁贴。
          仍保留原来的最小化语义：窗口最小化后磁贴自然露出来。 */}
      <OsDesktopPlaceholder />
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
    </>
  )
}
