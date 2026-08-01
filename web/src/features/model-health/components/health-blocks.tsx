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

const BLOCK_SIZE = 10 // px
const BLOCK_GAP = 3 // px

// HealthBlocks renders the probe outcomes of a (channel, model) pair as a row of
// fixed-size colored squares (Uptime Kuma style): green = success, red =
// failure. The number of blocks adapts to the container width — as many newest
// blocks as fit — so the strip fills the available space instead of a fixed
// count. Missing data renders as a muted dash.
export function HealthBlocks({ trend }: { trend: TestTrendPoint[] }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const count = Math.max(
        1,
        Math.floor((el.clientWidth + BLOCK_GAP) / (BLOCK_SIZE + BLOCK_GAP))
      )
      setVisibleCount(Math.min(count, trend.length))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [trend])

  if (!trend || trend.length === 0) {
    return <span className='text-muted-foreground text-xs'>—</span>
  }

  const visible = trend.slice(-visibleCount)

  return (
    <div
      ref={containerRef}
      className='flex min-w-0 flex-1 items-center gap-[3px]'
    >
      {visible.map((point) => (
        <Tooltip key={`${point.created_at}-${point.response_time}`}>
          <TooltipTrigger
            render={
              <span
                className={`size-2.5 shrink-0 cursor-default rounded-[2px] ${
                  point.success ? 'bg-success' : 'bg-destructive'
                }`}
              />
            }
          />
          <TooltipContent side='top' className='max-w-xs'>
            <p className='font-mono text-xs'>
              {formatTimestampToDate(point.created_at)}
            </p>
            <p className='font-mono text-xs'>
              {point.response_time}ms ·{' '}
              {point.success ? t('Success') : t('Failed')}
            </p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
