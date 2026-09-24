// @muw-owned
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActivationVerifyWindow } from '../components/activation-verify-window'

const renderWindow = (overrides: Partial<React.ComponentProps<typeof ActivationVerifyWindow>> = {}) => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    status: 'solving' as const,
    hashes: 0,
    bits: 20,
    onRetry: vi.fn(),
    ...overrides,
  }
  render(<ActivationVerifyWindow {...props} />)
  return props
}

describe('人机校验浮窗（右上角、可拖、不遮页面）', () => {
  it('挂在 document.body 上（否则会被卡片的 transform 层叠上下文困住）', () => {
    // 把组件放进一个带 transform 的容器里模拟登录卡
    render(
      <div style={{ transform: 'translateZ(0)' }}>
        <ActivationVerifyWindow
          open
          onOpenChange={vi.fn()}
          status='solving'
          hashes={0}
          bits={20}
          onRetry={vi.fn()}
        />
      </div>
    )
    const card = screen.getByTestId('activation-verify-window')
    expect(card.parentElement).toBe(document.body)
  })

  it('默认停在右上角，且不渲染任何遮罩（页面照旧可点）', () => {
    renderWindow()
    const card = screen.getByTestId('activation-verify-window')
    expect(card).toHaveStyle({ top: '72px', right: '24px' })
    expect(card.className).toContain('fixed')
    // 模态遮罩的标记一个都不该有
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
    expect(document.querySelector('[data-slot="overlay"]')).toBeNull()
  })

  it('拖标题栏能把窗口挪走（指针事件，鼠标与触摸同一套）', () => {
    renderWindow()
    const card = screen.getByTestId('activation-verify-window')
    const handle = screen.getByText('Security check').parentElement as HTMLElement
    fireEvent.pointerDown(handle, { clientX: 900, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 500, clientY: 300, pointerId: 1 })
    // jsdom 里元素尺寸为 0，位置按指针位移走；越界会被夹回视口内（不会被拖丢）
    expect(card.style.left).not.toBe('')
    expect(card.style.right).toBe('')
    expect(Number.parseInt(card.style.top, 10)).toBeGreaterThanOrEqual(8)
    fireEvent.pointerUp(handle, { pointerId: 1 })
  })

  it('求解中显示已算次数，通过后显示校验通过', () => {
    const { unmount } = render(
      <ActivationVerifyWindow
        open
        onOpenChange={vi.fn()}
        status='solving'
        hashes={12345}
        bits={20}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByText('Computing hashes: 12,345')).toBeInTheDocument()
    unmount()
    renderWindow({ status: 'done' })
    expect(screen.getByText('Security check passed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('失败时给「重试」与「关闭」，重试回调能触发', () => {
    const props = renderWindow({ status: 'failed' })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
    // 失败态里有两个「关闭」语义的按钮（角标 X 与底部按钮），角标走 testid
    fireEvent.click(screen.getByTestId('activation-verify-close'))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('右上角的关闭按钮随手可点（不经过后端）', () => {
    const props = renderWindow()
    fireEvent.click(screen.getByTestId('activation-verify-close'))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })
})
