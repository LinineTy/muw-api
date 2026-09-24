// @muw-owned
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SecurityCheckWindow } from '../security-check-window'

const renderWindow = (
  overrides: Partial<React.ComponentProps<typeof SecurityCheckWindow>> = {}
) => {
  const props = {
    open: true,
    status: 'idle' as const,
    onStart: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }
  render(<SecurityCheckWindow {...props} />)
  return props
}

describe('校验浮窗', () => {
  it('挂在 document.body 上（否则会被卡片的 transform 层叠上下文困住）', () => {
    render(
      <div style={{ transform: 'translateZ(0)' }}>
        <SecurityCheckWindow
          open
          status='idle'
          onStart={vi.fn()}
          onRetry={vi.fn()}
        />
      </div>
    )
    expect(
      screen.getByTestId('security-check-window').parentElement
    ).toBe(document.body)
  })

  it('默认停在右上角，且不渲染遮罩', () => {
    renderWindow()
    const card = screen.getByTestId('security-check-window')
    expect(card).toHaveStyle({ top: '72px', right: '24px' })
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
  })

  it('勾选后开始校验，状态文字随状态变化', () => {
    const props = renderWindow()
    const checkbox = screen.getByTestId('security-check-start')
    expect(checkbox).toHaveAttribute('role', 'checkbox')
    expect(screen.getByText('Start the check')).toBeInTheDocument()
    fireEvent.click(checkbox)
    expect(props.onStart).toHaveBeenCalledTimes(1)
  })

  it('求解中显示正在校验，通过后显示已通过，失败时给重试', () => {
    const { unmount } = render(
      <SecurityCheckWindow
        open
        status='solving'
        onStart={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByText('Verifying...')).toBeInTheDocument()
    unmount()

    const passed = renderWindow({ status: 'done' })
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByTestId('security-check-start')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByTestId('security-check-start')).toBeDisabled()
    passed.onRetry()

    const failed = renderWindow({ status: 'failed' })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(failed.onRetry).toHaveBeenCalledTimes(1)
  })

  it('整块可拖（不依赖拖动把手），勾选框不参与拖动', () => {
    renderWindow()
    const card = screen.getByTestId('security-check-window')
    fireEvent.pointerDown(card, { clientX: 300, clientY: 90, pointerId: 1 })
    fireEvent.pointerMove(card, { clientX: 200, clientY: 260, pointerId: 1 })
    expect(card.style.left).not.toBe('')
    expect(card.style.right).toBe('')
    fireEvent.pointerUp(card, { pointerId: 1 })

    // 勾选框上的按下不移动窗口
    const before = card.style.left
    const checkbox = screen.getByTestId('security-check-start')
    fireEvent.pointerDown(checkbox, { clientX: 100, clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(checkbox, { clientX: 400, clientY: 400, pointerId: 2 })
    expect(card.style.left).toBe(before)
  })
})
