// @muw-owned
import { describe, expect, test } from 'vitest'

import {
  useOsWhaleStore,
  WHALE_DEFAULT_SCALE,
  WHALE_DEFAULT_SOUND_SET,
  WHALE_MAX_SCALE,
  WHALE_MIN_SCALE,
  WHALE_SOUND_FILES,
} from '../os-whale-store'

/**
 * 小鲸鱼挂件偏好（大小 / 音效开关 / 音效集 / 音量）
 *
 * 边界（0.6–2.0 倍、默认 1.2，2026-09-14 收紧）：滑动条之外还能从 localStorage 手改，
 * setter 一律过一遍夹取，避免脏值把鲸鱼放大到糊屏或缩到看不见。
 * 音效集同理：脏值（或以后删掉的旧集合名）一律回落到默认，不能把 whale 卡成无声。
 */
describe('小鲸鱼挂件偏好', () => {
  test('默认：1.2 倍、音效开、音量满、音效集 = 小黄鸭、挂件可见', () => {
    useOsWhaleStore.setState({
      visible: true,
      scale: WHALE_DEFAULT_SCALE,
      soundOn: true,
      volume: 1,
      soundSet: WHALE_DEFAULT_SOUND_SET,
    })
    const state = useOsWhaleStore.getState()
    expect(state.scale).toBe(WHALE_DEFAULT_SCALE)
    expect(state.scale).toBe(1.2)
    expect(state.soundOn).toBe(true)
    expect(state.volume).toBe(1)
    expect(state.soundSet).toBe('duck')
    expect(state.visible).toBe(true)
  })

  test('整个挂件可以关（关了 OsWhale 整块不渲染，见 os-whale.tsx 的 early return）', () => {
    useOsWhaleStore.getState().setVisible(false)
    expect(useOsWhaleStore.getState().visible).toBe(false)
    useOsWhaleStore.getState().setVisible(true)
    expect(useOsWhaleStore.getState().visible).toBe(true)
  })

  test('大小夹在 0.6–2.0，并按 0.1 取整', () => {
    const { setScale } = useOsWhaleStore.getState()
    setScale(99)
    expect(useOsWhaleStore.getState().scale).toBe(WHALE_MAX_SCALE)
    setScale(0)
    expect(useOsWhaleStore.getState().scale).toBe(WHALE_MIN_SCALE)
    setScale(1.23456)
    expect(useOsWhaleStore.getState().scale).toBe(1.2)
    setScale(Number.NaN)
    expect(useOsWhaleStore.getState().scale).toBe(WHALE_DEFAULT_SCALE)
  })

  test('音量夹在 0–1（保留两位）', () => {
    const { setVolume } = useOsWhaleStore.getState()
    setVolume(3)
    expect(useOsWhaleStore.getState().volume).toBe(1)
    setVolume(-1)
    expect(useOsWhaleStore.getState().volume).toBe(0)
    setVolume(0.4567)
    expect(useOsWhaleStore.getState().volume).toBe(0.46)
  })

  test('音效开关可关（关了就不出声，见 os-whale 的音效门）', () => {
    useOsWhaleStore.getState().setSoundOn(false)
    expect(useOsWhaleStore.getState().soundOn).toBe(false)
    useOsWhaleStore.getState().setSoundOn(true)
    expect(useOsWhaleStore.getState().soundOn).toBe(true)
  })

  test('音效集可切（小黄鸭 ⇄ 音效 1），脏值回落默认', () => {
    const { setSoundSet } = useOsWhaleStore.getState()
    setSoundSet('fx1')
    expect(useOsWhaleStore.getState().soundSet).toBe('fx1')
    setSoundSet('duck')
    expect(useOsWhaleStore.getState().soundSet).toBe('duck')
    // localStorage 被手改 / 以后删掉集合名时不能把鲸鱼卡成无声
    setSoundSet('fx2' as never)
    expect(useOsWhaleStore.getState().soundSet).toBe(WHALE_DEFAULT_SOUND_SET)
  })

  test('两套素材各自成套，路径互不相同', () => {
    const { duck, fx1 } = WHALE_SOUND_FILES
    expect(duck.press).toBe('/os-whale/duck-press.mp3')
    expect(duck.release).toBe('/os-whale/duck-release.mp3')
    expect(fx1.press).toBe('/os-whale/fx1-press.mp3')
    expect(fx1.release).toBe('/os-whale/fx1-release.mp3')
    // 按压与松手不能是同一个文件（同文件会互相抢断，原版专门为此加了 100ms 重叠逻辑）
    for (const set of [duck, fx1]) expect(set.press).not.toBe(set.release)
  })
})
