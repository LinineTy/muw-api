/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
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
const BLOCK_SIZE = 10 // px
const BLOCK_GAP = 3 // px

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
export function HealthBlocks({ trend }: { trend: TestTrendPoint[] }) {
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
      className='flex min-w-0 flex-1 items-center gap-[3px] overflow-hidden'
    >
      {visible.length === 0 ? (
        <span className='text-muted-foreground text-xs'>—</span>
      ) : (
        visible.map((point) => (
          <Tooltip key={`${point.created_at}-${point.response_time}`}>
            <TooltipTrigger
              render={
                <span
                  data-health-block
                  className={`size-2.5 shrink-0 cursor-default rounded-[2px] ${healthBlockClass(point)}`}
                />
              }
            />
            <TooltipContent side='top' className='max-w-xs'>
              <p className='font-mono text-xs'>
                {formatTimestampToDate(point.created_at)}
              </p>
              <p className='font-mono text-xs'>
                {point.response_time}ms · {healthBlockLabel(t, point)}
              </p>
            </TooltipContent>
          </Tooltip>
        ))
      )}
    </div>
  )
}
