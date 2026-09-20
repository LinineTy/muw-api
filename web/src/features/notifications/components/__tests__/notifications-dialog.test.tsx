// @muw-owned
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getUserNotifications, markAllNotificationsRead } from '../../api'
import type { UserNotificationPage } from '../../types'
import { NotificationsDialog } from '../notifications-dialog'

vi.mock('../../api', () => ({
  getUserNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationsRead: vi.fn(),
}))

// 站内消息目前只发给管理员，入口对普通用户不渲染 —— 这里直接当作管理员
vi.mock('@/hooks/use-admin', () => ({ useIsAdmin: () => true }))

const page: UserNotificationPage = {
  items: [
    {
      id: 2,
      user_id: 1,
      type: 'channel_update',
      title: '上游模型巡检通知',
      content: '上游模型巡检摘要：检测渠道 34 个，发现变更 1 个。',
      created_at: 1789890000,
      read_at: 0,
    },
    {
      id: 1,
      user_id: 1,
      type: 'channel_update',
      title: '上游模型巡检通知',
      content: '旧的一条（已读）',
      created_at: 1789800000,
      read_at: 1789850000,
    },
  ],
  total: 2,
  unread: 1,
  page: 1,
  page_size: 20,
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationsDialog open onOpenChange={() => {}} />
    </QueryClientProvider>
  )
}

describe('NotificationsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(markAllNotificationsRead).mockResolvedValue(1)
  })

  it('逐条渲染标题与正文', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    renderDialog()

    expect(await screen.findAllByText('上游模型巡检通知')).toHaveLength(2)
    expect(
      screen.getByText(/检测渠道 34 个，发现变更 1 个/)
    ).toBeInTheDocument()
    expect(screen.getByText('旧的一条（已读）')).toBeInTheDocument()
  })

  it('打开时把未读标为已读，且未读条目仍高亮', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    renderDialog()

    // 打开即标记已读（角标清零）
    await waitFor(() =>
      expect(markAllNotificationsRead).toHaveBeenCalledTimes(1)
    )
    // 高亮按打开那一刻的快照：第 2 条标了 data-unread，已读的第 1 条没有
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-unread="true"]')
      ).toHaveLength(1)
    )
  })

  it('没有消息时给空态，不调标记已读', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue({
      items: [],
      total: 0,
      unread: 0,
      page: 1,
      page_size: 20,
    })

    renderDialog()

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()
    expect(markAllNotificationsRead).not.toHaveBeenCalled()
  })
})
