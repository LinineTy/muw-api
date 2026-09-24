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

// 布局层只负责外壳与系统配置，本用例只关心表单与请求体。
vi.mock('../../auth-layout', () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

// 页面按 /api/status 的开关决定要不要出示校验浮窗（默认按"要求校验"跑），
// 保持用例聚焦在表单与请求体上。
const statusMock = vi.hoisted(() => ({
  status: { activation_challenge_required: true } as
    | Record<string, unknown>
    | undefined,
}))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: statusMock.status }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

const mockedChallenge = vi.mocked(getActivationChallenge)
const mockedActivate = vi.mocked(activateAccount)
const mockedDeadline = vi.mocked(getActivationDeadline)

const CHALLENGE = 'cafebabecafebabe'
const BITS = 6

beforeEach(() => {
  vi.clearAllMocks()
  statusMock.status = { activation_challenge_required: true }
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

/** 勾选校验浮窗并等待通过（提交按钮在通过前不可按）。 */
async function passSecurityCheck(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: 'Start the check' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled()
  )
}

const submit = async (code = 'INVITE-1') => {
  const user = userEvent.setup()
  render(<Activate />)
  await passSecurityCheck(user)
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
    await passSecurityCheck(user)
    await user.type(screen.getByPlaceholderText('Invitation Code'), 'INVITE-2')
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(1))
    expect(mockedActivate.mock.calls[0][0].website).toBe(
      'http://spam.example.com'
    )
  })
})

describe('激活页的人机校验（PoW）', () => {
  it('服务端没要求校验时不出示浮窗，提交按钮直接可用（不必白点一下）', () => {
    statusMock.status = { activation_challenge_required: false }
    render(<Activate />)
    expect(
      screen.queryByRole('checkbox', { name: 'Start the check' })
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled()
    expect(mockedChallenge).not.toHaveBeenCalled()
  })

  it('勾选后才计算，提交时带上解出的 nonce', async () => {
    await submit('INVITE-3')
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(1))
    // 勾选时领一道；提交取走凭据后会自动再领一道，供下一次使用
    expect(mockedChallenge.mock.calls.length).toBeGreaterThanOrEqual(1)
    const payload = mockedActivate.mock.calls[0][0]
    expect(payload.inviteCode).toBe('INVITE-3')
    expect(payload.challengeId).toBe('challenge-id-1')
    expect(payload.nonce).toMatch(/^[0-9]+$/)
    expect(
      await verifyActivationPoW(CHALLENGE, payload.nonce ?? '', BITS)
    ).toBe(true)
  }, 20000)

  it('未勾选前不提交（按钮不可按）', async () => {
    const user = userEvent.setup()
    render(<Activate />)
    await user.type(screen.getByPlaceholderText('Invitation Code'), 'INVITE-4')
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    expect(mockedActivate).not.toHaveBeenCalled()
  })

  it('本站未开启校验时直接可用', async () => {
    mockedChallenge.mockResolvedValue({ enabled: false })
    const user = userEvent.setup()
    render(<Activate />)
    await passSecurityCheck(user)
    await user.type(screen.getByPlaceholderText('Invitation Code'), 'INVITE-5')
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(1))
    const payload = mockedActivate.mock.calls[0][0]
    expect(payload.challengeId).toBeUndefined()
    expect(payload.nonce).toBeUndefined()
  }, 20000)

  it('服务端回"需要重新校验"时自动再走一轮', async () => {
    mockedActivate
      .mockResolvedValueOnce({
        success: false,
        message: 'verification required',
        code: 'ACTIVATION_VERIFICATION_REQUIRED',
      })
      .mockResolvedValueOnce({
        success: false,
        message: 'Invalid invitation code',
      })
    await submit('INVITE-6')
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledTimes(2))
    for (const call of mockedActivate.mock.calls) {
      expect(call[0].challengeId).toBe('challenge-id-1')
      expect(call[0].nonce).toMatch(/^[0-9]+$/)
    }
  }, 20000)
})
