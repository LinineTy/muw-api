// @muw-owned
import { describe, expect, test } from 'vitest'

import {
  useOsWhaleStore,
  WHALE_DEFAULT_SCALE,
  WHALE_MAX_SCALE,
  WHALE_MIN_SCALE,
} from '../os-whale-store'

/**
 * 小鲸鱼挂件偏好（大小 / 音效 / 音量）
 *
 * 边界照搬原版（0.6–2.5 倍、默认 1.5）：滑动条之外还能从 localStorage 手改，
 * setter 一律过一遍夹取，避免脏值把鲸鱼放大到糊屏或缩到看不见。
 */
describe('小鲸鱼挂件偏好', () => {
  test('默认：1.5 倍、音效开、音量满', () => {
    useOsWhaleStore.setState({
      scale: WHALE_DEFAULT_SCALE,
      soundOn: true,
      volume: 1,
    })
    const state = useOsWhaleStore.getState()
    expect(state.scale).toBe(1.5)
    expect(state.soundOn).toBe(true)
    expect(state.volume).toBe(1)
  })

  test('大小夹在 0.6–2.5，并按 0.1 取整', () => {
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
})
