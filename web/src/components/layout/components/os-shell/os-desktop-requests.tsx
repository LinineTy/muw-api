// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getUserQuotaDates } from '@/features/dashboard/api'
import { USAGE_LOGS_DEFAULT_SECTION } from '@/features/usage-logs/section-registry'
import { formatNumber } from '@/lib/format'

import { useOsShellNavigate } from './os-open'
import { OsWidget, WIDGET_CLICKABLE_CLASS } from './os-widget'

/**
 * OS 桌面 · 今日请求数小组件（1x1）
 *
 * 2026-09-12 定的首批桌面组件之一。数据源与概览页的请求趋势**同源**：
 * `getUserQuotaDates`（普通用户走 `/api/data/self`）按小时返回 `count`，这里把今天 0 点起的
 * 求和 —— 与余额卡的"今天 $x"同一时间窗，读起来是一套。
 *
 * 1x1 放不下趋势线，所以形态是"标签 + 大数字 + 今天"，不硬塞进度条（请求数没有天然百分比，
 * 硬造一个比值只会误导）。点击 = 打开使用日志（能看到构成这个数字的每一条）。
 */
export function OsDesktopRequests() {
  const { t } = useTranslation()
  const osNavigate = useOsShellNavigate()

  const { start, end } = useMemo(() => {
    const now = new Date()
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    return {
      start: Math.floor(dayStart.getTime() / 1000),
      end: Math.floor(now.getTime() / 1000),
    }
  }, [])

  const { data } = useQuery({
    queryKey: ['os-widget-today-requests', start],
    queryFn: async () => {
      const res = await getUserQuotaDates({
        start_timestamp: start,
        end_timestamp: end,
        default_time: 'hour',
      })
      const items = res?.data ?? []
      return items.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
    },
    staleTime: 60000,
    refetchInterval: 120000,
  })

  return (
    <OsWidget size='1x1'>
      <button
        type='button'
        // 使用日志的规范 URL = `/usage-logs/<默认分区>`（侧栏用的就是它）。
        // 传 `/usage-logs` 只是 redirect stub → 窗口标题变原始路径、Dock 没图标（2026-09-13截图）
        onClick={() => osNavigate(`/usage-logs/${USAGE_LOGS_DEFAULT_SECTION}`)}
        className={WIDGET_CLICKABLE_CLASS}
      >
        <span className='text-muted-foreground truncate text-[0.6875rem] leading-none'>
          {t('Requests')}
        </span>
        <span className='text-xl leading-none font-semibold tabular-nums'>
          {data === undefined ? '—' : formatNumber(data)}
        </span>
        <span className='text-muted-foreground text-[0.625rem] leading-none'>
          {t('Today')}
        </span>
      </button>
    </OsWidget>
  )
}
