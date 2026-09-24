// @muw-owned
import { describe, expect, it } from 'vitest'

import {
  countLeadingZeroBits,
  estimatePowProgress,
  isDecimalNonce,
  POW_BATCH_SIZE,
  solveActivationPoWInline,
  solveWithSha256,
  verifyActivationPoW,
} from '../lib/activation-pow'

const ALL_ONES = 'ff'.repeat(32)

describe('countLeadingZeroBits', () => {
  it('按位统计，与后端 CountLeadingZeroBits 等价', () => {
    expect(countLeadingZeroBits('00')).toBe(8)
    expect(countLeadingZeroBits('0000')).toBe(16)
    expect(countLeadingZeroBits('ff')).toBe(0)
    expect(countLeadingZeroBits('0f')).toBe(4)
    expect(countLeadingZeroBits('01')).toBe(7)
    expect(countLeadingZeroBits('0010')).toBe(11)
  })

  it('非法摘要按 0 处理（不抛错）', () => {
    expect(countLeadingZeroBits('zz')).toBe(0)
  })
})

describe('isDecimalNonce', () => {
  it('只接受不超过 20 位的十进制串', () => {
    expect(isDecimalNonce('0')).toBe(true)
    expect(isDecimalNonce('1234567890')).toBe(true)
    expect(isDecimalNonce('')).toBe(false)
    expect(isDecimalNonce('1a')).toBe(false)
    expect(isDecimalNonce('-1')).toBe(false)
    expect(isDecimalNonce('1'.repeat(21))).toBe(false)
  })
})

describe('solveWithSha256', () => {
  it('找到满足难度的 nonce，并如实报告尝试次数', () => {
    // 假摘要：只有 nonce=7 时给足前导零位
    const sha256 = (input: string) =>
      input.endsWith(':7') ? `00ff${'0'.repeat(60)}` : ALL_ONES
    const result = solveWithSha256(sha256, 'challenge', 8)
    expect(result?.nonce).toBe('7')
    expect(result?.hashes).toBe(8)
  })

  it('被要求停止时返回 null（不把"取消"当失败）', () => {
    const sha256 = () => ALL_ONES
    const result = solveWithSha256(sha256, 'challenge', 8, {
      shouldStop: () => true,
    })
    expect(result).toBeNull()
  })

  it('每批检查一次停止/进度：进度回调在达到批次后触发', () => {
    const seen: number[] = []
    const sha256 = () => ALL_ONES
    solveWithSha256(sha256, 'challenge', 8, {
      reportIntervalMs: 0,
      onProgress: ({ hashes }) => {
        seen.push(hashes)
        if (seen.length >= 2) {
          return
        }
      },
      shouldStop: () => seen.length >= 2,
    })
    expect(seen[0]).toBe(POW_BATCH_SIZE)
    expect(seen[1]).toBe(2 * POW_BATCH_SIZE)
  })

  it('空挑战或难度 ≤ 0 直接返回 null', () => {
    const sha256 = () => ALL_ONES
    expect(solveWithSha256(sha256, '', 8)).toBeNull()
    expect(solveWithSha256(sha256, 'challenge', 0)).toBeNull()
  })
})

describe('estimatePowProgress', () => {
  it('未开始为 0，期望工作量处约 63%，且封顶 0.98', () => {
    expect(estimatePowProgress(0, 18)).toBe(0)
    expect(estimatePowProgress(2 ** 18, 18)).toBeGreaterThan(0.6)
    expect(estimatePowProgress(2 ** 18, 18)).toBeLessThan(0.65)
    expect(estimatePowProgress(2 ** 30, 18)).toBeLessThanOrEqual(0.98)
    expect(estimatePowProgress(100, 0)).toBe(0)
  })
})

describe('真 forge 求解（与后端同款判别）', () => {
  it('解出的 nonce 能通过校验，且是十进制串', async () => {
    const challenge = 'deadbeefdeadbeef'
    const nonce = await solveActivationPoWInline(challenge, 8)
    expect(isDecimalNonce(nonce)).toBe(true)
    expect(await verifyActivationPoW(challenge, nonce, 8)).toBe(true)
  }, 20000)

  it('非法 nonce 一律不通过（含超过难度的正确解换挑战）', async () => {
    const challenge = 'cafebabe'
    const nonce = await solveActivationPoWInline(challenge, 8)
    expect(await verifyActivationPoW(challenge, `${nonce} `, 8)).toBe(false)
    expect(await verifyActivationPoW('', nonce, 8)).toBe(false)
    expect(await verifyActivationPoW(challenge, nonce, 0)).toBe(false)
  }, 20000)
})
