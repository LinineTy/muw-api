// @muw-owned
import { describe, expect, test } from 'vitest'

import { matchOsNavItem, type OsNavItem } from '../use-os-nav'

/**
 * 桌面壳导航匹配 · 窗口标题/图标全靠它
 *
 * 2026-09-13 截图：点 CPU/内存、请求数小组件开出的窗口标题是原始路径 `/dashboard`、
 * Dock 没图标 —— 小组件当时传的是分段页的 index stub（`/dashboard`、`/usage-logs`），
 * 匹配不到导航项就被兜成"标题 = url"。除小组件改指规范 URL 外，这里再加一层父路径兜底，
 * 让任何父路径入口都能落到该分区的默认页（标题/图标正常）。
 */
const ITEMS: OsNavItem[] = [
  { title: 'Overview', url: '/dashboard/overview', icon: () => null },
  { title: 'Model Call Analytics', url: '/dashboard/models', icon: () => null },
  { title: 'Usage Logs', url: '/usage-logs/common', icon: () => null },
  { title: 'Audit Logs', url: '/usage-logs/audit', icon: () => null },
  { title: 'Accounts', url: '/accounts', icon: () => null },
]

describe('matchOsNavItem', () => {
  test('精确命中与子路径命中（最长前缀优先）', () => {
    expect(matchOsNavItem(ITEMS, '/accounts')?.title).toBe('Accounts')
    expect(matchOsNavItem(ITEMS, '/accounts/12/edit')?.title).toBe('Accounts')
    expect(matchOsNavItem(ITEMS, '/dashboard/overview')?.title).toBe('Overview')
  })

  test('父路径兜底：落到导航顺序里的第一个子项（= 分区默认页）', () => {
    expect(matchOsNavItem(ITEMS, '/dashboard')?.url).toBe('/dashboard/overview')
    expect(matchOsNavItem(ITEMS, '/usage-logs')?.url).toBe('/usage-logs/common')
    // 末尾斜杠同样兜得住
    expect(matchOsNavItem(ITEMS, '/dashboard/')?.url).toBe(
      '/dashboard/overview'
    )
  })

  test('不是任何导航项（含根路径）就不匹配 —— 标题仍由调用方兜成 url', () => {
    expect(matchOsNavItem(ITEMS, '/os-desktop')).toBeUndefined()
    expect(matchOsNavItem(ITEMS, '/')).toBeUndefined()
    expect(matchOsNavItem(ITEMS, '/accounts-old')).toBeUndefined()
  })
})
