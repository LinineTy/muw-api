// @muw-owned
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activateAccount,
  getActivationChallenge,
  getActivationDeadline,
} from '@/features/auth/api'

import { Activate } from '../index'
import { verifyActivationPoW } from '../lib/activation-pow'

vi.mock('@/features/auth/api', () => ({
  activateAccount: vi.fn(),
  getActivationChallenge: vi.fn(),
  getActivationDeadline: vi.fn(),
}))

// 布局层只负责外壳与系统配置，本用例只关心表单与请求体，直接换成透明容器。
vi.mock('../../auth-layout', () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

// 页面只用 useNavigate，不需要真实路由。
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

const mockedChallenge = vi.mocked(getActivationChallenge)
const mockedActivate = vi.mocked(activateAccount)
const mockedDeadline = vi.mocked(getActivationDeadline)

const CHALLENGE = 'cafebabecafebabe'
const BITS = 8

beforeEach(() => {
  vi.clearAllMocks()
  mockedDeadline.mockResolvedValue({ pending: false })
  mockedChallenge.mockResolvedValue({
    enabled: true,
    challenge_id: 'challenge-id-1',
    challenge: CHALLENGE,
    bits: BITS,
    expires_in: 300,
  })
  mockedActivate.mockResolvedValue({
    success: false,
    message: 'Invalid invitation code',
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const submit = async (code = 'INVITE-1') => {
  const user = userEvent.setup()
  render(<Activate />)
  await user.type(screen.getByPlaceholderText('Invitation Code'), code)
  await user.click(screen.getByRole('button', { name: 'Activate' }))
}

describe('激活页的隐形蜜罐字段', () => {
  it('对真人不可见、不可聚焦、读屏忽略（自动化脚本才会填）', () => {
    render(<Activate />)
    const honeypot = screen.getByTestId('activation-honeypot')
    expect(honeypot).toHaveAttribute('name', 'website_url')
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    expect(honeypot).toHaveAttribute('aria-hidden', 'true')
    expect(honeypot).toHaveAttribute('autocomplete', 'off')
    expect(honeypot.className).toContain('pointer-events-none')
  })

  it('真人提交时字段为空，原样带上去（服务端据此判定）', async () => {
    await submit()
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(1))
    expect(mockedActivate.mock.calls[0][0].website).toBe('')
  })

  it('被脚本填了值时会原样提交（服务端立即处置的那条路径）', async () => {
    render(<Activate />)
    const user = userEvent.setup()
    // 脚本不会真的"点"输入框，直接改值 —— fireEvent.change 正是这个形状
    fireEvent.change(screen.getByTestId('activation-honeypot'), {
      target: { value: 'http://spam.example.com' },
    })
    await user.type(screen.getByPlaceholderText('Invitation Code'), 'INVITE-2')
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(1))
    expect(mockedActivate.mock.calls[0][0].website).toBe(
      'http://spam.example.com'
    )
  })
})

describe('激活页的人机校验（PoW）', () => {
  it('提交前先领挑战，并把解出的 nonce 一起提交', async () => {
    await submit('INVITE-3')
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(1))
    expect(mockedChallenge).toHaveBeenCalledTimes(1)
    const payload = mockedActivate.mock.calls[0][0]
    expect(payload.inviteCode).toBe('INVITE-3')
    expect(payload.challengeId).toBe('challenge-id-1')
    expect(payload.nonce).toMatch(/^[0-9]+$/)
    expect(await verifyActivationPoW(CHALLENGE, payload.nonce ?? '', BITS)).toBe(
      true
    )
  }, 20000)

  it('站点未开启校验（enabled=false）时不求解，直接提交', async () => {
    mockedChallenge.mockResolvedValue({ enabled: false })
    await submit('INVITE-4')
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(1))
    const payload = mockedActivate.mock.calls[0][0]
    expect(payload.challengeId).toBeUndefined()
    expect(payload.nonce).toBeUndefined()
  }, 20000)

  it('挑战领不到时不提交（提示稍后重试，而不是拿没校验的请求去撞）', async () => {
    mockedChallenge.mockRejectedValue(new Error('network down'))
    await submit('INVITE-5')
    await waitFor(() => expect(mockedChallenge).toHaveBeenCalledTimes(1))
    expect(mockedActivate).not.toHaveBeenCalled()
  }, 20000)

  it('服务端回"需要重新校验"时自动再走一轮（挑战是一次性的）', async () => {
    mockedActivate
      .mockResolvedValueOnce({
        success: false,
        message: 'verification required',
        code: 'ACTIVATION_VERIFICATION_REQUIRED',
      })
      .mockResolvedValueOnce({ success: false, message: 'Invalid invitation code' })
    await submit('INVITE-6')
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(2))
    // 两轮都要重新领挑战（旧挑战已被消费），且都带上了新的 nonce
    expect(mockedChallenge).toHaveBeenCalledTimes(2)
    for (const call of mockedActivate.mock.calls) {
      expect(call[0].challengeId).toBe('challenge-id-1')
      expect(call[0].nonce).toMatch(/^[0-9]+$/)
    }
  }, 20000)
})
