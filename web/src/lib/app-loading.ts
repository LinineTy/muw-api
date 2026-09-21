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
  riseMs: 500,
  settleMs: 150,
  fadeMs: 240,
} as const

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
