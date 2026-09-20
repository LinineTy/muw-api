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

/** 站点名:优先已缓存的后台配置,其次页面标题(与 index.html 的取法一致) */
export function appLoadingBrandName(): string {
  const cached = readCachedStatus()?.system_name
  if (typeof cached === 'string' && cached.trim()) return cached.trim()
  if (typeof document !== 'undefined' && document.title) return document.title
  return 'Muw API'
}
