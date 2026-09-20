// @muw-owned
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OsThirdPartyDialog } from '../os-third-party-dialog'

// http 客户端走 <Link> 进站内 /chat/<id>：测试里换成普通 a（把 $chatId 填上）
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    params,
  }: {
    children?: React.ReactNode
    to?: string
    params?: Record<string, string>
  }) => (
    <a
      href={
        typeof to === 'string'
          ? to.replace('$chatId', String(params?.chatId ?? ''))
          : '#'
      }
    >
      {children}
    </a>
  ),
}))

vi.mock('@/features/chat/hooks/use-chat-presets', () => ({
  useChatPresets: () => ({
    serverAddress: 'https://api.example.com',
    chatPresets: [
      {
        id: '0',
        name: 'WindowChat',
        url: 'https://chat.example.com/#/?settings={key}',
        type: 'web',
      },
      {
        id: '1',
        name: 'Cherry Studio',
        url: 'cherrystudio://providers/api-keys?v=1&data={cherryConfig}',
        type: 'custom-protocol',
      },
      {
        id: '2',
        name: 'Plain Client',
        url: 'obsidian://open?vault=newapi',
        type: 'custom-protocol',
      },
      { id: '3', name: 'Fluent', url: 'fluent://x', type: 'fluent' },
    ],
  }),
}))

const fetchActiveChatKey = vi.fn(async () => 'sk-test')
vi.mock('@/features/chat/hooks/use-active-chat-key', () => ({
  fetchActiveChatKey: () => fetchActiveChatKey(),
}))

describe('OsThirdPartyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('列出客户端：http 的进站内窗口、本地客户端带密钥拉起、fluent 过滤掉', () => {
    render(<OsThirdPartyDialog open onOpenChange={() => {}} />)

    // fluent 不渲染
    expect(screen.queryByText('Fluent')).toBeNull()

    // http 客户端 → 站内 /chat/<id>
    expect(screen.getByText('WindowChat').closest('a')).toHaveAttribute(
      'href',
      '/chat/0'
    )
    // 本地客户端 → 按钮（没有 href）
    expect(screen.getByText('Cherry Studio').closest('a')).toBeNull()
    expect(screen.getByText('Cherry Studio').closest('button')).not.toBeNull()
  })

  it('无需密钥的本地客户端：直接拉起并关弹窗', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onOpenChange = vi.fn()
    render(<OsThirdPartyDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByText('Plain Client'))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(open.mock.calls[0][0]).toBe('obsidian://open?vault=newapi')
    expect(fetchActiveChatKey).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('需要密钥的本地客户端：先取密钥再拼链接拉起', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<OsThirdPartyDialog open onOpenChange={() => {}} />)

    await user.click(screen.getByText('Cherry Studio'))

    await waitFor(() => expect(fetchActiveChatKey).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(String(open.mock.calls[0][0])).toContain(
      'cherrystudio://providers/api-keys?v=1&data='
    )
    // 占位符必须被替换掉，不能把 {cherryConfig} 原样吐出去
    expect(String(open.mock.calls[0][0])).not.toContain('{cherryConfig}')
  })
})
