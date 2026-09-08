// @muw-owned
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { successRateVariant } from '../lib/success-rate-tier'

export function SuccessRateBadge({
  rate,
  rawRate,
  className,
}: {
  /** 技术成功率:(成功+审核拦截)/(总数-client错误),由后端聚合 */
  rate: number
  /** 原始成功率(成功/总数)。与技术口径不同时 hover 展示,口径透明 */
  rawRate?: number
  className?: string
}) {
  const { t } = useTranslation()
  const badge = (
    <StatusBadge
      label={`${rate.toFixed(1)}%`}
      variant={successRateVariant(rate)}
      size='sm'
      copyable={false}
      className={className}
    />
  )
  if (rawRate === undefined || Math.abs(rawRate - rate) < 0.05) {
    return badge
  }
  return (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipContent side='top' className='max-w-xs'>
        <p className='text-xs'>
          {t('Technical success rate')}: {rate.toFixed(1)}%
        </p>
        <p className='text-muted-foreground text-xs'>
          {t('Raw success rate')}: {rawRate.toFixed(1)}%
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
