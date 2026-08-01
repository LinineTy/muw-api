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
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { ModelHealthRow, TestTrendPoint } from '../types'
import { ChannelTestDetailPanel } from './channel-test-detail-panel'
import { HealthBlocks } from './health-blocks'
import { SuccessRateBadge } from './success-rate-badge'

// mergeTrend combines every channel's probe history of a model into one
// chronological strip (oldest → newest). The compact model-level heartbeat
// renders as many newest blocks as fit the container width, so no hard cap here.
function mergeTrend(rows: ModelHealthRow[]): TestTrendPoint[] {
  const points: TestTrendPoint[] = []
  for (const row of rows) {
    for (const point of row.trend) points.push(point)
  }
  points.sort(
    (a, b) => a.created_at - b.created_at || a.response_time - b.response_time
  )
  return points
}

// ModelHealthCard renders one model as a compact two-line block: line 1 shows
// the model name and overall success rate, line 2 shows the health blocks strip
// and the detail toggle. Expanding reveals per-channel rows with their own
// expandable raw records.
export function ModelHealthCard({
  modelName,
  rows,
}: {
  modelName: string
  rows: ModelHealthRow[]
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const totalTests = rows.reduce((sum, row) => sum + row.test_count, 0)
  const totalSuccess = rows.reduce((sum, row) => sum + row.success_count, 0)
  const totalUserTraffic = rows.reduce(
    (sum, row) => sum + (row.user_traffic_count ?? 0),
    0
  )
  const overallRate =
    totalTests > 0 ? (totalSuccess / totalTests) * 100 : 0

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <div className='flex items-center gap-2 px-3 pt-2 sm:px-4'>
        <span className='min-w-0 flex-1 truncate font-mono text-sm font-medium'>
          {modelName}
        </span>
        <span className='text-muted-foreground shrink-0 text-xs'>
          {t('Test count')}: {totalTests}
        </span>
        {totalUserTraffic > 0 && (
          <span className='text-muted-foreground shrink-0 text-xs'>
            {t('Real user traffic')}: {totalUserTraffic}
          </span>
        )}
        <SuccessRateBadge rate={overallRate} />
      </div>

      <div className='flex items-center gap-2 px-3 pb-1.5 sm:px-4'>
        <HealthBlocks trend={mergeTrend(rows)} />
        <Button
          variant='ghost'
          size='sm'
          className='ml-auto h-6 px-1.5'
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronUp className='size-3.5' />
          ) : (
            <ChevronDown className='size-3.5' />
          )}
          <span className='hidden text-xs md:inline'>
            {expanded ? t('Collapse') : t('Detail')}
          </span>
        </Button>
      </div>

      {expanded ? (
        <div className='bg-muted/30 border-t px-3 py-2 sm:px-4'>
          <div className='space-y-3'>
            {rows.map((row) => (
              <div key={row.channel_id}>
                <div className='mb-1 flex items-center gap-2'>
                  <span className='truncate text-xs font-medium'>
                    {row.channel_name}
                  </span>
                  <span className='text-muted-foreground shrink-0 font-mono text-xs tabular-nums'>
                    {row.avg_response_time}ms
                  </span>
                  {row.last_error ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className='bg-destructive size-2 shrink-0 rounded-full' />
                        }
                      />
                      <TooltipContent side='top' className='max-w-xs'>
                        <p className='break-words font-mono text-xs'>
                          {row.last_error}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <ChannelTestDetailPanel row={row} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
