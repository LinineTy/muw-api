// @muw-owned
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getPreAuthProof,
  onPreAuthProofConsumed,
  setPreAuthProof,
  takePreAuthProof,
} from '../pre-auth-proof'

describe('前置校验凭据暂存处', () => {
  beforeEach(() => {
    setPreAuthProof(null)
  })

  it('存取与读取', () => {
    setPreAuthProof({ challengeId: 'c1', nonce: '7' })
    expect(getPreAuthProof()).toEqual({ challengeId: 'c1', nonce: '7' })
  })

  it('取走即作废（服务端一次性，客户端同样只给一次）', () => {
    setPreAuthProof({ challengeId: 'c1', nonce: '7' })
    expect(takePreAuthProof()).toEqual({ challengeId: 'c1', nonce: '7' })
    expect(getPreAuthProof()).toBeNull()
    expect(takePreAuthProof()).toBeNull()
  })

  it('取走时通知订阅者（页面据此重新算一道）', () => {
    const listener = vi.fn()
    const unsubscribe = onPreAuthProofConsumed(listener)
    setPreAuthProof({ challengeId: 'c2', nonce: '8' })
    takePreAuthProof()
    expect(listener).toHaveBeenCalledTimes(1)
    // 解绑后不再通知
    unsubscribe()
    setPreAuthProof({ challengeId: 'c3', nonce: '9' })
    takePreAuthProof()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
