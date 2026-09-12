// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getUserLogStats } from '@/features/usage-logs/api'
import { formatQuota } from '@/lib/format'
import { getSelf } from '@/lib/api'

import { useOsShellNavigate } from './os-open'
import { OsWidget } from './os-widget'

/**
 * OS 桌面 · 余额小组件（2x1）
 *
 * maintainer 2026-09-12 定的首批组件之一。2x1 = 228×100px，塞得下"标签 + 大余额 + 今日消耗"。
 * 数据源：`/api/user/self`（余额 quota） + 使用日志统计（今日消耗，
 * 与钱包页"本月消费"同一套算法，只是时间窗换成今天 0 点起）。
 * 点击 = 打开钱包窗口。
 *
 * 注意：两个 useQuery 都写在 hooks 顶层（用 `enabled` 控制而不是提前 return），
 * 余额没拿到就整块不渲染 —— 宁可少一个组件，也不要空壳。
 */
export function OsDesktopBalance() {
  const { t } = useTranslation()
  const osNavigate = useOsShellNavigate()

  const { data: selfData } = useQuery({
    queryKey: ['os-widget-self'],
    queryFn: getSelf,
    staleTime: 60000,
  })

  // 今日 0 点（本地时区）起
  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return Math.floor(d.getTime() / 1000)
  }, [])

  const { data: todayQuota } = useQuery({
    queryKey: ['os-widget-today-quota', todayStart],
    queryFn: async () => {
      const res = await getUserLogStats({
        start_timestamp: todayStart,
        end_timestamp: Math.floor(Date.now() / 1000),
      })
      return res.success ? (res.data?.quota ?? 0) : 0
    },
    staleTime: 60000,
  })

  // 取不到数据时照常显示卡片、数值给 —（组件悄悄消失会留下空洞，比 — 难理解得多）
  const user = selfData?.data
  const balance =
    user && typeof user.quota === 'number' ? formatQuota(user.quota) : null

  return (
    <OsWidget size='2x1'>
      <button
        type='button'
        onClick={() => osNavigate('/wallet')}
        // 不用 WIDGET_CLICKABLE_CLASS 的 justify-between：那会把大数字压到卡底（maintainer 2026-09-12
        // "余额往上挪点"）。这里标签行贴顶（与相邻卡的标签同一水平线），数字在剩余空间里居中。
        className='focus-visible:ring-ring/40 flex h-full w-full cursor-pointer flex-col text-left outline-none focus-visible:ring-2'
      >
        <span className='flex w-full items-center justify-between gap-2'>
          <span className='text-muted-foreground text-xs'>{t('Balance')}</span>
          <span className='text-muted-foreground truncate text-xs tabular-nums'>
            {t('Today')}{' '}
            {todayQuota === undefined ? '—' : formatQuota(todayQuota)}
          </span>
        </span>
        <span className='flex min-h-0 flex-1 items-center'>
          <span className='truncate text-2xl leading-none font-semibold tabular-nums'>
            {balance ?? '—'}
          </span>
        </span>
      </button>
    </OsWidget>
  )
}
