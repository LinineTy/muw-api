// @muw-owned
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * OS 桌面 · 小组件的显隐偏好（maintainer 2026-09-12："不想要了怎么办"）
 *
 * 存**浏览器本地**（zustand persist → localStorage）：
 * - 桌面组件是"个人桌面装饰"，跟窗口位置一样属于本机偏好，不值得为它加后端字段；
 * - 换浏览器/清缓存会回到默认（全部显示），不影响数据，只是重新勾一次。
 *
 * ⚠️ 只存 hidden 映射（默认全显示）：以后新增组件不用改存储结构，老用户自动看到新组件。
 * 注意：按浏览器存，同一浏览器换账号登录会沿用上一个人的显隐 —— 目前可接受，
 * 真要多账号隔离再说（那属于"偏好要不要跟账号走"，跟后端同步是同一个决定）。
 */
type OsWidgetStore = {
  /** id → true 表示被用户隐藏 */
  hidden: Record<string, boolean>
  toggle: (id: string) => void
  show: (id: string) => void
}

export const useOsWidgetStore = create<OsWidgetStore>()(
  persist(
    (set, get) => ({
      hidden: {},
      toggle: (id) =>
        set({ hidden: { ...get().hidden, [id]: !get().hidden[id] } }),
      show: (id) => {
        const next = { ...get().hidden }
        delete next[id]
        set({ hidden: next })
      },
    }),
    {
      name: 'os-desktop-widgets',
      partialize: (state) => ({ hidden: state.hidden }),
    }
  )
)
