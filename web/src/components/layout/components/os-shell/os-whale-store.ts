// @muw-owned
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * OS 壳 · 小鲸鱼挂件偏好（显隐 / 大小 / 音效开关 / 音效集 / 音量）
 *
 * 存**浏览器本地**（zustand persist → localStorage），与桌面小组件的显隐偏好同一套思路：
 * 挂件是"个人桌面装饰"，换浏览器回到默认即可，不值得为它加后端字段。
 *
 * 大小范围是原版 0.6–2.5 收紧后的口径（2026-09-14「压小吧，然后默认大小也缩小」）：
 * 上限 2.5 → 2.0、默认 1.5 → 1.2（1440×900 下鲸鱼本体 223px → 178px）；
 * 原版那套后端 size.json 落盘机制不要 ——
 * 这里没有宿主进程，偏好放浏览器就够。
 */
export const WHALE_MIN_SCALE = 0.6
export const WHALE_MAX_SCALE = 2.0
export const WHALE_DEFAULT_SCALE = 1.2

/**
 * 音效集 —— 与上游汉堡菜单「行2 音效」的两个选项一一对应
 * （上游走 `/dsh-whale/sound/press.mp3?set=duck|fx1`，这里直接落成两个素材路径）：
 * - `duck`：小黄鸭 Ya1/Ya2（原版默认，就是那声"嘎"）
 * - `fx1`：音效 1 → D1/D2（更闷的一声"咚"）
 * 2026-09-14「要的」= 两套都要，所以做成可选而不是替换。
 */
export const WHALE_SOUND_SETS = ['duck', 'fx1'] as const
export type WhaleSoundSet = (typeof WHALE_SOUND_SETS)[number]
export const WHALE_DEFAULT_SOUND_SET: WhaleSoundSet = 'duck'

/** 音效集 → 按压/松手素材 */
export const WHALE_SOUND_FILES: Record<
  WhaleSoundSet,
  { press: string; release: string }
> = {
  duck: {
    press: '/os-whale/duck-press.mp3',
    release: '/os-whale/duck-release.mp3',
  },
  fx1: {
    press: '/os-whale/fx1-press.mp3',
    release: '/os-whale/fx1-release.mp3',
  },
}

/** localStorage 里可能是手改过的脏值，读出来一律归一 */
function normalizeSoundSet(value: unknown): WhaleSoundSet {
  return WHALE_SOUND_SETS.includes(value as WhaleSoundSet)
    ? (value as WhaleSoundSet)
    : WHALE_DEFAULT_SOUND_SET
}

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
  /**
   * 整个挂件的显隐（2026-09-14：「万一不想看了还能关掉」）。
   * 关掉 = `OsWhale` 直接不渲染：盒子/像素命中/气泡/音效一起消失，右下角点击照常穿透。
   * 入口在侧栏「鲸鱼」球 —— 球属于竖条、不受这里影响，所以关了还能再打开。
   */
  visible: boolean
  /** 鲸鱼大小倍数（0.6–2.0） */
  scale: number
  /** 按压/松手音效开关 */
  soundOn: boolean
  /** 音量 0–1 */
  volume: number
  /** 音效集（小黄鸭 / 音效 1） */
  soundSet: WhaleSoundSet
  setScale: (scale: number) => void
  setSoundOn: (on: boolean) => void
  setVolume: (volume: number) => void
  setSoundSet: (soundSet: WhaleSoundSet) => void
  setVisible: (visible: boolean) => void
}

export const useOsWhaleStore = create<OsWhaleStore>()(
  persist(
    (set) => ({
      visible: true,
      scale: WHALE_DEFAULT_SCALE,
      soundOn: true,
      volume: 1,
      soundSet: WHALE_DEFAULT_SOUND_SET,
      setScale: (scale) => set({ scale: clampScale(scale) }),
      setSoundOn: (on) => set({ soundOn: on }),
      setVolume: (volume) => set({ volume: clampVolume(volume) }),
      setSoundSet: (soundSet) => set({ soundSet: normalizeSoundSet(soundSet) }),
      setVisible: (visible) => set({ visible }),
    }),
    {
      name: 'os-whale',
      partialize: (state) => ({
        visible: state.visible,
        scale: state.scale,
        soundOn: state.soundOn,
        volume: state.volume,
        soundSet: state.soundSet,
      }),
      // 存进去的可能是手改过的脏值，读出来一律过一遍边界
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<OsWhaleStore>
        return {
          ...current,
          visible: saved.visible !== false,
          scale: clampScale(Number(saved.scale)),
          soundOn: saved.soundOn !== false,
          volume: clampVolume(Number(saved.volume)),
          soundSet: normalizeSoundSet(saved.soundSet),
        }
      },
    }
  )
)
