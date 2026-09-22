// @muw-owned
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestampToDate } from '@/lib/format'

import type { TestTrendPoint } from '../types'

// BLOCK_SIZE is the default-theme estimate; the actual rendered width (theme's
// --spacing scales it up on large theme scales) is measured from the DOM.
// 2026-09-23：方块压扁成 3×10 的细长条（纵向不变、横向压扁），同样宽度能放约 3 倍
// 的历史，卡片密度上去了。
const BLOCK_SIZE = 3 // px
const BLOCK_GAP = 2 // px

// healthBlockClass maps one probe outcome to its block color:
//   green          success, or a moderation block (the upstream handled the
//                  request and returned a business moderation verdict — the
//                  channel is alive and worked end to end)
//   amber/warning  client error — the request itself is broken (bad params,
//                  unknown model, oversized context…); not the channel's fault
//   red            upstream error, or legacy records without error_kind
//                  (unclassified failures stay red so real outages are never
//                  de-emphasized)
function healthBlockClass(point: TestTrendPoint): string {
  if (point.success) return 'bg-success'
  switch (point.error_kind) {
    case 'client':
      return 'bg-warning'
    case 'moderation':
      return 'bg-success'
    default:
      return 'bg-destructive'
  }
}

// healthBlockLabel describes a failed probe by responsible party for tooltips.
function healthBlockLabel(t: (k: string) => string, point: TestTrendPoint) {
  if (point.success) return t('Success')
  switch (point.error_kind) {
    case 'client':
      return t('Bad request (client)')
    case 'moderation':
      return t('Content moderation')
    default:
      return t('Failed')
  }
}

// HealthBlocks renders the probe outcomes of a (channel, model) pair as a row of
// fixed-size colored squares (Uptime Kuma style): green = success (incl.
// moderation verdicts), amber = client-side request errors, red = upstream
// failures. The number of blocks adapts to the container width — as many newest
// blocks as fit — so the strip fills the available space instead of a fixed
// count. Missing data renders as a muted dash.
export function HealthBlocks({
  trend,
  hideLatency = false,
}: {
  trend: TestTrendPoint[]
  /** 普通用户视角：探测耗时不下发也不展示，tooltip 只给时间与结果 */
  hideLatency?: boolean
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [blockSize, setBlockSize] = useState(BLOCK_SIZE)

  // Observe the container ONCE. The trend prop is a fresh array on every parent
  // render, so a trend-keyed effect would tear down and rebuild the observer
  // constantly — and could miss a width change that lands between the disconnect
  // and the re-observe (e.g. the admin Detail button appearing after mount),
  // leaving the strip sized for a wider container and overflowing the row. A
  // stable observer survives those re-renders and always reports the latest
  // width; the block count is derived from that width in the render below.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const hasTrend = Boolean(trend && trend.length > 0)
  // Derive the count from the LATEST measured width and block size so every
  // re-render (trend data arriving, the container resizing) reflects the current
  // layout — on any theme scale.
  const count = hasTrend
    ? Math.min(
        Math.max(1, Math.floor((containerWidth + BLOCK_GAP) / (blockSize + BLOCK_GAP))),
        trend.length
      )
    : 0
  const visible = count > 0 ? trend.slice(-count) : []

  // Measure the real rendered block width once blocks are visible. The block
  // class is theme-scaled (`size-2.5` = calc(var(--spacing) * 2.5)), so on a
  // large theme scale the blocks render wider than the 10px estimate — the fit
  // calc must use the measured value or the strip overflows the container.
  const hasBlocks = visible.length > 0
  useLayoutEffect(() => {
    if (!hasBlocks) return
    const first = containerRef.current?.querySelector<HTMLElement>('[data-health-block]')
    if (!first) return
    const width = first.getBoundingClientRect().width
    if (width > 0) setBlockSize(width)
  }, [hasBlocks])

  // The container div always renders (empty state included) so containerRef is
  // populated from the start and the observer is set up before trend data
  // arrives. `overflow-hidden` is a safety net: even if a measurement is ever
  // stale by a block or two, the strip clips at its own edge instead of painting
  // over the Detail button.
  return (
    <div
      ref={containerRef}
      className='flex min-w-0 flex-1 items-center gap-[2px] overflow-hidden'
    >
      {visible.length === 0 ? (
        <span className='text-muted-foreground text-xs'>—</span>
      ) : (
        // key 用下标:created_at 只有秒级精度,且对非管理员响应耗时已被抹掉,
        // 「时间+耗时」无法唯一(同秒并发探测常见),会导致 React 重复 key。
        // 这些块是无状态叶子节点,下标作 key 安全。
        visible.map((point, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- 同秒探测点无数据可区分
          <Tooltip key={`${point.created_at}-${index}`}>
            <TooltipTrigger
              render={
                <span
                  data-health-block
                  className={`h-2.5 w-[3px] shrink-0 cursor-default rounded-[1px] ${healthBlockClass(point)}`}
                />
              }
            />
            <TooltipContent side='top' className='max-w-xs'>
              <p className='font-mono text-xs'>
                {formatTimestampToDate(point.created_at)}
              </p>
              <p className='font-mono text-xs'>
                {hideLatency
                  ? healthBlockLabel(t, point)
                  : `${point.response_time}ms · ${healthBlockLabel(t, point)}`}
              </p>
            </TooltipContent>
          </Tooltip>
        ))
      )}
    </div>
  )
}
