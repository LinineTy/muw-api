// @muw-owned
import { useTranslation } from 'react-i18next'

import { formatCompactTimestamp } from '@/features/subscriptions/lib'
import { formatQuotaWithCurrency } from '@/lib/currency'

// 单列限额行：label 左、used/total 右，进度条按使用率阈值变色
// （>=90 红 / >=70 琥珀 / 其余主色），封顶行徽标内联在 label 旁，底部显示重置时间。
export function LimitRow({
  label,
  used,
  total,
  resetAt,
  noReset,
  isCap,
}: {
  label: string
  used: number
  total: number
  resetAt?: number
  noReset?: boolean
  // 封顶窗口：label 已是 "Total cap"，隐藏内联徽标与底部提示，避免重复。
  isCap?: boolean
}) {
  const { t } = useTranslation()
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  let barClass = 'bg-primary'
  if (pct >= 90) {
    barClass = 'bg-destructive'
  } else if (pct >= 70) {
    barClass = 'bg-warning'
  }
  // 换算成显示币种、不带符号/缩写的纯数字（如 1.2 而非 $1.2 或 1.2k）
  const fmtPlain = (v: number) =>
    formatQuotaWithCurrency(v, { abbreviate: false, showSymbol: false })
  const showResetLine = noReset || (!!resetAt && resetAt > 0)
  return (
    <div className='py-2.5'>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='flex min-w-0 items-center gap-1.5 text-sm'>
          <span className='truncate font-semibold'>{label}</span>
          {!isCap && noReset && (
            <span className='bg-primary/10 text-primary shrink-0 rounded px-1 py-px text-[11px] font-bold'>
              {t('Total cap')}
            </span>
          )}
        </span>
        <span className='shrink-0 font-mono text-sm font-medium tabular-nums'>
          {fmtPlain(used)}
          <span className='text-muted-foreground'> / {fmtPlain(total)}</span>
        </span>
      </div>
      <div className='bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full'>
        <div
          className={`${barClass} h-full rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!isCap && showResetLine && (
        <div className='mt-1 text-xs'>
          {noReset ? (
            <span className='text-muted-foreground'>
              {t('No reset within the subscription period')}
            </span>
          ) : (
            <span className='text-muted-foreground'>
              {t('Reset')} {formatCompactTimestamp(resetAt || 0)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
