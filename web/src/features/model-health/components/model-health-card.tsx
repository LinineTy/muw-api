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
import { History } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatRelativeTime } from '@/features/channels/lib/channel-utils'

import type { ModelHealthRow } from '../types'
import { SuccessRateBadge } from './success-rate-badge'
import { TrendSparkline } from './trend-sparkline'

export function ModelHealthCard({
  modelName,
  rows,
  onViewDetail,
}: {
  modelName: string
  rows: ModelHealthRow[]
  onViewDetail: (
    channelId: number,
    channelName: string,
    modelName: string
  ) => void
}) {
  const { t } = useTranslation()

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
        <div className='divide-border/60 divide-y'>
          {rows.map((row) => {
            const lastError = row.last_error
            return (
              <div
                key={row.channel_id}
                className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4'
              >
                <div className='flex min-w-0 items-center gap-3'>
                  <span className='min-w-0 flex-1 truncate text-sm'>
                    {row.channel_name}
                  </span>
                  <span className='font-mono text-xs text-muted-foreground tabular-nums'>
                    {row.avg_response_time}ms
                  </span>
                  <span className='hidden text-xs text-muted-foreground sm:inline'>
                    {t('Last tested')}:{' '}
                    {formatRelativeTime(row.last_test_time)}
                  </span>
                  {lastError ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <StatusBadge
                            label={t('Failed')}
                            variant='danger'
                            copyable={false}
                            className='shrink-0'
                          />
                        }
                      />
                      <TooltipContent side='top' className='max-w-xs'>
                        <p className='break-words font-mono text-xs'>
                          {lastError}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <div className='flex items-center gap-2'>
                  <div className='hidden text-muted-foreground md:block'>
                    <TrendSparkline trend={row.trend} />
                  </div>
                  <SuccessRateBadge rate={row.success_rate} />
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2'
                    onClick={() =>
                      onViewDetail(row.channel_id, row.channel_name, row.model_name)
                    }
                  >
                    <History className='size-3.5' />
                    <span className='hidden sm:inline'>{t('Detail')}</span>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
