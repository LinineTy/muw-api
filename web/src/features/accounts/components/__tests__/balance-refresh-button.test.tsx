// @muw-owned
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleServerError } from '@/lib/handle-server-error'

import { updateAccountBalance } from '../../api'
import type { Account } from '../../types'
import { BalanceRefreshButton } from '../balance-refresh-button'

vi.mock('../../api', () => ({
  updateAccountBalance: vi.fn(),
}))

// 注意（2026-09-20）：`sonner` 在 test-setup.ts 里经 `@/lib/api` → http-client →
// handle-server-error 被**提前真实加载**，所以 handle-server-error 内部那份 toast 不是
// 这里的 mock（mock 只覆盖测试文件之后才加载的模块）。因此失败路径断言 mock 掉的
// handleServerError，而不是它内部弹出的 toast。
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/handle-server-error', () => ({
  handleServerError: vi.fn(),
  markServerErrorHandled: vi.fn(),
}))

const account = { id: 42, name: 'Zhipu (Proxy)' } as unknown as Account

function renderButton() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BalanceRefreshButton account={account} />
    </QueryClientProvider>
  )
}

async function clickUpdate() {
  const user = userEvent.setup()
  renderButton()
  await user.click(screen.getByRole('button', { name: 'Update Balance' }))
}

describe('BalanceRefreshButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('成功时提示新余额', async () => {
    vi.mocked(updateAccountBalance).mockResolvedValue({
      success: true,
      data: { balance: 12.34 },
    })

    await clickUpdate()

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('12.34')
    expect(handleServerError).not.toHaveBeenCalled()
  })

  // 2026-09-20 生产反馈：Zhipu GLM 这类上游不支持余额查询的账户类型，后端回
  // HTTP 200 + success:false（**没有 data**）。旧代码直接取 `data.balance`，用户看到的是
  // 「can't access property "balance", e is undefined」而不是真实原因。
  it('业务失败时把完整响应交给错误处理，不抛 JS 错误', async () => {
    vi.mocked(updateAccountBalance).mockResolvedValue({
      success: false,
      message: '尚未实现',
    })

    await clickUpdate()

    expect(handleServerError).toHaveBeenCalledTimes(1)
    const [passed] = vi.mocked(handleServerError).mock.calls[0]
    // 关键：交给错误处理器的是后端响应本身（带 message），不是 TypeError
    expect(passed).toEqual({ success: false, message: '尚未实现' })
    expect(passed).not.toBeInstanceOf(Error)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('请求抛错时走兜底提示', async () => {
    vi.mocked(updateAccountBalance).mockRejectedValue(new Error('network down'))

    await clickUpdate()

    expect(handleServerError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(handleServerError).mock.calls[0][0]).toBeInstanceOf(Error)
  })
})
