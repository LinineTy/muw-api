// @muw-owned
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MobileNavFab } from '../mobile-nav-fab'

const setOpenMobile = vi.fn()

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}))

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => ({ openMobile: false, setOpenMobile }),
}))

const STORAGE_KEY = 'muw:mobile-nav-fab-offset'

function drag(
  element: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    clientX: from.x,
    clientY: from.y,
  })
  fireEvent.pointerMove(element, {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
  })
  fireEvent.pointerUp(element, { pointerId: 1, clientX: to.x, clientY: to.y })
}

describe('MobileNavFab', () => {
  beforeEach(() => {
    setOpenMobile.mockClear()
    window.localStorage.clear()
    // jsdom 里元素 rect 全是 0，会让「默认位置」算成屏幕右下角；打桩成真实的右下角 24px
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 1024 - 24 - 48,
      y: 768 - 24 - 48,
      width: 48,
      height: 48,
      top: 768 - 24 - 48,
      right: 1024 - 24,
      bottom: 768 - 24,
      left: 1024 - 24 - 48,
      toJSON: () => ({}),
    } as DOMRect)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('点击(无位移)打开导航卡,且不写入位置', () => {
    render(<MobileNavFab />)
    const ball = screen.getByRole('button', { name: 'Toggle Sidebar' })

    fireEvent.pointerDown(ball, { pointerId: 1, clientX: 300, clientY: 700 })
    fireEvent.pointerUp(ball, { pointerId: 1, clientX: 300, clientY: 700 })
    fireEvent.click(ball)

    expect(setOpenMobile).toHaveBeenCalledWith(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('拖动后记住位置,并且那一次 click 被吞掉(不误开导航卡)', () => {
    render(<MobileNavFab />)
    const ball = screen.getByRole('button', { name: 'Toggle Sidebar' })

    drag(ball, { x: 300, y: 700 }, { x: 260, y: 620 })
    fireEvent.click(ball)

    const stored = window.localStorage.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored as string)).toEqual({ right: 64, bottom: 104 })
    expect(setOpenMobile).not.toHaveBeenCalled()
  })

  it('再次挂载时套用记忆位置', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ right: 40, bottom: 200 })
    )
    render(<MobileNavFab />)
    const ball = screen.getByRole('button', { name: 'Toggle Sidebar' })

    expect(ball).toHaveStyle({ right: '40px', bottom: '200px' })
  })

  it('记忆位置越界时夹回可视区', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ right: -50, bottom: 99999 })
    )
    render(<MobileNavFab />)
    const ball = screen.getByRole('button', { name: 'Toggle Sidebar' })

    const style = ball.getAttribute('style') ?? ''
    expect(style).toContain('right: 8px')
    // jsdom 默认视口高 768:768 - 48 - 8 = 712
    expect(style).toContain(`bottom: ${window.innerHeight - 48 - 8}px`)
  })
})
