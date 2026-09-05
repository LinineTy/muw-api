// @muw-owned
import { create } from 'zustand'

/**
 * OS 壳左下双球互斥状态:
 * 导航球(nav)与顶栏球(topbar)的弹卡同时展开会相互遮挡,
 * 用全局 store 保证同一时刻至多展开一个。
 */
type OsBallStore = {
  /** 当前展开的球;'null'=全部收起 */
  active: 'nav' | 'topbar' | null
  /** 切换指定球:已展开则收起,否则展开并收起另一个 */
  toggle: (ball: 'nav' | 'topbar') => void
  /** 收起指定球(菜单项点击后收自己) */
  close: (ball: 'nav' | 'topbar') => void
}

export const useOsBallStore = create<OsBallStore>((set, get) => ({
  active: null,
  toggle: (ball) =>
    set({ active: get().active === ball ? null : ball }),
  close: (ball) =>
    set({ active: get().active === ball ? null : get().active }),
}))
