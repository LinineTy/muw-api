// @muw-owned
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * OS 壳 · 小鲸鱼挂件偏好（大小 / 音效开关 / 音量）
 *
 * 存**浏览器本地**（zustand persist → localStorage），与桌面小组件的显隐偏好同一套思路：
 * 挂件是"个人桌面装饰"，换浏览器回到默认即可，不值得为它加后端字段。
 *
 * 大小范围是原版 0.6–2.5 收紧后的口径（2026-09-14 maintainer「压小吧，然后默认大小也缩小」）：
 * 上限 2.5 → 2.0、默认 1.5 → 1.2（1440×900 下鲸鱼本体 223px → 178px）；
 * 原版那套后端 size.json 落盘机制不要 ——
 * 这里没有宿主进程，偏好放浏览器就够。
 */
export const WHALE_MIN_SCALE = 0.6
export const WHALE_MAX_SCALE = 2.0
export const WHALE_DEFAULT_SCALE = 1.2

/** 与滑动条步长一致（0.1） */
function clampScale(value: number): number {
  if (!Number.isFinite(value)) return WHALE_DEFAULT_SCALE
  return Math.min(
    WHALE_MAX_SCALE,
    Math.max(WHALE_MIN_SCALE, Math.round(value * 10) / 10)
  )
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100))
}

type OsWhaleStore = {
  /** 鲸鱼大小倍数（0.6–2.0） */
  scale: number
  /** 按压/松手音效开关 */
  soundOn: boolean
  /** 音量 0–1 */
  volume: number
  setScale: (scale: number) => void
  setSoundOn: (on: boolean) => void
  setVolume: (volume: number) => void
}

export const useOsWhaleStore = create<OsWhaleStore>()(
  persist(
    (set) => ({
      scale: WHALE_DEFAULT_SCALE,
      soundOn: true,
      volume: 1,
      setScale: (scale) => set({ scale: clampScale(scale) }),
      setSoundOn: (on) => set({ soundOn: on }),
      setVolume: (volume) => set({ volume: clampVolume(volume) }),
    }),
    {
      name: 'os-whale',
      partialize: (state) => ({
        scale: state.scale,
        soundOn: state.soundOn,
        volume: state.volume,
      }),
      // 存进去的可能是手改过的脏值，读出来一律过一遍边界
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<OsWhaleStore>
        return {
          ...current,
          scale: clampScale(Number(saved.scale)),
          soundOn: saved.soundOn !== false,
          volume: clampVolume(Number(saved.volume)),
        }
      },
    }
  )
)
