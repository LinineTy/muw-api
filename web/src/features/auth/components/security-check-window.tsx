// @muw-owned
import { Check, Loader2, RotateCcw, ShieldAlert } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export type SecurityCheckStatus = 'idle' | 'solving' | 'done' | 'failed'

type SecurityCheckWindowProps = {
  open: boolean
  status: SecurityCheckStatus
  /** 勾选后开始校验。 */
  onStart: () => void
  /** 失败后重新校验。 */
  onRetry: () => void
}

/** 初始位置：让开顶部提示条。 */
const DEFAULT_OFFSET = { top: 72, right: 24 }
const EDGE_MARGIN = 8

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * 校验浮窗：勾选框 + 状态文字，整块可拖动，无遮罩、不锁页面。
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
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    // 勾选框与按钮正常点击，不参与拖动
    if ((event.target as HTMLElement).closest('button,input,label,a')) {
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
    label = t('Security check passed')
  } else if (failed) {
    label = t('Security check failed. Please try again.')
  }

  let indicator = (
    <input
      type='checkbox'
      checked={false}
      onChange={onStart}
      aria-label={t('Start the check')}
      className='accent-primary size-4 shrink-0 cursor-pointer'
    />
  )
  if (solving) {
    indicator = <Loader2 className='text-primary size-4 shrink-0 animate-spin' />
  } else if (passed) {
    indicator = <Check className='size-4 shrink-0 text-emerald-500' />
  } else if (failed) {
    indicator = <ShieldAlert className='text-destructive size-4 shrink-0' />
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
      className='bg-popover text-popover-foreground ring-foreground/10 fixed z-[70] w-[228px] cursor-grab touch-none rounded-xl px-3 py-2.5 shadow-lg ring-1 select-none backdrop-blur-md active:cursor-grabbing'
    >
      <div className='flex items-center gap-2.5'>
        {indicator}
        <span className='text-[13px] leading-5'>{label}</span>
        {failed ? (
          <button
            type='button'
            onClick={onRetry}
            aria-label={t('Retry')}
            className='text-primary ml-auto shrink-0'
          >
            <RotateCcw className='size-4' />
          </button>
        ) : null}
      </div>
    </div>
  )

  // 非浏览器环境不渲染
  if (typeof document === 'undefined') {
    return null
  }
  return createPortal(windowNode, document.body)
}
