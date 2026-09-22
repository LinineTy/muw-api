// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatRelativeTime } from '@/features/channels/lib/channel-utils'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'

import { getChannelTestRecords } from '../api'
import type { ModelHealthRow } from '../types'

const PAGE_SIZE = 20

// ChannelTestDetailPanel renders the raw probe history of one (channel, model)
// pair inline below its card row, newest first, with a compact aggregate summary
// and pagination. It is rendered only while the row is expanded.
export function ChannelTestDetailPanel({ row }: { row: ModelHealthRow }) {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(1)

  const recordsQuery = useQuery({
    queryKey: ['channel-test-records', row.channel_id, row.model_name, page],
    queryFn: () =>
      getChannelTestRecords({
        channel_id: row.channel_id,
        model: row.model_name,
        page,
        page_size: PAGE_SIZE,
      }),
    retry: false,
  })

  const data = recordsQuery.data?.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  let recordsContent: ReactNode
  if (recordsQuery.isLoading) {
    recordsContent = (
      <div className='space-y-1'>
        <Skeleton className='h-9 w-full' />
        <Skeleton className='h-9 w-full' />
        <Skeleton className='h-9 w-full' />
      </div>
    )
  } else if (!data || data.records.length === 0) {
    recordsContent = (
      <p className='text-muted-foreground py-6 text-center text-sm'>
        {t('No records')}
      </p>
    )
  } else {
    recordsContent = data.records.map((record) => (
      <div
        key={record.id}
        className='bg-background/60 flex items-center gap-2 rounded-lg border px-3 py-1.5'
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
            {formatRelativeTime(
              record.created_at,
              toIntlLocale(i18n.resolvedLanguage || i18n.language)
            )}
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
    <div className='space-y-1.5'>
      <div className='max-h-72 space-y-1 overflow-y-auto'>{recordsContent}</div>

      <div className='flex items-center justify-between text-xs'>
        <span className='text-muted-foreground'>
          {t('Total')}: {data?.total ?? 0}
        </span>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            className='h-6 px-2'
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('Previous')}
          </Button>
          <span className='text-muted-foreground'>
            {page} / {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            className='h-6 px-2'
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
