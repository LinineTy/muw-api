// @muw-owned
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { OsWhale } from '../os-whale'
import {
  WHALE_GIF_FAIL_LINES,
  WHALE_PRAISE_LINES,
  WHALE_SNARK_LINES,
  WHALE_SOLO_LINES,
  WHALE_WHINE_LINES,
} from '../os-whale-lines'
import {
  useOsWhaleStore,
  WHALE_DEFAULT_SCALE,
  WHALE_DEFAULT_SOUND_SET,
} from '../os-whale-store'

/**
 * 小鲸鱼挂件 · 手感契约
 *
 * 2026-09-14：「只要好玩的，数据的不要」—— 于是这里钉住的就是那几件"好玩的"：
 * 右下角定格、按下去会压扁（底部不动）、点一下张嘴说台词、5 秒自动收、
 * 以及"拖动不算点击"。数据面（余额/今日已用/刷新）不该在这组件里出现。
 *
 * jsdom 里 canvas / 图片解码都不可用 ⇒ 命中测试走"画布没就绪就当我命中"的兜底分支，
 * 正好方便用坐标直接驱动交互（像素级命中在浏览器里由 dev 栈验证）。
 */
const TEXT_POOLS = [
  ...WHALE_PRAISE_LINES,
  ...WHALE_WHINE_LINES,
  ...WHALE_SNARK_LINES,
  ...WHALE_SOLO_LINES,
  ...WHALE_GIF_FAIL_LINES,
]

let played: string[] = []

beforeEach(() => {
  played = []
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
    function (this: HTMLMediaElement) {
      played.push(this.src)
      return Promise.resolve()
    }
  )
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
    () => undefined
  )
  useOsWhaleStore.setState({
    scale: WHALE_DEFAULT_SCALE,
    soundOn: true,
    volume: 1,
    soundSet: WHALE_DEFAULT_SOUND_SET,
    visible: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function pointer(
  type: 'pointerDown' | 'pointerUp' | 'pointerMove',
  x: number,
  y: number
) {
  fireEvent[type](document, {
    button: 0,
    buttons: 1,
    pointerType: 'mouse',
    clientX: x,
    clientY: y,
  })
}

/** 点一下鲸鱼本体（按下与松开同点 ⇒ 不是拖动） */
function tapWhale(x = 200, y = 200) {
  act(() => {
    pointer('pointerDown', x, y)
    pointer('pointerUp', x, y)
  })
}

function whaleShell(container: HTMLElement) {
  return container.firstElementChild as HTMLElement
}

/** 压扁作用在 body 上（图片的父层） */
function whaleBody(container: HTMLElement) {
  return container.querySelector('img')?.parentElement as HTMLElement
}

function bubbleText(container: HTMLElement) {
  return container.textContent ?? ''
}

describe('OsWhale', () => {
  test('右下角定格，尺寸跟着 store 的倍数走（默认 1.2 倍）', () => {
    const { container } = render(<OsWhale />)
    const shell = whaleShell(container)
    expect(shell.className).toContain('fixed')
    expect(shell.className).toContain('right-0')
    expect(shell.className).toContain('bottom-0')
    // 可穿透：只有点到鲸鱼像素才响应
    expect(shell.className).toContain('pointer-events-none')
    // jsdom 的 CSS 解析器不认识 clamp/calc，直接看 inline style 原文
    expect(shell.getAttribute('style')).toContain('* 1.2)')

    act(() => useOsWhaleStore.getState().setScale(1.8))
    expect(whaleShell(container).getAttribute('style')).toContain('* 1.8)')
  })

  test('按下去压扁（底部不动），松手回弹', () => {
    const { container } = render(<OsWhale />)
    const body = whaleBody(container)
    expect(body.style.transformOrigin).toBe('50% 100%')

    act(() => pointer('pointerDown', 200, 200))
    expect(body.style.transform).toContain('scaleY(0.88)')

    act(() => pointer('pointerUp', 200, 200))
    expect(body.style.transform).toBe('')
  })

  test('按压出声；音效关掉就不出声', () => {
    render(<OsWhale />)
    tapWhale()
    expect(played.some((src) => src.includes('duck-press.mp3'))).toBe(true)

    played = []
    act(() => useOsWhaleStore.getState().setSoundOn(false))
    tapWhale()
    expect(played).toEqual([])
  })

  test('切音效集后按压走另一套素材（小黄鸭 → 音效 1）', () => {
    render(<OsWhale />)
    act(() => useOsWhaleStore.getState().setSoundSet('fx1'))
    played = []
    tapWhale()
    // 切集要重建 Audio：按的必须是 fx1 那套，不能还挂着上一集的 src
    expect(played.some((src) => src.includes('fx1-press.mp3'))).toBe(true)
    expect(played.some((src) => src.includes('duck-press.mp3'))).toBe(false)

    act(() => useOsWhaleStore.getState().setSoundSet('duck'))
    played = []
    tapWhale()
    expect(played.some((src) => src.includes('duck-press.mp3'))).toBe(true)
  })

  test('整个挂件可关可开：关掉后什么都不渲染，其它偏好原样保留', () => {
    const { container } = render(<OsWhale />)
    expect(whaleShell(container)).toBeTruthy()

    act(() => useOsWhaleStore.getState().setScale(1.8))
    act(() => useOsWhaleStore.getState().setVisible(false))
    // 关掉 = 整块不渲染（盒子/像素命中/气泡/音效一起消失），右下角点击照常穿透
    expect(container.firstElementChild).toBeNull()

    act(() => useOsWhaleStore.getState().setVisible(true))
    const shell = whaleShell(container)
    expect(shell.className).toContain('fixed')
    expect(shell.getAttribute('style')).toContain('* 1.8)')
  })

  test('关掉后不再吞指针事件（点原位置不会出声、不会张嘴）', () => {
    const { container } = render(<OsWhale />)
    tapWhale()
    expect(played.length).toBeGreaterThan(0)
    if (bubbleText(container)) tapWhale() // 收掉刚打开的气泡

    act(() => useOsWhaleStore.getState().setVisible(false))
    played = []
    tapWhale()
    expect(played).toEqual([])
    expect(bubbleText(container)).toBe('')
  })

  test('点一下张嘴说一句台词，再点一次闭嘴', () => {
    vi.useFakeTimers()
    const { container } = render(<OsWhale />)
    expect(bubbleText(container)).toBe('')

    tapWhale()
    const spoken = TEXT_POOLS.filter((line) =>
      bubbleText(container).includes(line)
    )
    const isGif = '' === bubbleText(container)
    // 抽到动图那段（10/28 概率）时气泡里没有文字，这里只断言"不是数据台词"
    if (!isGif) expect(spoken.length).toBeGreaterThan(0)
    expect(bubbleText(container)).not.toContain('今日已用')
    expect(bubbleText(container)).not.toContain('余额')

    // 再点一次：立刻不再展开（内容等淡出 260ms 后才卸）
    tapWhale()
    act(() => vi.advanceTimersByTime(300))
    expect(bubbleText(container)).toBe('')
  })

  test('5 秒后自动收起', () => {
    vi.useFakeTimers()
    const { container } = render(<OsWhale />)
    tapWhale()
    const before = bubbleText(container)

    act(() => vi.advanceTimersByTime(4900))
    expect(bubbleText(container)).toBe(before)
    act(() => vi.advanceTimersByTime(400))
    expect(bubbleText(container)).toBe('')
  })

  test('位移超过阈值视为拖动，不触发台词', () => {
    vi.useFakeTimers()
    const { container } = render(<OsWhale />)
    act(() => {
      pointer('pointerDown', 200, 200)
      pointer('pointerMove', 206, 206)
      pointer('pointerUp', 206, 206)
    })
    expect(bubbleText(container)).toBe('')
  })

  test('被窗口盖住时不再吞点击（幽灵吞点击回归）', () => {
    const { container } = render(<OsWhale />)
    const shell = whaleShell(container)
    const whaleBox = container.querySelector('[data-os-whale]')
    expect(whaleBox).toBe(shell)

    // 造一个"压在鲸鱼上面"的窗口元素（窗口层 zIndex 10~45 > 鲸鱼 z-0）
    const winEl = document.createElement('div')
    winEl.setAttribute('data-os-window', 'w1')
    document.body.appendChild(winEl)

    const doc = document as unknown as {
      elementFromPoint?: (x: number, y: number) => Element | null
    }
    const original = doc.elementFromPoint
    try {
      // ① 该点最上层是窗口 ⇒ 放行：不出声、不张嘴（窗口里的按钮要能点到）
      doc.elementFromPoint = () => winEl
      played = []
      tapWhale()
      expect(played).toEqual([])
      expect(bubbleText(container)).toBe('')

      // ② 该点最上层是桌面/空白（body）⇒ 鲸鱼露着，照旧响应
      doc.elementFromPoint = () => document.body
      played = []
      tapWhale()
      expect(played.length).toBeGreaterThan(0)

      // ③ 该点最上层是鲸鱼自己的子层（气泡展开时的 pointer-events-auto 层）⇒ 也算露着
      const inner = container.querySelector('[data-os-whale] img') as Element
      doc.elementFromPoint = () => inner
      played = []
      tapWhale()
      expect(played.length).toBeGreaterThan(0)
    } finally {
      if (original) doc.elementFromPoint = original
      else delete doc.elementFromPoint
      winEl.remove()
    }
  })

  test('层级 = 桌面装饰层（z-0，必须被窗口 zIndex 10~45 盖住）', () => {
    const { container } = render(<OsWhale />)
    const cls = whaleShell(container).className
    expect(cls).toContain('z-0')
    expect(cls).not.toContain('z-40')
    expect(cls).not.toContain('z-[60]')
  })
})
