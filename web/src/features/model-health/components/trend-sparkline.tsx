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
import type { TestTrendPoint } from '../types'

// TrendSparkline renders the recent latency history of a (channel, model) pair
// as a tiny inline SVG polyline. Failing probes are drawn as red dots so a
// degradation is visible at a glance without a chart dependency.
export function TrendSparkline({
  trend,
  width = 96,
  height = 28,
}: {
  trend: TestTrendPoint[]
  width?: number
  height?: number
}) {
  if (!trend || trend.length < 2) return null

  const values = trend.map((point) => point.response_time)
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const range = Math.max(max - min, 1)
  const stepX = width / (trend.length - 1)
  const padY = 3

  const points = trend.map((point, index) => {
    const x = index * stepX
    const y =
      height - padY - ((point.response_time - min) / range) * (height - padY * 2)
    return { x, y, point }
  })
  const line = points.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <svg
      width={width}
      height={height}
      className='overflow-visible'
      role='img'
      aria-label='latency trend'
    >
      <polyline
        points={line}
        fill='none'
        stroke='currentColor'
        strokeWidth={1.5}
        strokeLinejoin='round'
        strokeLinecap='round'
        className='text-muted-foreground/60'
      />
      {points.map((p) => (
        <circle
          key={`${p.point.created_at}-${p.point.response_time}`}
          cx={p.x}
          cy={p.y}
          r={1.8}
          className={p.point.success ? 'fill-success' : 'fill-destructive'}
        />
      ))}
    </svg>
  )
}
