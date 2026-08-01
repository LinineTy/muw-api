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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatRelativeTime } from '@/features/channels/lib/channel-utils'
import { formatTimestampToDate } from '@/lib/format'

import { getChannelTestRecords } from '../api'
import type { ModelHealthRow } from '../types'

const PAGE_SIZE = 20

// ChannelTestDetailDrawer shows the raw probe history of one (channel, model)
// pair, newest first, with pagination, plus a compact aggregate summary of the
// pair taken from the health row.
export function ChannelTestDetailDrawer({
  row,
  open,
  onOpenChange,
}: {
  row: ModelHealthRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (open) setPage(1)
  }, [open])

  const recordsQuery = useQuery({
    queryKey: ['channel-test-records', row?.channel_id, row?.model_name, page],
    queryFn: () =>
      getChannelTestRecords({
        channel_id: row?.channel_id ?? 0,
        model: row?.model_name ?? '',
        page,
        page_size: PAGE_SIZE,
      }),
    enabled: open && row != null,
    retry: false,
  })

  const data = recordsQuery.data?.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  let recordsContent: ReactNode
  if (recordsQuery.isLoading) {
    recordsContent = (
      <div className='space-y-2'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
      </div>
    )
  } else if (!data || data.records.length === 0) {
    recordsContent = (
      <p className='text-muted-foreground py-8 text-center text-sm'>
        {t('No records')}
      </p>
    )
  } else {
    recordsContent = data.records.map((record) => (
      <div
        key={record.id}
        className='bg-background/60 flex items-center gap-2 rounded-lg border px-3 py-2'
      >
        <StatusBadge
          label={record.success ? t('Success') : t('Failed')}
          variant={record.success ? 'success' : 'danger'}
          copyable={false}
        />
        <span className='font-mono text-xs tabular-nums'>
          {record.response_time}ms
        </span>
        <span className='text-muted-foreground min-w-0 flex-1 truncate text-xs'>
          {record.error_reason || '-'}
        </span>
        <Tooltip>
          <TooltipTrigger render={<span className='shrink-0 text-xs' />}>
            {formatRelativeTime(record.created_at)}
          </TooltipTrigger>
          <TooltipContent>
            <p className='font-mono text-sm'>
              {formatTimestampToDate(record.created_at)}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    ))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='w-full sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle className='truncate'>
            {row?.channel_name ?? ''} · {row?.model_name ?? ''}
          </SheetTitle>
          <SheetDescription>
            {t('Recent channel test records')}
          </SheetDescription>
        </SheetHeader>

        {row ? (
          <div className='px-4'>
            <div className='grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4'>
              <div>
                <p className='text-muted-foreground text-xs'>
                  {t('Success rate')}
                </p>
                <p className='font-mono text-sm'>
                  {row.success_rate.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>{t('Total')}</p>
                <p className='font-mono text-sm'>{row.test_count}</p>
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>
                  {t('Avg response')}
                </p>
                <p className='font-mono text-sm'>{row.avg_response_time}ms</p>
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>
                  {t('Real user traffic')}
                </p>
                <p className='font-mono text-sm'>
                  {row.user_traffic_count ?? 0}
                </p>
              </div>
            </div>
            {row.last_error ? (
              <p className='text-destructive mt-2 line-clamp-2 text-xs'>
                {t('Last error')}: {row.last_error}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className='flex-1 space-y-1 overflow-y-auto px-4 pb-4'>
          {recordsContent}
        </div>

        <SheetFooter className='flex-row items-center justify-between'>
          <span className='text-muted-foreground text-xs'>
            {t('Total')}: {data?.total ?? 0}
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t('Previous')}
            </Button>
            <span className='text-muted-foreground text-xs'>
              {page} / {totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
