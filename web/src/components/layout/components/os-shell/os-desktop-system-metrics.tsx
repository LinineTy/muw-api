// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { listSystemInstances } from '@/features/system-info/api'
import type { SystemInstance } from '@/features/system-info/types'
import { useIsAdmin } from '@/hooks/use-admin'

import { useOsShellNavigate } from './os-open'
import { OsWidget, WIDGET_CLICKABLE_CLASS } from './os-widget'

/**
 * OS 桌面 · 系统信息小组件（**两个 1x1**，摆在组件区最上面）
 *
 * maintainer 2026-09-12 定的形态："2 个 1x1，最上面"。1x1 只有 112×100px，
 * 一个格子塞得下一个"百分比 + 标签 + 细进度条"，所以拆成 CPU / 内存两张。
 *
 * 数据源：`/api/system-info/instances`（节点自报的资源占用，见 features/system-info）。
 * 取值优先级：主节点（role.is_master）→ 第一个在线节点 → 第一个节点。
 * **仅管理员可见**：该接口本身是管理工作台的东西，普通用户看到只会困惑（maintainer的分工原则：
 * 管理员视角和用户视角分开）。
 * 点击 = 打开"系统信息"窗口（与磁贴一致的开窗行为）。
 */
function pickHostInstance(instances: SystemInstance[]): SystemInstance | null {
  if (instances.length === 0) return null
  return (
    instances.find(
      (item) => item.info?.role?.is_master && item.status === 'online'
    ) ??
    instances.find((item) => item.status === 'online') ??
    instances[0]
  )
}

/** 阈值配色：>=90 红、>=75 琥珀、其余主色（一眼看出紧张程度） */
function barClass(percent: number) {
  if (percent >= 90) return 'bg-destructive'
  if (percent >= 75) return 'bg-amber-500'
  return 'bg-primary'
}

function MetricWidget(props: {
  label: string
  percent: number | undefined
  onOpen: () => void
}) {
  const { label, percent, onOpen } = props
  // 没上报该指标就不渲染这一格：宁可少一个组件，也不要一个空壳
  if (percent === undefined) return null
  const clamped = Math.max(0, Math.min(100, percent))

  return (
    <OsWidget size='1x1'>
      <button type='button' onClick={onOpen} className={WIDGET_CLICKABLE_CLASS}>
        <span className='text-muted-foreground text-[0.6875rem] leading-none'>
          {label}
        </span>
        <span className='text-xl leading-none font-semibold tabular-nums'>
          {Math.round(clamped)}%
        </span>
        <span className='bg-muted/70 h-1 w-full overflow-hidden rounded-full'>
          <span
            className={`block h-full rounded-full ${barClass(clamped)}`}
            style={{ width: `${clamped}%` }}
          />
        </span>
      </button>
    </OsWidget>
  )
}

export function OsDesktopSystemMetrics() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const osNavigate = useOsShellNavigate()

  const { data } = useQuery({
    queryKey: ['os-widget-system-instances'],
    queryFn: listSystemInstances,
    // 非管理员不请求：少一次无用的 403
    enabled: isAdmin,
    staleTime: 15000,
    refetchInterval: 30000,
  })

  if (!isAdmin) return null
  const host = pickHostInstance(data?.data ?? [])
  const cpu = host?.info?.resources?.cpu?.usage_percent
  const memory = host?.info?.resources?.memory?.usage_percent
  if (cpu === undefined && memory === undefined) return null

  const open = () => osNavigate('/system-info')

  return (
    <>
      <MetricWidget label={t('CPU')} percent={cpu} onOpen={open} />
      <MetricWidget label={t('Memory')} percent={memory} onOpen={open} />
    </>
  )
}
