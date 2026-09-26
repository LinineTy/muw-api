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
  /** 关闭中:先播退出动画,动画结束才真正从数组移除 */
  closing?: boolean
  /** 最小化中:先播缩退动画,动画结束才真正藏入 Dock */
  minimizing?: boolean
  /** 会话恢复的窗口:不播入场动画(刷新后一屏窗口糊脸闪一遍) */
  restored?: boolean
  /** 窗口内还能不能后退/前进(由窗口自己上报,标题栏按钮用;不持久化) */
  canBack?: boolean
  canForward?: boolean
}

/** 窗口数量上限(超限时忽略并保持现状) */
export const OS_WINDOW_MAX = 6

/** sessionStorage 持久化键(刷新恢复窗口列表) */
const STORAGE_KEY = 'os-windows'

function loadPersisted(): Pick<
  OsWindowState,
  'id' | 'url' | 'title' | 'icon'
>[] {
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
  restoreWindows: (
    navs: { url: string; title: string; icon?: string }[]
  ) => void
  /** 窗口内跳转后同步该窗口的 url 与标题(几何/z 序等其余状态不动) */
  syncWindowUrl: (id: string, url: string, title: string) => void
  /** 窗口内上报历史可导航性(决定标题栏的后退/前进按钮是否可用) */
  setWindowHistory: (id: string, canBack: boolean, canForward: boolean) => void
  closeWindow: (id: string) => void
  /** 关闭第一步:置 closing 播退出动画;动画结束再调 closeWindow 真正移除 */
  requestCloseWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  /** 最小化第一步:置 minimizing 播缩退动画;动画结束再调 minimizeWindow 藏入 Dock */
  requestMinimizeWindow: (id: string) => void
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
  // PC 大屏利用:默认窗宽吃满可用宽(≥xl 断点,窗口内页面保持 PC 布局)
  const w = Math.max(1120, Math.min(1600, vw - 112))
  // 可用区=顶 16px 到 Dock 上沿(Dock 胶囊 12+52=64px 区);安卓平板式:
  // 底边几乎贴 Dock(8px);水平真居中,级联=左中右小循环不跑偏
  const availTop = 16
  const availH = vh - availTop - 64
  const h = Math.max(360, availH - 8)
  const k = index % 6
  const x = Math.min(
    Math.max((vw - w) / 2 + (((k + 1) % 3) - 1) * 28, 24),
    vw - w - 24
  )
  const y = availTop
  return { x, y, w, h }
}

/** 只看路径:窗口的 url 会带上页面自己的查询串(tab/分页这类状态),比较时忽略它 */
function pathOf(url: string) {
  return url.split(/[?#]/)[0]
}

/** 是否带查询串:带了就是"某个具体地址",没带就是应用入口 */
function hasQuery(url: string) {
  return /[?#]/.test(url)
}

export const useOsWindowsStore = create<OsWindowsStore>((set, get) => ({
  windows: [],
  activeId: null,

  openWindow: (nav) => {
    const { windows } = get()
    // 同一个应用(同路径)已有窗就激活它,不再开第二个 —— 但调用方给的是**具体地址**
    // (带查询串,如深链 `/orders?tab=pending`)时,已有的窗得真的停在那儿才算数,
    // 否则用户点了个深链却看到窗口原地不动
    const existed = windows.find(
      (w) =>
        pathOf(w.url) === pathOf(nav.url) &&
        (!hasQuery(nav.url) || w.url === nav.url)
    )
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
    const restored: OsWindowState[] = navs
      .slice(0, OS_WINDOW_MAX)
      .map((nav, i) => {
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
          restored: true,
        }
      })
    if (restored.length === 0) return
    // 恢复时全部最小化,由 Dock 唤起(避免刷新后一屏窗口糊脸)
    set({
      windows: restored.map((w) => ({ ...w, minimized: true })),
      activeId: null,
    })
  },

  syncWindowUrl: (id, url, title) => {
    const { windows } = get()
    let changed = false
    const next = windows.map((w) => {
      if (w.id !== id || (w.url === url && w.title === title)) return w
      changed = true
      return { ...w, url, title }
    })
    if (!changed) return
    set({ windows: next })
    persist(next)
  },

  setWindowHistory: (id, canBack, canForward) => {
    const { windows } = get()
    let changed = false
    const next = windows.map((w) => {
      if (w.id !== id || (w.canBack === canBack && w.canForward === canForward))
        return w
      changed = true
      return { ...w, canBack, canForward }
    })
    if (!changed) return
    // 不落 sessionStorage:历史是这次会话里的事,刷新后失效
    set({ windows: next })
  },

  requestCloseWindow: (id) => {
    const win = get().windows.find((w) => w.id === id)
    if (!win || win.closing || win.minimizing) return
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, closing: true } : w
      ),
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

  requestMinimizeWindow: (id) => {
    const win = get().windows.find((w) => w.id === id)
    if (!win || win.closing || win.minimizing || win.minimized) return
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, minimizing: true } : w
      ),
    })
  },

  minimizeWindow: (id) => {
    const { windows, activeId } = get()
    // 藏入同时清 minimizing——残留会让恢复后重播缩退动画且 forwards
    // 定格在透明(出来一下又缩回去,之后再也出不来)
    const next = windows.map((w) =>
      w.id === id ? { ...w, minimized: true, minimizing: false } : w
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
      windows: windows.map((w) => (w.id === id ? { ...w, zIndex: z } : w)),
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
      windows: get().windows.map((win) =>
        win.id === id ? { ...win, w, h, maximized: false } : win
      ),
    })
  },
}))

/** 供外部(layout 挂载时)读取持久化列表 */
export function readPersistedWindows() {
  return loadPersisted()
}
