// @muw-owned
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { textColorMap } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { clampPage, pageCount } from '../lib/layout'
import { successRateVariant } from '../lib/success-rate-tier'
import { usePerPage } from '../lib/use-per-page'
import type { ModelHealthRow, TestTrendPoint } from '../types'
import { ChannelDetailDialog } from './channel-detail-dialog'
import { ChannelHealthTile } from './channel-health-tile'
import { HealthBlocks } from './health-blocks'

// mergeTrend combines every channel's probe history of a model into one
// chronological strip (oldest → newest). The compact model-level heartbeat
// renders as many newest blocks as fit the container width, so no hard cap here.
function mergeTrend(rows: ModelHealthRow[]): TestTrendPoint[] {
  const points: TestTrendPoint[] = []
  for (const row of rows) {
    for (const point of row.trend) points.push(point)
  }
  points.sort(
    (a, b) => a.created_at - b.created_at || a.response_time - b.response_time
  )
  return points
}

/**
 * 模型卡：首行 = 模型名 +「‹ n/N ›」翻页 + T / R /
 * 模型级成功率的三合一胶囊；第二行 = 合并条带；下面 = 渠道瓷砖**一行**。
 *
 * 瓷砖永远只占一行：每页张数按卡片实际宽度算（`lib/layout.ts`），本页列数 = 本页
 * 实际张数，所以每页都铺满，不会出现"孤零零一张 + 大片空白"；放不下的翻页看。
 */
export function ModelHealthCard({
  modelName,
  rows,
}: {
  modelName: string
  rows: ModelHealthRow[]
}) {
  const { t } = useTranslation()
  const userRole = useAuthStore((s) => s.auth.user?.role)
  const isAdmin = Boolean(userRole && userRole >= ROLE.ADMIN)
  const [detailRow, setDetailRow] = useState<ModelHealthRow | null>(null)
  const [page, setPage] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const perPage = usePerPage(gridRef)

  const pages = pageCount(rows.length, perPage)
  const current = clampPage(page, pages)
  // 本页实际张数 = 本页列数：最后一页不足满页时也铺满整行
  const visible = rows.slice(current * perPage, current * perPage + perPage)
  // 单张瓷砖不独占整行：按 2 列的宽度放置（模型只有 1 个渠道时左侧半宽、右侧留白），
  // 窄卡（手机，每页 1 张）例外，仍然占满整行。
  const columns = Math.min(perPage, Math.max(2, visible.length))

  // Memoized so the strip doesn't get a fresh array on every re-render — a stable
  // reference keeps HealthBlocks' measurements in sync instead of churning its
  // observer (which used to leave the strip sized for a wider container).
  const trend = useMemo(() => mergeTrend(rows), [rows])

  const totalTests = rows.reduce((sum, row) => sum + row.test_count, 0)
  const totalUserTraffic = rows.reduce(
    (sum, row) => sum + (row.user_traffic_count ?? 0),
    0
  )
  const totalSuccess = rows.reduce((sum, row) => sum + row.success_count, 0)
  const overallRate = totalTests > 0 ? (totalSuccess / totalTests) * 100 : 0
  // 模型级成功率用技术口径（剔除 client 错误、审核拦截计成功），与渠道瓷砖同口径；
  // rows 来自后端聚合，这里只做加权合并。
  const totalClientErrors = rows.reduce(
    (sum, row) => sum + (row.client_error_count ?? 0),
    0
  )
  const totalModeration = rows.reduce(
    (sum, row) => sum + (row.moderation_count ?? 0),
    0
  )
  const denom = totalTests - totalClientErrors
  const technicalRate = denom > 0 ? ((totalSuccess + totalModeration) / denom) * 100 : 100
  const rateVariant = successRateVariant(technicalRate)

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <div className='flex items-center gap-2 px-3 pt-2 sm:px-4'>
        <span className='min-w-0 flex-1 truncate font-mono text-sm font-medium'>
          {modelName}
        </span>

        {pages > 1 ? (
          <div className='flex shrink-0 items-center gap-0.5'>
            <Button
              variant='ghost'
              size='sm'
              className='size-5 p-0'
              disabled={current <= 0}
              aria-label={t('Previous')}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft className='size-3.5' />
            </Button>
            {/* 固定宽度 + 居中 + leading-none：跟两侧箭头严格对齐 */}
            <span className='text-muted-foreground w-7 text-center font-mono text-[10.5px] leading-none tabular-nums'>
              {current + 1}/{pages}
            </span>
            <Button
              variant='ghost'
              size='sm'
              className='size-5 p-0'
              disabled={current >= pages - 1}
              aria-label={t('Next')}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight className='size-3.5' />
            </Button>
          </div>
        ) : null}

        {/* T / R / 成功率 三合一胶囊（成功率只留分档颜色，不带底） */}
        <span className='bg-muted flex shrink-0 items-baseline gap-2.5 rounded-full px-2.5 py-0.5'>
          <span
            className='text-muted-foreground flex items-baseline gap-[3px] text-[10.5px]'
            title={t('Test count')}
          >
            T
            <b className='text-foreground font-mono text-xs font-semibold tabular-nums'>
              {formatNumber(totalTests)}
            </b>
          </span>
          {totalUserTraffic > 0 ? (
            <span
              className='text-muted-foreground flex items-baseline gap-[3px] text-[10.5px]'
              title={t('Real user traffic')}
            >
              R
              <b className='text-foreground font-mono text-xs font-semibold tabular-nums'>
                {formatNumber(totalUserTraffic)}
              </b>
            </span>
          ) : null}
          <span
            className={cn(
              'font-mono text-[13px] font-semibold tabular-nums',
              textColorMap[rateVariant]
            )}
            title={t('Success rate')}
          >
            {technicalRate.toFixed(1)}%
          </span>
          {/* 原始口径与技术口径不一致时，鼠标悬停即可对照 */}
          {Math.abs(overallRate - technicalRate) >= 0.05 ? (
            <span className='sr-only'>
              {t('Raw success rate')}: {overallRate.toFixed(1)}%
            </span>
          ) : null}
        </span>
      </div>

      <div className='flex items-center gap-2 px-3 pb-1.5 sm:px-4'>
        <HealthBlocks trend={trend} hideLatency={!isAdmin} />
      </div>

      <div
        ref={gridRef}
        className='bg-muted/40 grid gap-1.5 border-t p-3'
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {visible.map((row) => (
          <ChannelHealthTile
            key={row.channel_id}
            row={row}
            isAdmin={isAdmin}
            onOpenDetail={setDetailRow}
          />
        ))}
      </div>

      <ChannelDetailDialog row={detailRow} onClose={() => setDetailRow(null)} />
    </Card>
  )
}
