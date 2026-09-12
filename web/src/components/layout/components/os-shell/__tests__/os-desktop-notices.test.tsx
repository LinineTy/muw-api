// @muw-owned
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { OsDesktopNotices } from '../os-desktop-notices'

/**
 * 桌面公告卡 · 「新公告自动展开」回归网
 *
 * maintainer 2026-09-12 改竖条时问过"加个球不影响有新公告自动弹出吧？"——
 * 这条行为靠"未读数变大就 setCollapsed(false)"实现，浏览器里很难端到端造出
 * `/api/status` 的重新拉取（headless 下 focus/visibility 事件不触发 react-query refetch），
 * 所以用组件测试把它钉住：收起 → 未读数增加 → 卡片必须自己回来。
 */
type NotificationsState = {
  announcements: unknown[]
  loading: boolean
  unreadAnnouncementsCount: number
}

let state: NotificationsState = {
  announcements: [],
  loading: false,
  unreadAnnouncementsCount: 0,
}

vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({
    ...state,
    notice: '',
    unreadCount: state.unreadAnnouncementsCount,
    unreadNoticeCount: 0,
  }),
}))

// 富文本渲染与本用例无关，换成纯文本，避免拖进 markdown 依赖
vi.mock('@/components/rich-content', () => ({
  RichContent: ({ content }: { content: string }) => <span>{content}</span>,
}))

function announcement(id: number, content: string) {
  return { id, type: 'ongoing', content, extra: '' }
}

/** 卡本体是 <section>；收起态只有 aria-hidden，用元素查询最稳 */
function card(container: HTMLElement) {
  return container.querySelector('section')
}

afterEach(() => {
  state = { announcements: [], loading: false, unreadAnnouncementsCount: 0 }
})

describe('OsDesktopNotices', () => {
  test('未读数增加（新公告到来）时，已收起的卡片自动展开', async () => {
    state = {
      announcements: [announcement(1, '第一条')],
      loading: false,
      unreadAnnouncementsCount: 1,
    }
    const { container, rerender } = render(<OsDesktopNotices />)
    // 首帧是淡入前的透明态（entered=false），等 rAF 跑完
    await waitFor(() =>
      expect(card(container)).not.toHaveAttribute('aria-hidden', 'true')
    )

    // 点 × 收起
    screen.getByLabelText('Close').click()
    rerender(<OsDesktopNotices />)
    await waitFor(() =>
      expect(card(container)).toHaveAttribute('aria-hidden', 'true')
    )

    // 新公告到来：未读数 1 → 2
    state = {
      announcements: [announcement(2, '新公告'), announcement(1, '第一条')],
      loading: false,
      unreadAnnouncementsCount: 2,
    }
    rerender(<OsDesktopNotices />)
    await waitFor(() =>
      expect(card(container)).not.toHaveAttribute('aria-hidden', 'true')
    )
  })

  test('未读数不变时，收起状态保持（不反复弹开）', async () => {
    state = {
      announcements: [announcement(1, '第一条')],
      loading: false,
      unreadAnnouncementsCount: 1,
    }
    const { container, rerender } = render(<OsDesktopNotices />)
    screen.getByLabelText('Close').click()
    rerender(<OsDesktopNotices />)
    await waitFor(() =>
      expect(card(container)).toHaveAttribute('aria-hidden', 'true')
    )

    // 重渲染（数字没变）
    rerender(<OsDesktopNotices />)
    expect(card(container)).toHaveAttribute('aria-hidden', 'true')
  })

  test('没有公告时不渲染', () => {
    state = { announcements: [], loading: false, unreadAnnouncementsCount: 0 }
    const { container } = render(<OsDesktopNotices />)
    expect(card(container)).toBeNull()
  })
})
