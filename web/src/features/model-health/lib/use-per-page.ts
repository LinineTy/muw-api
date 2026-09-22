// @muw-owned
import { useLayoutEffect, useState, type RefObject } from 'react'

import { perPageForWidth } from './layout'

/**
 * 量容器实际宽度算「每页放几张渠道瓷砖」。
 *
 * 观测的是瓷砖网格自身（block 级、宽度由卡片决定，跟列数无关），所以不会因为
 * perPage 变化而反复触发 —— 与 `health-blocks.tsx` 的观测套路一致。
 */
export function usePerPage(ref: RefObject<HTMLElement | null>): number {
  const [perPage, setPerPage] = useState(1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setPerPage(perPageForWidth(el.clientWidth))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return perPage
}
