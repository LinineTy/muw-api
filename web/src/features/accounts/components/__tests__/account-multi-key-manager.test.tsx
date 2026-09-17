// @muw-owned
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MULTI_KEY_CONFIRM_MESSAGES } from '@/features/channels/constants'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  addAccountMultiKeys,
  deleteAccountMultiKey,
  disableAccountMultiKey,
  enableAccountMultiKey,
  getAccountMultiKeyStatus,
} from '../../api'
import { AccountMultiKeyManager } from '../account-multi-key-manager'

vi.mock('../../api', () => ({
  addAccountMultiKeys: vi.fn(),
  deleteAccountMultiKey: vi.fn(),
  disableAccountMultiKey: vi.fn(),
  enableAccountMultiKey: vi.fn(),
  getAccountMultiKeyStatus: vi.fn(),
}))

const ACCOUNT_ID = 37

const originalAuth = useAuthStore.getState().auth

function statusPayload() {
  return {
    success: true,
    data: {
      keys: [
        { index: 0, status: 1, key_preview: 'sk-firstcnu...' },
        {
          index: 1,
          status: 2,
          key_preview: 'sk-secondskx...',
          reason: 'manual',
        },
      ],
      total: 2,
      page: 1,
      page_size: 10,
      total_pages: 1,
      enabled_count: 1,
      manual_disabled_count: 1,
      auto_disabled_count: 0,
    },
  }
}

function renderManager(onKeysChanged = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountMultiKeyManager
        accountId={ACCOUNT_ID}
        onKeysChanged={onKeysChanged}
      />
    </QueryClientProvider>
  )
  return { ...view, onKeysChanged }
}

/** 只在给定角色的权限矩阵下跑：超级管理员默认全通过，其余角色看 permissions */
function grantSuperAdmin() {
  useAuthStore.setState({
    auth: {
      ...originalAuth,
      user: { id: 1, username: 'root', role: ROLE.SUPER_ADMIN },
    },
  })
}

function grantNonSensitiveAdmin() {
  useAuthStore.setState({
    auth: {
      ...originalAuth,
      user: { id: 2, username: 'operator', role: ROLE.ADMIN },
    },
  })
}

beforeEach(() => {
  vi.mocked(getAccountMultiKeyStatus).mockResolvedValue(
    statusPayload() as never
  )
  vi.mocked(addAccountMultiKeys).mockResolvedValue({
    success: true,
    message: 'appended',
    data: { total: 3 },
  })
  vi.mocked(enableAccountMultiKey).mockResolvedValue({
    success: true,
    message: 'enabled',
  })
  vi.mocked(disableAccountMultiKey).mockResolvedValue({
    success: true,
    message: 'disabled',
  })
  vi.mocked(deleteAccountMultiKey).mockResolvedValue({
    success: true,
    message: 'deleted',
  })
  grantSuperAdmin()
})

afterEach(() => {
  useAuthStore.setState({ auth: originalAuth })
  vi.clearAllMocks()
})

describe('账户抽屉 · 多密钥管理区块', () => {
  it('逐把列出服务端给的脱敏预览与状态（不展示明文）', async () => {
    renderManager()

    expect(await screen.findByText('sk-firstcnu...')).toBeInTheDocument()
    expect(screen.getByText('sk-secondskx...')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Manual Disabled')).toBeInTheDocument()
    // 每把都有独立的启停/删除入口
    expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Enable' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
  })

  it('追加：把粘贴的内容交给接口，并把追加后的总把数回调给抽屉', async () => {
    const user = userEvent.setup()
    const { onKeysChanged } = renderManager()
    await screen.findByText('sk-firstcnu...')

    await user.type(
      screen.getByPlaceholderText('Paste one key per line to append'),
      'sk-new-a\nsk-new-b'
    )
    await user.click(screen.getByRole('button', { name: 'Append keys' }))

    await waitFor(() => {
      expect(addAccountMultiKeys).toHaveBeenCalledWith(ACCOUNT_ID, [
        'sk-new-a\nsk-new-b',
      ])
    })
    // 抽屉据此把「多密钥模式」开关同步成开启
    expect(onKeysChanged).toHaveBeenCalledWith(3)
  })

  it('追加输入为空时按钮不可点（避免提交空列表）', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('sk-firstcnu...')

    const appendButton = screen.getByRole('button', { name: 'Append keys' })
    expect(appendButton).toBeDisabled()

    await user.type(
      screen.getByPlaceholderText('Paste one key per line to append'),
      '   '
    )
    expect(appendButton).toBeDisabled()
    expect(addAccountMultiKeys).not.toHaveBeenCalled()
  })

  it('单把停用不弹确认弹窗，直接提交（可一键回滚的轻量操作）', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('sk-firstcnu...')

    await user.click(screen.getByRole('button', { name: 'Disable' }))

    await waitFor(() => {
      expect(disableAccountMultiKey).toHaveBeenCalledWith(ACCOUNT_ID, 0)
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('删除单把必须先确认，确认后才提交（破坏性操作）', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('sk-firstcnu...')

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(MULTI_KEY_CONFIRM_MESSAGES.DELETE)
    ).toBeInTheDocument()
    expect(deleteAccountMultiKey).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(deleteAccountMultiKey).toHaveBeenCalledWith(ACCOUNT_ID, 1)
    })
  })

  it('无敏感写权限时：追加与删除入口禁用，启停仍可用（后端只对写入密钥要敏感权限）', async () => {
    grantNonSensitiveAdmin()
    renderManager()
    await screen.findByText('sk-firstcnu...')

    expect(
      screen.getByPlaceholderText('Paste one key per line to append')
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Append keys' })).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: 'Delete' })) {
      expect(button).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: 'Disable' })).toBeEnabled()
  })
})
