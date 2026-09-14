// @muw-owned
import { describe, expect, test } from 'vitest'

import {
  pickWhaleBubble,
  pickWhaleGifFailBubble,
  WHALE_GIF_FAIL_LINES,
  WHALE_PRAISE_LINES,
  WHALE_SNARK_LINES,
  WHALE_SOLO_LINES,
  WHALE_WHINE_LINES,
} from '../os-whale-lines'

/**
 * 小鲸鱼台词池 · 「只有嘴，没有数据」的护栏
 *
 * maintainer 2026-09-14 的口径是「我只要那个说骚话的，数据的不要」——原版权重 45% 的那组
 * （"当前时间段为: / 高峰时段 / 今日已用 ¥X"）必须彻底不存在于本仓，否则鲸鱼一开口
 * 就冒出一个我们根本没有的余额数字。这条用断言钉住，而不是靠"记得删过"。
 */
const ALL_POOLS = [
  ...WHALE_PRAISE_LINES,
  ...WHALE_WHINE_LINES,
  ...WHALE_SNARK_LINES,
  ...WHALE_SOLO_LINES,
  ...WHALE_GIF_FAIL_LINES,
]

describe('小鲸鱼台词池', () => {
  test('池子里没有任何数据类台词（时段 / 余额 / 今日已用 / 消耗）', () => {
    const forbidden = ['时段', '今日已用', '余额', '消耗', '¥', 'DeepSeek']
    for (const line of ALL_POOLS) {
      for (const word of forbidden) {
        expect(line).not.toContain(word)
      }
    }
  })

  test('台词不含 dsh 目录梗（本仓没有 dsh，原句搬过来会莫名）', () => {
    for (const line of ALL_POOLS) {
      expect(line.toLowerCase()).not.toContain('dsh')
    }
  })

  test('抽出来的内容只可能是「台词」或「动图」，且台词必来自池子', () => {
    for (let i = 0; i < 300; i++) {
      const bubble = pickWhaleBubble()
      if (bubble.kind === 'gif') continue
      const visible = bubble.rows.filter(Boolean)
      expect(visible).toHaveLength(1)
      // 单行居中：只有中间槽位有内容
      expect(bubble.rows[0]).toBeNull()
      expect(bubble.rows[2]).toBeNull()
      expect(ALL_POOLS).toContain(visible[0]?.t)
    }
  })

  test('权重照搬原版：动图组 10/28，各台词组都能被抽到', () => {
    let gif = 0
    const seen = new Set<string>()
    const total = 2800
    for (let i = 0; i < total; i++) {
      const bubble = pickWhaleBubble()
      if (bubble.kind === 'gif') {
        gif++
        continue
      }
      const line = bubble.rows.find(Boolean)
      if (line) seen.add(line.t)
    }
    // 10/28 ≈ 0.357，留足随机抖动
    expect(gif / total).toBeGreaterThan(0.3)
    expect(gif / total).toBeLessThan(0.42)
    // 五个组都要露面（含 1 权重的"哦鲸鲸..."与 3 权重的骚话组）
    expect(seen.has(WHALE_SNARK_LINES[0])).toBe(true)
    expect(
      [...WHALE_PRAISE_LINES, ...WHALE_WHINE_LINES].some((line) =>
        seen.has(line)
      )
    ).toBe(true)
  })

  test('rng 可注入：第一个组（好模型…）落在区间内即返回大字', () => {
    const bubble = pickWhaleBubble(() => 0)
    expect(bubble.kind).toBe('text')
    if (bubble.kind === 'text') {
      const line = bubble.rows.find(Boolean)
      expect(line?.s).toBe('B')
      expect(WHALE_PRAISE_LINES).toContain(line?.t)
    }
  })

  test('动图加载失败降级成一句台词（不会是空气泡）', () => {
    const bubble = pickWhaleGifFailBubble(() => 0)
    expect(bubble.kind).toBe('text')
    if (bubble.kind === 'text') {
      expect(bubble.rows.find(Boolean)?.t).toBe(WHALE_GIF_FAIL_LINES[0])
      expect(bubble.rows.find(Boolean)?.w).toBe(true)
    }
  })
})
