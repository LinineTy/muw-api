// @muw-owned
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { textColorMap } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatRelativeTime } from '@/features/channels/lib/channel-utils'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { successRateVariant } from '../lib/success-rate-tier'
import type { ModelHealthRow } from '../types'
import { HealthBlocks } from './health-blocks'

// lastErrorDotClass colors the per-channel last-error dot by failure kind,
// mirroring the heartbeat block colors (amber=client, green=moderation,
// red=upstream/legacy).
function lastErrorDotClass(kind?: string): string {
  switch (kind) {
    case 'client':
      return 'bg-warning'
    case 'moderation':
      return 'bg-success'
    default:
      return 'bg-destructive'
  }
}

/**
 * 单个渠道的瓷砖。
 *
 * 管理员：渠道名 + #id、成功率大字、瓷砖条带、延迟 · 最后探测时间的相对时间 ·
 *         最近错误圆点、「明细」按钮（弹窗看原始探测记录）
 * 普通用户：只有「渠道 #id」+ 成功率 + 测试次数 + 条带 · 相对时间
 *         —— 渠道名、延迟、错误原因、明细入口都不渲染（后端也不下发）
 */
export function ChannelHealthTile({
  row,
  isAdmin,
  onOpenDetail,
}: {
  row: ModelHealthRow
  isAdmin: boolean
  onOpenDetail: (row: ModelHealthRow) => void
}) {
  const { t } = useTranslation()
  const variant = successRateVariant(row.success_rate)

  return (
    <div className='bg-card flex flex-col gap-1.5 rounded-[10px] px-2.5 py-2 ring-1 ring-foreground/[0.07]'>
      <div className='flex min-w-0 items-center gap-1.5'>
        {isAdmin ? (
          <>
            <span className='min-w-0 truncate text-xs font-medium'>
              {row.channel_name}
            </span>
            <span className='bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-px font-mono text-[10.5px]'>
              #{row.channel_id}
            </span>
          </>
        ) : (
          <span className='text-muted-foreground min-w-0 truncate text-xs font-medium'>
            {t('Channel #{{id}}', { id: row.channel_id })}
          </span>
        )}
      </div>

      <div className='flex items-baseline justify-between gap-1.5'>
        <span
          className={cn(
            'font-mono text-[15px] leading-none font-semibold',
            textColorMap[variant]
          )}
        >
          {row.success_rate.toFixed(1)}%
        </span>
        <span className='text-muted-foreground text-[11.5px] whitespace-nowrap'>
          {t('{{count}} tests', { count: formatNumber(row.test_count) })}
        </span>
      </div>

      <HealthBlocks trend={row.trend} hideLatency={!isAdmin} />

      <div className='text-muted-foreground flex flex-wrap items-center gap-1.5 text-[10.5px]'>
        {isAdmin ? (
          <>
            <span className='tabular-nums'>{row.avg_response_time}ms</span>
            <span className='text-border'>·</span>
          </>
        ) : null}
        <span className='whitespace-nowrap'>
          {formatRelativeTime(row.last_test_time)}
        </span>
        {isAdmin && row.last_error ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    lastErrorDotClass(row.last_error_kind)
                  )}
                />
              }
            />
            <TooltipContent side='top' className='max-w-xs'>
              <p className='font-mono text-xs break-words'>{row.last_error}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        {isAdmin ? (
          <Button
            variant='ghost'
            size='sm'
            className='ml-auto h-5 gap-0.5 px-1.5 text-[10.5px]'
            onClick={() => onOpenDetail(row)}
          >
            {t('Detail')}
            <ChevronDown className='size-3' />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
