// @muw-owned
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteNotifications,
  deleteNotificationsByScope,
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from '../../api'
import type { UserNotificationPage } from '../../types'
import {
  NotificationsDialog,
  USER_NOTIFICATIONS_QUERY_KEY,
} from '../notifications-dialog'

vi.mock('../../api', () => ({
  deleteNotifications: vi.fn(),
  deleteNotificationsByScope: vi.fn(),
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
  const view = render(
    <QueryClientProvider client={queryClient}>
      <NotificationsDialog open onOpenChange={() => {}} />
    </QueryClientProvider>
  )
  return { queryClient, ...view }
}

const unreadRows = () => document.querySelectorAll('[data-unread="true"]')
const cachedPage = (queryClient: QueryClient) =>
  queryClient.getQueryData<UserNotificationPage>(USER_NOTIFICATIONS_QUERY_KEY)

describe('NotificationsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(markAllNotificationsRead).mockResolvedValue(1)
    vi.mocked(markNotificationsRead).mockResolvedValue(1)
    vi.mocked(deleteNotifications).mockResolvedValue(1)
    vi.mocked(deleteNotificationsByScope).mockResolvedValue(1)
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

  it('打开时不清空未读：不调全部已读，未读行仍高亮', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    const { queryClient } = renderDialog()

    // 列表渲染出来就说明数据到位了
    await screen.findByText('旧的一条（已读）')
    expect(markAllNotificationsRead).not.toHaveBeenCalled()
    expect(unreadRows()).toHaveLength(1)
    expect(cachedPage(queryClient)?.unread).toBe(1)
  })

  it('点单条「标为已读」：只标这一条，未读数 -1', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    const { queryClient } = renderDialog()

    fireEvent.click(await screen.findByTestId('notification-mark-read-2'))

    await waitFor(() =>
      expect(markNotificationsRead).toHaveBeenCalledWith([2])
    )
    expect(markAllNotificationsRead).not.toHaveBeenCalled()
    // 该条不再是未读、高亮消失，角标跟着 -1
    await waitFor(() => expect(unreadRows()).toHaveLength(0))
    expect(cachedPage(queryClient)?.unread).toBe(0)
  })

  it('点「全部已读」：调全部已读接口，所有行取消高亮、未读归零', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    const { queryClient } = renderDialog()

    fireEvent.click(await screen.findByTestId('notifications-mark-all'))

    await waitFor(() =>
      expect(markAllNotificationsRead).toHaveBeenCalledTimes(1)
    )
    expect(markNotificationsRead).not.toHaveBeenCalled()
    await waitFor(() => expect(unreadRows()).toHaveLength(0))
    expect(cachedPage(queryClient)?.unread).toBe(0)
  })

  it('标记失败：把缓存拉回服务端真实状态（重拉列表）', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)
    vi.mocked(markNotificationsRead).mockRejectedValue(new Error('boom'))

    renderDialog()

    fireEvent.click(await screen.findByTestId('notification-mark-read-2'))

    await waitFor(() =>
      expect(getUserNotifications).toHaveBeenCalledTimes(2)
    )
  })

  it('没有消息时给空态，不调任何已读接口', async () => {
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
    expect(markNotificationsRead).not.toHaveBeenCalled()
    // 空态没有可删的东西：单条删除与两个清空动作都不渲染
    expect(screen.queryByTestId('notifications-clear-all')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notifications-clear-read')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notification-delete-1')).not.toBeInTheDocument()
  })

  it('删除按钮常驻（不靠 hover 才出现）：已读行也有', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    renderDialog()

    // id=2 是未读行、id=1 是已读行 —— 两行都能直接点到删除
    expect(await screen.findByTestId('notification-delete-2')).toBeEnabled()
    expect(screen.getByTestId('notification-delete-1')).toBeEnabled()
  })

  it('点单条删除：直接删（不弹确认），删完重拉列表', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    renderDialog()

    fireEvent.click(await screen.findByTestId('notification-delete-2'))

    await waitFor(() => expect(deleteNotifications).toHaveBeenCalledWith([2]))
    // 不弹确认弹窗；删完 invalidate 列表，列表与角标一起刷新
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(getUserNotifications).toHaveBeenCalledTimes(2))
  })

  it('点「清空已读」：调 only_read=true，不弹确认', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    renderDialog()

    fireEvent.click(await screen.findByTestId('notifications-clear-read'))

    await waitFor(() =>
      expect(deleteNotificationsByScope).toHaveBeenCalledWith(true)
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(getUserNotifications).toHaveBeenCalledTimes(2))
  })

  it('点「清空全部」：先弹确认，确认后调 only_read=false 并重拉列表', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    renderDialog()

    fireEvent.click(await screen.findByTestId('notifications-clear-all'))

    const confirm = await screen.findByRole('alertdialog', {
      name: 'Clear all notifications?',
    })
    expect(deleteNotificationsByScope).not.toHaveBeenCalled()

    fireEvent.click(within(confirm).getByRole('button', { name: 'Clear all' }))

    await waitFor(() =>
      expect(deleteNotificationsByScope).toHaveBeenCalledWith(false)
    )
    await waitFor(() => expect(getUserNotifications).toHaveBeenCalledTimes(2))
  })

  it('「清空全部」在确认弹窗里取消：不删任何东西', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)

    renderDialog()

    fireEvent.click(await screen.findByTestId('notifications-clear-all'))
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Clear all notifications?',
    })

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))

    expect(deleteNotificationsByScope).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })

  it('删除失败：把缓存拉回服务端真实状态（重拉列表）', async () => {
    vi.mocked(getUserNotifications).mockResolvedValue(page)
    vi.mocked(deleteNotifications).mockRejectedValue(new Error('boom'))

    renderDialog()

    fireEvent.click(await screen.findByTestId('notification-delete-2'))

    await waitFor(() => expect(getUserNotifications).toHaveBeenCalledTimes(2))
  })
})
