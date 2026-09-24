// @muw-owned
import { Check, GripVertical, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { AUTH_PRIMARY_BUTTON, AUTH_SECONDARY_BUTTON } from '../../lib/auth-styles'
import { estimatePowProgress } from '../lib/activation-pow'
import type { ActivationPowStatus } from '../lib/use-activation-pow'

type ActivationVerifyWindowProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ActivationPowStatus
  hashes: number
  bits: number
  onRetry: () => void
}

const RING_SIZE = 76
const RING_STROKE = 6
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** 初始位置：让开顶部提示条。 */
const DEFAULT_OFFSET = { top: 72, right: 24 }
const EDGE_MARGIN = 8

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * 人机校验浮窗：右上角的小窗，无遮罩、不锁页面，可拖动，通过后自动收起。
 *
 * 必须挂到 document.body：卡片是 transform 元素，fixed 会以它为参照系而被裁切。
 */
export function ActivationVerifyWindow({
  open,
  onOpenChange,
  status,
  hashes,
  bits,
  onRetry,
}: ActivationVerifyWindowProps) {
  const { t } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  // null = 还没拖过，用默认的右上角定位（窗口尺寸变化时自动跟随）
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    // 不支持指针捕获时仍可拖动，仅指针移出窗口后会断开
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 忽略
    }
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current
    const rect = cardRef.current?.getBoundingClientRect()
    if (!drag || !rect) return
    setPosition({
      x: clamp(event.clientX - drag.dx, EDGE_MARGIN, window.innerWidth - rect.width - EDGE_MARGIN),
      y: clamp(event.clientY - drag.dy, EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN),
    })
  }, [])

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  if (!open) {
    return null
  }

  const passed = status === 'done'
  const failed = status === 'failed'
  const progress = passed ? 1 : estimatePowProgress(hashes, bits)
  const offset = RING_CIRCUMFERENCE * (1 - progress)

  let icon = <ShieldCheck className='size-6' />
  if (passed) {
    icon = <Check className='size-6' />
  } else if (failed) {
    icon = <ShieldAlert className='text-destructive size-6' />
  }

  let statusText = t('Computing hashes: {{count}}', {
    count: hashes.toLocaleString(),
  })
  if (passed) {
    statusText = t('Security check passed')
  } else if (failed) {
    statusText = t('Security check failed. Please try again.')
  }

  const windowNode = (
    <div
      ref={cardRef}
      role='dialog'
      aria-label={t('Security check')}
      data-testid='activation-verify-window'
      style={
        position
          ? { left: position.x, top: position.y }
          : { top: DEFAULT_OFFSET.top, right: DEFAULT_OFFSET.right }
      }
      // 与下拉、选择器等浮层一致的底色。
      className='bg-popover text-popover-foreground ring-foreground/10 fixed z-[70] w-[290px] rounded-2xl shadow-lg ring-1 backdrop-blur-md'
    >
      {/* 标题栏即拖拽把手（pointer 事件，鼠标与触摸通用） */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className='flex touch-none items-center gap-2 px-3 pt-3 pb-1 select-none'
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
      >
        <GripVertical className='text-muted-foreground size-4 shrink-0' />
        <span className='text-foreground flex-1 text-[13px] font-medium'>
          {t('Security check')}
        </span>
        <button
          type='button'
          onClick={() => onOpenChange(false)}
          aria-label={t('Close')}
          data-testid='activation-verify-close'
          className='text-muted-foreground hover:text-foreground -mr-1 grid size-6 shrink-0 place-items-center rounded-lg transition-colors'
        >
          <X className='size-4' />
        </button>
      </div>

      <div className='flex items-center gap-3 px-3 pt-1 pb-3'>
        <div className='relative grid shrink-0 place-items-center'>
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
          className='text-muted-foreground text-[12.5px] leading-5'
        >
          {passed || failed
            ? statusText
            : t('Running a quick security check to confirm you are not a bot.')}
          {!passed && !failed ? (
            <span className='text-foreground/70 mt-1 block tabular-nums'>
              {statusText}
            </span>
          ) : null}
        </p>
      </div>

      {failed ? (
        <div className='flex gap-2 px-3 pb-3'>
          <Button
            type='button'
            className={cn(AUTH_PRIMARY_BUTTON, 'h-9 flex-1')}
            onClick={onRetry}
          >
            {t('Retry')}
          </Button>
          <Button
            type='button'
            variant='outline'
            className={cn(AUTH_SECONDARY_BUTTON, 'h-9 w-auto shrink-0 px-3')}
            onClick={() => onOpenChange(false)}
          >
            {t('Close')}
          </Button>
        </div>
      ) : null}
    </div>
  )

  // 非浏览器环境不渲染
  if (typeof document === 'undefined') {
    return null
  }
  return createPortal(windowNode, document.body)
}
