// @muw-owned
import { renderHook, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLoginChallenge } from '../../api'
import { getPreAuthProof, takePreAuthProof } from '../pre-auth-proof'
import { usePreAuthCheck } from '../use-pre-auth-check'

vi.mock('../../api', () => ({
  getLoginChallenge: vi.fn(),
}))

const mockedChallenge = vi.mocked(getLoginChallenge)

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  takePreAuthProof()
})

describe('登录前置校验 hook', () => {
  it('本站未开启校验（enabled=false）⇒ 立刻 ready，不弹窗', async () => {
    mockedChallenge.mockResolvedValue({ enabled: false })
    const { result } = renderHook(() => usePreAuthCheck())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.windowProps.open).toBe(false)
    expect(getPreAuthProof()).toBeNull()
  })

  it('开启校验 ⇒ 进页面就算，算完 ready 并拿到凭据', async () => {
    const challenge = 'deadbeefdeadbeef'
    mockedChallenge.mockResolvedValue({
      enabled: true,
      challenge_id: 'cid-1',
      challenge,
      bits: 6,
    })
    const { result } = renderHook(() => usePreAuthCheck())
    expect(result.current.ready).toBe(false)
    await waitFor(() => expect(result.current.ready).toBe(true))
    const proof = getPreAuthProof()
    expect(proof?.challengeId).toBe('cid-1')
    expect(proof?.nonce).toMatch(/^[0-9]+$/)
  }, 20000)

  it('guard：没过就拒绝并提示，过了才放行', async () => {
    mockedChallenge.mockResolvedValue({ enabled: false })
    const { result } = renderHook(() => usePreAuthCheck(false))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.guard()).toBe(true)

    const failing = renderHook(() => usePreAuthCheck(true))
    // 首次渲染时挑战还没回来 ⇒ 未 ready
    expect(failing.result.current.guard()).toBe(false)
  }, 20000)

  it('凭据被消费后自动重新算一道（挑战一次性）', async () => {
    mockedChallenge.mockResolvedValue({
      enabled: true,
      challenge_id: 'cid-2',
      challenge: 'cafebabe',
      bits: 6,
    })
    const { result } = renderHook(() => usePreAuthCheck())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(mockedChallenge).toHaveBeenCalledTimes(1)

    // 模拟一次提交把凭据用掉
    result.current.consumeProof()
    await waitFor(() => expect(mockedChallenge).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.ready).toBe(true))
  }, 20000)

  it('enabled=false（页面关闭该流程）时不做任何请求', async () => {
    const { result } = renderHook(() => usePreAuthCheck(false))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(mockedChallenge).not.toHaveBeenCalled()
  })
})
