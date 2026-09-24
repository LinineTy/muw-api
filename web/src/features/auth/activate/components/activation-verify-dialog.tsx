// @muw-owned
import { Check, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { AUTH_PRIMARY_BUTTON, AUTH_SECONDARY_BUTTON } from '../../lib/auth-styles'
import { estimatePowProgress } from '../lib/activation-pow'
import type { ActivationPowStatus } from '../lib/use-activation-pow'

type ActivationVerifyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ActivationPowStatus
  hashes: number
  bits: number
  onRetry: () => void
}

const RING_SIZE = 88
const RING_STROKE = 7
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * 人机校验浮窗（激活页）：不遮挡整页（背景仍可见可关），过了自动关闭，也可手动关掉。
 * 纯展示组件：状态由 useActivationPow 提供，重试由调用方处理。
 */
export function ActivationVerifyDialog({
  open,
  onOpenChange,
  status,
  hashes,
  bits,
  onRetry,
}: ActivationVerifyDialogProps) {
  const { t } = useTranslation()
  const passed = status === 'done'
  const failed = status === 'failed'
  const progress = passed ? 1 : estimatePowProgress(hashes, bits)
  const offset = RING_CIRCUMFERENCE * (1 - progress)

  let icon = <ShieldCheck className='size-7' />
  if (passed) {
    icon = <Check className='size-7' />
  } else if (failed) {
    icon = <ShieldAlert className='text-destructive size-7' />
  }

  let statusText = t('Computing hashes: {{count}}', {
    count: hashes.toLocaleString(),
  })
  if (passed) {
    statusText = t('Security check passed')
  } else if (failed) {
    statusText = t('Security check failed. Please try again.')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Security check')}
      description={t(
        'Running a quick security check to confirm you are not a bot.'
      )}
      showCloseButton
      contentClassName='sm:max-w-[380px]'
      bodyClassName='flex flex-col items-center gap-4 py-2'
    >
      <div className='relative grid place-items-center'>
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          className={cn('-rotate-90', failed && 'opacity-40')}
          aria-hidden='true'
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill='none'
            strokeWidth={RING_STROKE}
            className='stroke-border'
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill='none'
            strokeWidth={RING_STROKE}
            strokeLinecap='round'
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={offset}
            className={cn(
              'transition-[stroke-dashoffset] duration-200 ease-out motion-reduce:transition-none',
              failed ? 'stroke-destructive' : 'stroke-primary'
            )}
          />
        </svg>
        <span
          className={cn(
            'absolute grid place-items-center',
            passed ? 'text-emerald-500' : 'text-primary'
          )}
        >
          {icon}
        </span>
      </div>

      <p
        role='status'
        aria-live='polite'
        className='text-muted-foreground text-center text-[13px] leading-5'
      >
        {statusText}
      </p>

      {failed ? (
        <div className='flex w-full flex-col gap-2'>
          <Button type='button' className={AUTH_PRIMARY_BUTTON} onClick={onRetry}>
            {t('Retry')}
          </Button>
          <Button
            type='button'
            variant='outline'
            className={AUTH_SECONDARY_BUTTON}
            onClick={() => onOpenChange(false)}
          >
            {t('Close')}
          </Button>
        </div>
      ) : null}
    </Dialog>
  )
}
