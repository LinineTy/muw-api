// @muw-owned
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OsQuickLinksDialog } from '../os-quick-links-dialog'

// 站内链接走 <Link>：测试里换成普通 a（href 与 onClick 都要透传）
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    onClick,
    className,
  }: {
    children?: React.ReactNode
    to?: string
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
    className?: string
  }) => (
    <a
      href={typeof to === 'string' ? to : '#'}
      className={className}
      onClick={onClick}
    >
      {children}
    </a>
  ),
}))

vi.mock('@/hooks/use-top-nav-links', () => ({
  useTopNavLinks: () => [
    { title: 'Console', href: '/console' },
    { title: 'Docs', href: 'https://docs.example.com', external: true },
  ],
}))

describe('OsQuickLinksDialog', () => {
  it('列出全部链接：站内当路由、外链新标签打开', () => {
    render(<OsQuickLinksDialog open onOpenChange={() => {}} />)

    expect(document.querySelectorAll('[data-testid=quick-links-list] a')).toHaveLength(2)

    const internal = screen.getByText('Console').closest('a')
    expect(internal).toHaveAttribute('href', '/console')
    expect(internal).not.toHaveAttribute('target')

    const external = screen.getByText('Docs').closest('a')
    expect(external).toHaveAttribute('href', 'https://docs.example.com')
    expect(external).toHaveAttribute('target', '_blank')
  })

  it('点链接后关掉弹窗', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<OsQuickLinksDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByText('Console'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
