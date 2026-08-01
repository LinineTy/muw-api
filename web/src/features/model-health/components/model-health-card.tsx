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

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { ModelHealthRow } from '../types'
import { HealthBlocks } from './health-blocks'
import { SuccessRateBadge } from './success-rate-badge'

export function ModelHealthCard({
  modelName,
  rows,
  onViewDetail,
}: {
  modelName: string
  rows: ModelHealthRow[]
  onViewDetail: (row: ModelHealthRow) => void
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
          {rows.map((row) => (
            <div
              key={row.channel_id}
              className='flex items-center gap-3 px-3 py-2.5 sm:px-4'
            >
              <span className='w-28 shrink-0 truncate text-sm sm:w-40'>
                {row.channel_name}
              </span>
              <div className='min-w-0'>
                <HealthBlocks trend={row.trend} />
              </div>
              <div className='ml-auto flex shrink-0 items-center gap-2'>
                <span className='text-muted-foreground font-mono text-xs tabular-nums'>
                  {row.avg_response_time}ms
                </span>
                <SuccessRateBadge rate={row.success_rate} />
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
                  className='h-7 px-2'
                  onClick={() => onViewDetail(row)}
                >
                  <History className='size-3.5' />
                  <span className='hidden sm:inline'>{t('Detail')}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
