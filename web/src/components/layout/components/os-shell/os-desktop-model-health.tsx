// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getModelHealth } from '@/features/model-health/api'
import { summarizeModelHealth } from '@/features/model-health/lib/summary'

import { useOsShellNavigate } from './os-open'
import { OsWidget, WIDGET_CLICKABLE_CLASS } from './os-widget'

/**
 * OS 桌面 · 模型健康度小组件（1x1）
 *
 * maintainer 2026-09-12 点名的组件。显示**技术口径成功率**（client 错误不进分母、审核拦截计成功），
 * 口径从 `features/model-health/lib/summary.ts` 取 —— 与健康页顶部汇总卡同一份计算，
 * 不让"健康度"在桌面和页面上对不上。
 *
 * 数据源 `/api/channel/health/models`（**UserAuth，任意登录用户可读**，不是管理接口），
 * queryKey 与健康页默认视图一致（['model-health', 1, false]）→ 命中同一份缓存。
 * 点击 = 打开模型健康页。无样本（返回空）时不渲染，避免显示一个假的 100%。
 */
export function OsDesktopModelHealth() {
  const { t } = useTranslation()
  const osNavigate = useOsShellNavigate()

  const { data } = useQuery({
    queryKey: ['model-health', 1, false],
    queryFn: () => getModelHealth({ days: 1 }),
    retry: false,
    staleTime: 60000,
    refetchInterval: 120000,
  })

  const rows = data?.data ?? []
  if (rows.length === 0) return null

  const { successRate } = summarizeModelHealth(rows)
  const value = Math.max(0, Math.min(100, successRate))
  const barClass =
    value >= 99 ? 'bg-primary' : value >= 90 ? 'bg-amber-500' : 'bg-destructive'

  return (
    <OsWidget size='1x1'>
      <button
        type='button'
        onClick={() => osNavigate('/model-health')}
        className={WIDGET_CLICKABLE_CLASS}
      >
        <span className='text-muted-foreground truncate text-[0.6875rem] leading-none'>
          {t('Model Health')}
        </span>
        <span className='text-xl leading-none font-semibold tabular-nums'>
          {Math.round(value)}%
        </span>
        <span className='bg-muted/70 h-1 w-full overflow-hidden rounded-full'>
          <span
            className={`block h-full rounded-full ${barClass}`}
            style={{ width: `${value}%` }}
          />
        </span>
      </button>
    </OsWidget>
  )
}
