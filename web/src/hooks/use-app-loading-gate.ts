// @muw-owned
import { useEffect, useState } from 'react'

import {
  APP_LOADING_TIMING,
  appLoadingBrandName,
  appLoadingCycleMs,
  readSplashRound,
  splashBootRoundPlayed,
} from '@/lib/app-loading'

/**
 * 「一轮播完再放行」的闸门(React 侧)。
 *
 * 首屏那份内联占位由 `routes/__root.tsx` 按内联量到的真实起止撤下；这里是给
 * 应用内部自己渲染占位的场景(如首页内容未就绪)用同一条规则:占位出现后,
 * 至少让这一轮逐字上浮走完再放行,否则就是「刚浮一半就进去了」。
 *
 * `active` = 当前是否需要占位;返回 true 表示这一轮已经走完、可以放行。
 */
export function useAppLoadingGate(active: boolean): boolean {
  const [released, setReleased] = useState(!active)

  useEffect(() => {
    if (!active) {
      setReleased(true)
      return
    }
    const bootRound = readSplashRound()
    // 首屏那一轮已经播过:这里是它的接续(站点名还在屏上),没有新一轮要等
    if (splashBootRoundPlayed()) {
      setReleased(true)
      return
    }
    setReleased(false)
    const letterCount = Array.from(appLoadingBrandName()).length
    let reduced = false
    try {
      reduced =
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        Boolean(bootRound?.reduced)
    } catch {
      reduced = Boolean(bootRound?.reduced)
    }
    const holdFor = reduced
      ? APP_LOADING_TIMING.reducedMotionHoldMs
      : appLoadingCycleMs(letterCount)

    let timer: number | undefined
    // 首帧再起算:与逐字上浮动画的时钟对齐(动画也是从首次渲染起算)
    const raf = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => setReleased(true), holdFor)
    })
    return () => {
      window.cancelAnimationFrame(raf)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [active])

  return released
}
