// @muw-owned
import { act, renderHook, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActivationChallenge } from '../../api'
import { getPreAuthProof, takePreAuthProof } from '../pre-auth-proof'
import { useSecurityCheck } from '../use-security-check'

const challenge = 'deadbeefdeadbeef'
const enabled = (overrides: Partial<ActivationChallenge> = {}) => ({
  enabled: true,
  challenge_id: 'cid-1',
  challenge,
  bits: 6,
  ...overrides,
})

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
  })
})

beforeEach(() => {
  takePreAuthProof()
})

describe('校验流程 hook', () => {
  it('未勾选前不请求、不通过', async () => {
    const fetcher = vi.fn().mockResolvedValue(enabled())
    const { result } = renderHook(() => useSecurityCheck(fetcher))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
    expect(result.current.guard()).toBe(false)
  })

  it('勾选后开始计算，算完 ready 并给出凭据', async () => {
    const fetcher = vi.fn().mockResolvedValue(enabled())
    const { result } = renderHook(() => useSecurityCheck(fetcher))
    act(() => result.current.windowProps.onStart())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('done')
    expect(result.current.guard()).toBe(true)
  }, 20000)

  it('ensureProof 交出凭据后自动重算下一份', async () => {
    const fetcher = vi.fn().mockResolvedValue(enabled())
    const { result } = renderHook(() =>
      useSecurityCheck(fetcher, {
        onProof: () => undefined,
      })
    )
    act(() => result.current.windowProps.onStart())
    await waitFor(() => expect(result.current.ready).toBe(true))

    const holder: { proof: { challengeId: string; nonce: string } | null } = {
      proof: null,
    }
    await act(async () => {
      holder.proof = await result.current.ensureProof()
    })
    expect(holder.proof?.challengeId).toBe('cid-1')
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  }, 20000)

  it('未开启校验时直接放行，不显示浮窗', async () => {
    const fetcher = vi.fn().mockResolvedValue({ enabled: false })
    const { result } = renderHook(() => useSecurityCheck(fetcher))
    act(() => result.current.windowProps.onStart())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.windowProps.open).toBe(false)
  })

  it('服务端没要求校验（enabled=false）时连挑战都不领，浮窗不出现、直接放行', async () => {
    const fetcher = vi.fn().mockResolvedValue(enabled())
    const { result } = renderHook(() =>
      useSecurityCheck(fetcher, { enabled: false })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.ready).toBe(true)
    expect(result.current.windowProps.open).toBe(false)
    expect(result.current.guard()).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('取挑战失败时不放行（不把"取不到"当成"没开校验"）', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('unavailable'))
    const { result } = renderHook(() => useSecurityCheck(fetcher))
    act(() => result.current.windowProps.onStart())
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(result.current.ready).toBe(false)
    expect(result.current.guard()).toBe(false)
  })

  it('凭据被 api 层取走时（订阅通知）自动重算', async () => {
    const fetcher = vi.fn().mockResolvedValue(enabled())
    let notify: (() => void) | null = null
    const { result } = renderHook(() =>
      useSecurityCheck(fetcher, {
        onProof: (proof) => {
          if (proof) {
            // 模拟 api 层读取凭据的路径
            expect(getPreAuthProof()).toBeNull()
          }
        },
        subscribeConsumed: (listener) => {
          notify = listener
          return () => undefined
        },
      })
    )
    act(() => result.current.windowProps.onStart())
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => notify?.())
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  }, 20000)
})
