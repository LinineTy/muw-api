// @muw-owned
import { readCachedStatus } from '@/lib/status-query'

/**
 * 加载占位(站点名逐字上浮 + 呼吸)的共享定义:时序常量 + 站点名来源。
 *
 * 同一套视觉有三处实现,改一处要同步另外两处:
 * 1. `web/index.html` 内联的 `#app-loading`(打包产物之前就要能画出来,样式只能内联)
 * 2. `src/components/app-loading.tsx`(React 侧,样式在 `src/styles/index.css`)
 * 3. `src/routes/__root.tsx`(路由 idle 后按时序撤下占位)
 */
export const APP_LOADING_TIMING = {
  showDelayMs: 150,
  appearMs: 300,
  staggerMs: 40,
  riseMs: 420,
  settleMs: 150,
  fadeMs: 240,
  /**
   * 系统要求「减少动效」时没有逐字上浮可等，但站点名也不能一闪而过 ——
   * 至少留这么久再撤(否则就是维护者看到的「闪进」)。
   */
  reducedMotionHoldMs: 900,
} as const

/**
 * 内联占位(index.html)在浏览器里量到的这一轮真实起止。
 *
 * ⚠️ 动画的时钟从「浏览器第一次渲染占位」开始，而 `performance.now()` 从导航开始 ——
 * 冷加载时两者差上百毫秒到一秒多。撤占位必须以这里为准，不能拿 `performance.now()`
 * 直接减一轮时长，否则这一轮会被截断(2026-09-22 线上实测)。
 */
export type SplashRound = {
  letterCount: number
  /** 首帧时刻(ms, performance.now() 口径)，null = 还没画 */
  startedAt: number | null
  /** 末字落定时刻(animationend)，null = 还没结束/无动画 */
  endedAt: number | null
  /** 系统要求减少动效(无逐字上浮) */
  reduced: boolean
}

export function readSplashRound(): SplashRound | null {
  if (typeof window === 'undefined') return null
  const round = (window as unknown as { __muwSplash?: SplashRound }).__muwSplash
  return round && typeof round.letterCount === 'number' ? round : null
}

/** 这一轮真正可以撤下的时刻(performance.now() 口径)。 */
export function splashRoundEndAt(round: SplashRound, letterCount: number) {
  const start = round.startedAt ?? 0
  if (round.reduced) return start + APP_LOADING_TIMING.reducedMotionHoldMs
  return (
    (round.endedAt ?? start + appLoadingCycleMs(letterCount)) +
    APP_LOADING_TIMING.settleMs
  )
}

/**
 * 一轮「站点名逐字上浮」的总时长:首字起浮 → 末字落定 → 余韵。
 *
 * 用来守住首屏:路由就绪也不许半途抽走占位,必须等当前这一轮播完
 * (否则就是「字刚浮一半就进去了」)。名字越长每字错开得越开,一轮越久。
 */
export function appLoadingCycleMs(letterCount: number): number {
  const letters = Math.max(1, letterCount)
  return (
    APP_LOADING_TIMING.showDelayMs +
    (letters - 1) * APP_LOADING_TIMING.staggerMs +
    APP_LOADING_TIMING.riseMs +
    APP_LOADING_TIMING.settleMs
  )
}

/** 站点名:优先已缓存的后台配置,其次页面标题(与 index.html 的取法一致) */
export function appLoadingBrandName(): string {
  const cached = readCachedStatus()?.system_name
  if (typeof cached === 'string' && cached.trim()) return cached.trim()
  if (typeof document !== 'undefined' && document.title) return document.title
  return 'Muw API'
}

/**
 * 首屏那一轮逐字上浮是否已经播过(或本来就没有——减少动效)。
 *
 * 应用内部再渲染同一个占位时(如首页内容未就绪),它应当是首屏那一屏的**接续**:
 * 站点名已经浮在上面了,不该再浮一次——再浮一次就是「闪一下又重来」。
 */
export function splashBootRoundPlayed(): boolean {
  const round = readSplashRound()
  return Boolean(round && (round.endedAt !== null || round.reduced))
}
