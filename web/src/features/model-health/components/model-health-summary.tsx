// @muw-owned
import {
  AlertTriangle,
  Activity,
  Boxes,
  FlaskConical,
  Gauge,
  HeartPulse,
  Network,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { SuccessRateBadge } from './success-rate-badge'

/**
 * 模型健康页顶部汇总:在当前查询范围(天数/搜索/仅不健康)之上展示总体统计
 * —— 模型数 / 通道数 / 测试次数 / 整体成功率 / 平均响应时间 /
 * 异常模型数 / 有真实用户流量的模型数。
 *
 * 平均响应时间只对管理员有意义:非管理员拿到的行里延迟已被抹掉(恒为 0),
 * 加权平均必然算出 0ms,所以直接显示「—」而不是把 0 当成真值。
 */
export type ModelHealthSummaryData = {
  modelCount: number
  channelCount: number
  totalTests: number
  successRate: number
  avgResponseTime: number
  unhealthyModelCount: number
  trafficModelCount: number
  /** 非管理员视角:延迟不可见,汇总里该项显示「—」 */
  hideLatency?: boolean
}

function SummaryItem({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <div className='bg-card rounded-lg border px-3 py-2.5'>
      <div className='flex items-center gap-1.5 text-muted-foreground text-[11px] font-medium'>
        <Icon className='size-3.5 shrink-0' aria-hidden='true' />
        <span className='truncate'>{label}</span>
      </div>
      <div className='mt-1.5'>{children}</div>
    </div>
  )
}

function NumberValue({ value, className }: { value: number | string; className?: string }) {
  return (
    <span
      className={cn(
        'font-mono text-base font-semibold tracking-tight tabular-nums',
        className
      )}
    >
      {value}
    </span>
  )
}

export function ModelHealthSummary({
  modelCount,
  channelCount,
  totalTests,
  successRate,
  avgResponseTime,
  unhealthyModelCount,
  trafficModelCount,
  hideLatency,
}: ModelHealthSummaryData) {
  const { t } = useTranslation()

  return (
    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7'>
      <SummaryItem icon={Boxes} label={t('Models')}>
        <NumberValue value={formatNumber(modelCount)} />
      </SummaryItem>
      <SummaryItem icon={Network} label={t('Channels')}>
        <NumberValue value={formatNumber(channelCount)} />
      </SummaryItem>
      <SummaryItem icon={FlaskConical} label={t('Test count')}>
        <NumberValue value={formatNumber(totalTests)} />
      </SummaryItem>
      <SummaryItem icon={HeartPulse} label={t('Success rate')}>
        <SuccessRateBadge rate={successRate} />
      </SummaryItem>
      <SummaryItem icon={Gauge} label={t('Average latency')}>
        <NumberValue
          value={hideLatency ? '—' : `${Math.round(avgResponseTime)}ms`}
        />
      </SummaryItem>
      <SummaryItem icon={AlertTriangle} label={t('Unhealthy models')}>
        <NumberValue
          className={unhealthyModelCount > 0 ? 'text-destructive' : undefined}
          value={formatNumber(unhealthyModelCount)}
        />
      </SummaryItem>
      <SummaryItem icon={Activity} label={t('User traffic models')}>
        <NumberValue value={formatNumber(trafficModelCount)} />
      </SummaryItem>
    </div>
  )
}
