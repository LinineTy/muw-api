// @muw-owned
import { useMemo } from 'react'
import { useLocation } from '@tanstack/react-router'

import { useSidebarView } from '@/hooks/use-sidebar-view'
import type { NavItem } from '@/components/layout/types'

/** Dock / 窗口标题栏共用的扁平导航项 */
export type OsNavItem = {
  title: string
  url: string
  icon?: React.ElementType
}

/** 导航球弹卡用的分组结构(保留侧栏分组小标题) */
export type OsNavGroup = {
  id: string
  title: string
  items: OsNavItem[]
}

/** 把 NavGroup 树展平成带 icon 的链接列表(可折叠组取其子项) */
function flattenNavItems(items: NavItem[], out: OsNavItem[]) {
  for (const item of items) {
    if (item.type === 'chat-presets') continue
    if ('items' in item && item.items) {
      flattenNavItems(item.items as NavItem[], out)
      continue
    }
    if ('url' in item && item.url) {
      out.push({ title: item.title, url: item.url as string, icon: item.icon })
    }
  }
}

/**
 * OS 桌面壳共用导航数据(分组版):
 * - 复用 useSidebarView(权限/模块开关/i18n 全部继承侧栏语义)
 * - 保留侧栏的分组小标题,供导航球弹卡渲染
 * - 空组过滤(展平后无可见项的组不渲染标题)
 */
export function useOsNavGroups(): OsNavGroup[] {
  const { navGroups } = useSidebarView()

  return useMemo(() => {
    const out: OsNavGroup[] = []
    for (const group of navGroups) {
      const items: OsNavItem[] = []
      flattenNavItems(group.items, items)
      if (items.length > 0) {
        out.push({ id: group.id || group.title, title: group.title, items })
      }
    }
    return out
  }, [navGroups])
}

/**
 * OS 桌面壳共用导航数据(扁平版,Dock 消费)
 */
export function useOsNavItems(): OsNavItem[] {
  const groups = useOsNavGroups()
  return useMemo(() => groups.flatMap((g) => g.items), [groups])
}

/** 按当前 pathname 匹配导航项(最长前缀优先) */
export function matchOsNavItem(
  items: OsNavItem[],
  pathname: string
): OsNavItem | undefined {
  const matches = items.filter(
    (item) => pathname === item.url || pathname.startsWith(`${item.url}/`)
  )
  if (matches.length === 0) return undefined
  return matches.reduce((a, b) => (b.url.length > a.url.length ? b : a))
}

/** 当前激活导航项(窗口标题栏用) */
export function useActiveOsNavItem(): OsNavItem | undefined {
  const items = useOsNavItems()
  const pathname = useLocation({ select: (l) => l.pathname })
  return useMemo(() => matchOsNavItem(items, pathname), [items, pathname])
}
