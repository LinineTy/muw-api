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
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestampToDate } from '@/lib/format'

import type { TestTrendPoint } from '../types'

// HealthBlocks renders the recent probe outcomes of a (channel, model) pair as
// a strip of small colored squares (Uptime Kuma style): green = success, red =
// failure. Hover a square for the exact time and latency. Missing data renders
// as a muted dash.
export function HealthBlocks({ trend }: { trend: TestTrendPoint[] }) {
  const { t } = useTranslation()

  if (!trend || trend.length === 0) {
    return <span className='text-muted-foreground text-xs'>—</span>
  }

  return (
    <div className='flex min-w-0 flex-wrap items-center gap-[3px]'>
      {trend.map((point) => (
        <Tooltip key={`${point.created_at}-${point.response_time}`}>
          <TooltipTrigger
            render={
              <span
                className={`h-2.5 w-2.5 shrink-0 cursor-default rounded-[2px] ${
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
