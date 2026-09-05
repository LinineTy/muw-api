// @muw-owned
import { create } from 'zustand'

/**
 * OS 壳左下导航球弹卡开关:
 * 功能球(搜索/公告/语言/主题/个人)已拆为独立 Radix 弹层自管理,
 * 此 store 只服务导航球自建弹卡;功能球点击时调 close('nav') 收起它。
 */
type OsBallStore = {
  /** 导航球弹卡是否展开 */
  active: boolean
  toggle: () => void
  close: () => void
}

export const useOsBallStore = create<OsBallStore>((set, get) => ({
  active: false,
  toggle: () => set({ active: !get().active }),
  close: () => set({ active: false }),
}))
