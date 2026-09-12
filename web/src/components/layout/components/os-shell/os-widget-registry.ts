// @muw-owned
import type { ComponentType } from 'react'

import { OsDesktopBalance } from './os-desktop-balance'
import { OsDesktopModelHealth } from './os-desktop-model-health'
import { OsDesktopNotices } from './os-desktop-notices'
import { OsDesktopRequests } from './os-desktop-requests'
import { OsDesktopSystemMetrics } from './os-desktop-system-metrics'

/**
 * OS 桌面 · 小组件注册表（**唯一来源**）
 *
 * 桌面网格的渲染顺序、竖条"组件"球里的开关列表，都从这里取 —— 加/删组件只改这一处，
 * 不会出现"网格里有、菜单里没有"这种对不上的情况。
 *
 * 字段：
 * - id：显隐偏好的键（os-widget-store 的 hidden 映射），**改名等于重置用户偏好**，别乱动
 * - labelKey：菜单里的显示名，用现有 i18n 键（i18n 的键就是英文原句，凭空造键＝新增漏译）
 * - Render：组件本体（无 props，自己取数；无数据时自行 return null）
 * - menuHidden：不进"组件"菜单 —— 公告卡有自己的开关（竖条铃铛），
 *   两处能关同一个东西只会让人困惑
 */
export interface OsWidgetEntry {
  id: string
  labelKey: string
  Render: ComponentType
  menuHidden?: boolean
}

/** 顺序 = 桌面网格里的摆放顺序（行优先） */
export const OS_WIDGETS: OsWidgetEntry[] = [
  { id: 'system-load', labelKey: 'System Load', Render: OsDesktopSystemMetrics },
  { id: 'model-health', labelKey: 'Model Health', Render: OsDesktopModelHealth },
  { id: 'balance', labelKey: 'Balance', Render: OsDesktopBalance },
  { id: 'requests', labelKey: 'Requests', Render: OsDesktopRequests },
  {
    id: 'announcements',
    labelKey: 'System Announcements',
    Render: OsDesktopNotices,
    menuHidden: true,
  },
]

/** 可在"组件"菜单里开关的项 */
export const OS_WIDGET_MENU_ITEMS = OS_WIDGETS.filter((item) => !item.menuHidden)
