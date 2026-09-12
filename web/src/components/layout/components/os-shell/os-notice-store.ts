// @muw-owned
import { create } from 'zustand'

/**
 * OS 桌面壳 · 右侧时间线公告堆叠卡的展开/收起。
 *
 * 收起后不再自己留一个悬浮球（没角标、也没提示），入口回到左侧细条的
 * 公告球（原铃铛位置，带未读角标）：点一下恢复显示；新公告到来也会自动恢复。
 */
type OsNoticeStore = {
  /** 公告卡是否收起 */
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggle: () => void
}

export const useOsNoticeStore = create<OsNoticeStore>((set, get) => ({
  collapsed: false,
  setCollapsed: (collapsed) => set({ collapsed }),
  toggle: () => set({ collapsed: !get().collapsed }),
}))
