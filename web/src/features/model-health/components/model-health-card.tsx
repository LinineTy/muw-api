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
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { ModelHealthRow } from '../types'
import { ChannelTestDetailPanel } from './channel-test-detail-panel'
import { HealthBlocks } from './health-blocks'
import { SuccessRateBadge } from './success-rate-badge'

export function ModelHealthCard({
  modelName,
  rows,
}: {
  modelName: string
  rows: ModelHealthRow[]
}) {
  const { t } = useTranslation()
  const [expandedId, setExpandedId] = useState<number | null>(null)

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
      <CardHeader className='flex-row items-center gap-3 border-b p-3 sm:p-4'>
        <span className='min-w-0 truncate font-mono text-sm font-semibold'>
          {modelName}
        </span>
        <div className='ml-auto flex shrink-0 items-center gap-2'>
          <SuccessRateBadge rate={overallRate} />
          <span className='text-muted-foreground text-xs'>
            {t('Test count')}: {totalTests}
          </span>
          {totalUserTraffic > 0 && (
            <span className='text-muted-foreground text-xs'>
              {t('Real user traffic')}: {totalUserTraffic}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className='p-0'>
        <div className='divide-y divide-border/60'>
          {rows.map((row) => {
            const expanded = expandedId === row.channel_id
            return (
              <div key={row.channel_id}>
                <div className='flex items-center gap-2 px-3 py-1.5 sm:px-4'>
                  <span className='w-24 shrink-0 truncate text-sm sm:w-32'>
                    {row.channel_name}
                  </span>
                  <HealthBlocks trend={row.trend} />
                  <span className='text-muted-foreground shrink-0 font-mono text-xs tabular-nums'>
                    {row.avg_response_time}ms
                  </span>
                  <SuccessRateBadge rate={row.success_rate} />
                  <div className='ml-auto flex shrink-0 items-center gap-1.5'>
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
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 px-1.5'
                      onClick={() =>
                        setExpandedId(expanded ? null : row.channel_id)
                      }
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
                </div>
                {expanded ? (
                  <div className='bg-muted/30 border-t px-3 py-3 sm:px-4'>
                    <ChannelTestDetailPanel row={row} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
