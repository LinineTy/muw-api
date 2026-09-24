// @muw-owned
import { Check, Loader2, ShieldAlert } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export type SecurityCheckStatus = 'idle' | 'solving' | 'done' | 'failed'

type SecurityCheckWindowProps = {
  open: boolean
  status: SecurityCheckStatus
  /** 勾选后开始校验 */
  onStart: () => void
  /** 校验未通过后重新校验 */
  onRetry: () => void
}

/** 初始位置：让开顶部提示条。 */
const DEFAULT_OFFSET = { top: 72, right: 24 }
const EDGE_MARGIN = 8

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * 校验浮窗：勾选框 + 状态文字，除勾选框外整块可拖动，无遮罩、不锁页面。
 *
 * 必须挂到 document.body：卡片是 transform 元素，fixed 会以它为参照系而被裁切。
 */
export function SecurityCheckWindow({
  open,
  status,
  onStart,
  onRetry,
}: SecurityCheckWindowProps) {
  const { t } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null
  )

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    // 勾选框与重试按钮正常点击，不参与拖动
    if ((event.target as HTMLElement).closest('button')) {
      return
    }
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 不支持指针捕获时仍可拖动，仅指针移出窗口后断开
    }
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current
    const rect = cardRef.current?.getBoundingClientRect()
    if (!drag || !rect) return
    setPosition({
      x: clamp(
        event.clientX - drag.dx,
        EDGE_MARGIN,
        window.innerWidth - rect.width - EDGE_MARGIN
      ),
      y: clamp(
        event.clientY - drag.dy,
        EDGE_MARGIN,
        window.innerHeight - rect.height - EDGE_MARGIN
      ),
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
  const solving = status === 'solving'

  let label = t('Start the check')
  if (solving) {
    label = t('Verifying...')
  } else if (passed) {
    label = t('Verified')
  } else if (failed) {
    label = t('Check failed')
  }

  let mark = null
  if (solving) {
    mark = <Loader2 className='text-primary size-4 animate-spin' />
  } else if (passed) {
    mark = <Check className='text-primary-foreground size-4' />
  } else if (failed) {
    mark = <ShieldAlert className='text-destructive size-4' />
  }

  let boxClass =
    'border-primary/35 bg-primary/5 hover:border-primary/60 hover:bg-primary/10'
  if (passed) {
    boxClass = 'border-primary bg-primary'
  } else if (failed) {
    boxClass = 'border-destructive/40 bg-destructive/10'
  } else if (solving) {
    boxClass = 'border-primary/45 bg-primary/10'
  }

  const windowNode = (
    <div
      ref={cardRef}
      role='dialog'
      aria-label={t('Security check')}
      data-testid='security-check-window'
      style={
        position
          ? { left: position.x, top: position.y }
          : { top: DEFAULT_OFFSET.top, right: DEFAULT_OFFSET.right }
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className='bg-popover text-popover-foreground ring-foreground/10 fixed z-[70] flex min-h-14 w-[190px] cursor-grab touch-none items-center gap-3 rounded-xl px-3.5 py-2.5 shadow-xl ring-1 backdrop-blur-md select-none active:cursor-grabbing'
    >
      <button
        type='button'
        role='checkbox'
        aria-checked={passed}
        aria-label={t('Start the check')}
        data-testid='security-check-start'
        onClick={onStart}
        disabled={solving || passed || failed}
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-lg border transition-all duration-200 disabled:cursor-default',
          boxClass
        )}
      >
        {mark}
      </button>
      <span
        className={cn(
          'min-w-0 text-[13px] leading-5 font-medium',
          failed ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {label}
      </span>
      {failed ? (
        <button
          type='button'
          onClick={onRetry}
          className='text-primary ml-auto shrink-0 text-[12px] font-medium'
        >
          {t('Retry')}
        </button>
      ) : null}
    </div>
  )

  // 非浏览器环境不渲染
  if (typeof document === 'undefined') {
    return null
  }
  return createPortal(windowNode, document.body)
}
