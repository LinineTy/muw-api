// @muw-owned
import { useLayoutEffect, useState, type RefObject } from 'react'

import { perPageForWidth } from './layout'

/**
 * 量容器实际宽度算「每页放几张渠道瓷砖」。
 *
 * 观测的是瓷砖网格自身（block 级、宽度由卡片决定，跟列数无关），所以不会因为
 * perPage 变化而反复触发 —— 与 `health-blocks.tsx` 的观测套路一致。
 *
 * enabled=false 用于"网格这一轮根本没渲染"的场景（隐藏渠道）：不量也不观测。重新渲染
 * 时必须靠这个依赖重新量一次 —— 隐藏再显示出来的是**新** DOM 节点，旧观测器跟不到它，
 * 只认 `ref` 的话会一直停在隐藏前的值（甚至被 0 宽度观测带成每页 1 张）。
 */
export function usePerPage(
  ref: RefObject<HTMLElement | null>,
  enabled = true
): number {
  const [perPage, setPerPage] = useState(1)

  useLayoutEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    const update = () => {
      // 量 content box:网格自带 p-3,clientWidth 含左右内距会多报 24px,
      // 恰好够把 178px 的下限判断推过一档(522~545px 时会算成 3 张)。
      const style = getComputedStyle(el)
      const padding =
        (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      setPerPage(perPageForWidth(el.clientWidth - padding))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, enabled])

  return perPage
}
