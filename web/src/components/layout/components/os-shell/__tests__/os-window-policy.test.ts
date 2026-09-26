// @muw-owned
import { describe, expect, test } from 'vitest'

import {
  osWindowEscapesToHost,
  resolveOsWindowAction,
  splitOsShellUrl,
  type OsWindowActionDeps,
} from '../os-window-policy'

/**
 * 窗口内导航策略 · 决定一次窗内跳转该由谁处理
 *
 * 背景:窗口是 iframe,里面的页面自己跳转时外层毫无感知 —— 设置页会在窗口里
 * 套一层侧栏、协议端点(同意页/回调)会在窗口里走不完流程、不存在的路径会在
 * 窗口里渲染 404。这层判据把这三类交回主层,壳管辖但不是导航项的页面(详情页)
 * 开成新窗口,只有命中导航项的页面就地开在当前窗口。
 */
function deps(over: Partial<OsWindowActionDeps> = {}): OsWindowActionDeps {
  return {
    isShellHome: (pathname) => pathname === '/os-desktop',
    routeScope: () => ({ exists: true, inShell: true }),
    hasNavItem: () => true,
    ...over,
  }
}

describe('resolveOsWindowAction', () => {
  test('就地开在当前窗口:壳管辖且命中导航项', () => {
    expect(resolveOsWindowAction('/channels', deps())).toBe('window')
    expect(resolveOsWindowAction('/usage-logs/common', deps())).toBe('window')
  })

  test('开新窗口:壳管辖但导航项里没有它(详情页等)', () => {
    expect(
      resolveOsWindowAction('/records/42', deps({ hasNavItem: () => false }))
    ).toBe('open')
  })

  test('交回主层:不存在的路径(外层 404)', () => {
    expect(
      resolveOsWindowAction(
        '/no-such-page',
        deps({ routeScope: () => ({ exists: false, inShell: false }) })
      )
    ).toBe('host')
  })

  test('交回主层:有路由但不属于壳管辖(公开页等)', () => {
    expect(
      resolveOsWindowAction(
        '/pricing',
        deps({ routeScope: () => ({ exists: true, inShell: false }) })
      )
    ).toBe('host')
  })

  test('交回主层:设置页与协议端点', () => {
    expect(resolveOsWindowAction('/system-settings/site', deps())).toBe('host')
    expect(resolveOsWindowAction('/settings/general', deps())).toBe('host')
    expect(resolveOsWindowAction('/oauth/consent?request=x', deps())).toBe(
      'host'
    )
    expect(resolveOsWindowAction('/oauth/github', deps())).toBe('host')
  })

  test('第三方应用控制台不是协议端点,照常按导航项走', () => {
    expect(resolveOsWindowAction('/oauth/applications', deps())).toBe('window')
    expect(
      resolveOsWindowAction(
        '/oauth/applications',
        deps({ hasNavItem: () => false })
      )
    ).toBe('open')
  })

  test('交回主层:壳桌面自身(含旧别名 /console)', () => {
    const scope = deps({
      isShellHome: (pathname) =>
        pathname === '/os-desktop' || pathname === '/console',
    })
    expect(resolveOsWindowAction('/os-desktop', scope)).toBe('host')
    expect(resolveOsWindowAction('/console', scope)).toBe('host')
  })

  test('交回主层优先于导航项与路由判据(设置页即使都命中也不留在窗口里)', () => {
    expect(
      resolveOsWindowAction(
        '/system-settings/site',
        deps({
          hasNavItem: () => true,
          routeScope: () => ({ exists: true, inShell: true }),
        })
      )
    ).toBe('host')
  })
})

describe('splitOsShellUrl', () => {
  test('拆出路径与查询串', () => {
    expect(splitOsShellUrl('/oauth/consent?request=x&y=1')).toEqual({
      pathname: '/oauth/consent',
      search: '?request=x&y=1',
    })
  })

  test('无查询串时 search 为空', () => {
    expect(splitOsShellUrl('/keys')).toEqual({ pathname: '/keys', search: '' })
  })
})

describe('osWindowEscapesToHost', () => {
  test('预加载一律放行 —— 悬停链接也会预加载,那时不能请求主层', () => {
    // defaultPreload: 'intent' 下鼠标划过 <Link> 就会预加载并跑 beforeLoad;
    // 此处若去请求主层,表现为「只是划过就把页面跳走 / 开出新窗口」
    expect(osWindowEscapesToHost('/system-settings/site', 'preload')).toBe(
      false
    )
    expect(osWindowEscapesToHost('/no-such-page', 'preload')).toBe(false)
  })

  test('不在窗口里(主层自己)一律放行', () => {
    expect(osWindowEscapesToHost('/system-settings/site', 'enter')).toBe(false)
  })
})
