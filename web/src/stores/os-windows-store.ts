// @muw-owned
import { create } from 'zustand'

/** 单窗口状态(位置/尺寸独立,iframe 保活) */
export type OsWindowState = {
  id: string
  url: string
  title: string
  icon?: string // lucide 图标名,恢复时由 nav 数据回填组件
  x: number
  y: number
  w: number | null // null=默认自适应宽
  h: number | null
  maximized: boolean
  minimized: boolean
  zIndex: number
  /** 懒加载:恢复的最小化窗口尚未被唤起过,iframe 不挂真 src(避免刷新后 N 窗齐发请求) */
  lazy?: boolean
}

/** 窗口数量上限(超限时忽略并保持现状) */
export const OS_WINDOW_MAX = 6

/** sessionStorage 持久化键(刷新恢复窗口列表) */
const STORAGE_KEY = 'os-windows'

function loadPersisted(): Pick<OsWindowState, 'id' | 'url' | 'title' | 'icon'>[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, OS_WINDOW_MAX) : []
  } catch {
    return []
  }
}

function persist(windows: OsWindowState[]) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        windows.map(({ id, url, title, icon }) => ({ id, url, title, icon }))
      )
    )
  } catch {
    /* 私密模式等场景静默失败 */
  }
}

type OsWindowsStore = {
  windows: OsWindowState[]
  activeId: string | null
  /** 打开(或激活已开)窗口;同 url 不重复开 */
  openWindow: (nav: { url: string; title: string; icon?: string }) => void
  /** 兼容恢复:只按 url 恢复 */
  restoreWindows: (navs: { url: string; title: string; icon?: string }[]) => void
  closeWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  activateWindow: (id: string) => void
  toggleMaximize: (id: string) => void
  moveWindow: (id: string, x: number, y: number) => void
  resizeWindow: (id: string, w: number, h: number) => void
}

/**
 * 窗口 z 序分配:
 * - 区间 [10, Z_CAP],窗口层整体必须压在球(70)/弹卡(69)/Radix 二级弹窗(50+)之下,
 *   否则反复激活后窗口爬升会反过来盖住控制球(实测 bug)
 * - 超过 Z_CAP 时全窗归一化重排(按原相对顺序紧凑到 10..n),zCounter 回位
 */
const Z_BASE = 10
const Z_CAP = 45
let zCounter = Z_BASE

function nextZ(windows: OsWindowState[]): number {
  if (zCounter < Z_CAP) return ++zCounter
  const sorted = [...windows].sort((a, b) => a.zIndex - b.zIndex)
  sorted.forEach((w, i) => {
    w.zIndex = Z_BASE + i
  })
  zCounter = Z_BASE + sorted.length
  return ++zCounter
}

/** 默认几何:画布内居中 + 级联偏移(每窗右下错 28px,6 轮回绕) */
function defaultGeometry(index: number) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  // 画布可视区:左右各 32px padding + 右侧影子余量,顶部 16px,底部给 Dock 让 104px
  const w = Math.min(1100, vw - 64 - 48)
  const h = Math.max(360, vh - 16 - 104 - 28)
  const k = index % 6
  const x = Math.max(24, (vw - w) / 2 - 24 + k * 28)
  const y = Math.max(12, 8 + k * 28)
  return { x, y, w, h }
}

export const useOsWindowsStore = create<OsWindowsStore>((set, get) => ({
  windows: [],
  activeId: null,

  openWindow: (nav) => {
    const { windows } = get()
    const existed = windows.find((w) => w.url === nav.url)
    if (existed) {
      // 已开:恢复最小化并置顶激活(解除懒加载,让 iframe 挂真 src)
      const z = nextZ(windows)
      set({
        activeId: existed.id,
        windows: windows.map((w) =>
          w.id === existed.id
            ? { ...w, minimized: false, lazy: false, zIndex: z }
            : w
        ),
      })
      persist(get().windows)
      return
    }
    if (windows.length >= OS_WINDOW_MAX) return
    const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { x, y, w, h } = defaultGeometry(windows.length)
    set({
      activeId: id,
      windows: [
        ...windows,
        {
          id,
          url: nav.url,
          title: nav.title,
          icon: nav.icon,
          x,
          y,
          w,
          h,
          maximized: false,
          minimized: false,
          zIndex: nextZ(windows),
        },
      ],
    })
    persist(get().windows)
  },

  restoreWindows: (navs) => {
    const current = get().windows
    if (current.length > 0) return
    const restored: OsWindowState[] = navs.slice(0, OS_WINDOW_MAX).map((nav, i) => {
      const geo = defaultGeometry(i)
      return {
        id: `win-restore-${i}-${nav.url}`,
        url: nav.url,
        title: nav.title,
        icon: nav.icon,
        x: geo.x,
        y: geo.y,
        w: geo.w,
        h: geo.h,
        maximized: false,
        minimized: false,
        zIndex: nextZ(current),
        /** 恢复窗标懒加载:唤起时才挂真 src,避免刷新后 N 个 iframe 齐发请求(429) */
        lazy: true,
      }
    })
    if (restored.length === 0) return
    // 恢复时全部最小化,由 Dock 唤起(避免刷新后一屏窗口糊脸)
    set({
      windows: restored.map((w) => ({ ...w, minimized: true })),
      activeId: null,
    })
  },

  closeWindow: (id) => {
    const { windows, activeId } = get()
    const next = windows.filter((w) => w.id !== id)
    set({
      windows: next,
      activeId:
        activeId === id
          ? (next.filter((w) => !w.minimized).slice(-1)[0]?.id ?? null)
          : activeId,
    })
    persist(next)
  },

  minimizeWindow: (id) => {
    const { windows, activeId } = get()
    const next = windows.map((w) =>
      w.id === id ? { ...w, minimized: true } : w
    )
    set({
      windows: next,
      activeId: activeId === id ? null : activeId,
    })
  },

  restoreWindow: (id) => {
    const { windows } = get()
    const z = nextZ(windows)
    set({
      activeId: id,
      windows: windows.map((w) =>
        w.id === id ? { ...w, minimized: false, lazy: false, zIndex: z } : w
      ),
    })
  },

  activateWindow: (id) => {
    const { windows } = get()
    const z = nextZ(windows)
    set({
      activeId: id,
      windows: windows.map((w) =>
        w.id === id ? { ...w, zIndex: z } : w
      ),
    })
  },

  toggleMaximize: (id) => {
    const { windows } = get()
    set({
      windows: windows.map((w) =>
        w.id === id ? { ...w, maximized: !w.maximized, minimized: false } : w
      ),
    })
  },

  moveWindow: (id, x, y) => {
    set({
      windows: get().windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
    })
  },

  resizeWindow: (id, w, h) => {
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, w, h, maximized: false } : w
      ),
    })
  },
}))

/** 供外部(layout 挂载时)读取持久化列表 */
export function readPersistedWindows() {
  return loadPersisted()
}
