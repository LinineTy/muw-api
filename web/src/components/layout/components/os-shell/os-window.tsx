// @muw-owned
import { useRef, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useActiveOsNavItem } from './use-os-nav'

/** 拖拽缩放下限/上限(px) */
const MIN_W = 480
const MIN_H = 320

/**
 * OS 窗口容器(画布→窗口):
 * - macOS 式标题栏:左侧三点(红=关闭/绿=最大化,hover 浮现符号)+居中页名
 * - 右下角拖拽把手自由缩放(nwse-resize),默认尺寸自适应居中
 * - 玻璃卡片配方贴合琉璃主题(backdrop-blur + saturate,bg-card)
 * - v1 为形态试验:单激活窗口;内容区透传 @container/content
 *   (页面内 container query 布局依赖此类,不能丢)
 * - 背后两层"影子窗口"右下错位,营造堆叠层次(纯视觉)
 * - 注:黄点(最小化)留待 v2 多窗口时接真语义
 */
export function OsWindow({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose?: () => void
}) {
  const active = useActiveOsNavItem()
  const [maximized, setMaximized] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number; w: number; h: number } | null>(
    null
  )
  const TitleIcon = active?.icon

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (maximized) return
    const rect = e.currentTarget.closest('[data-os-window]')?.getBoundingClientRect()
    if (!rect) return
    dragStart.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current
    if (!s) return
    const w = Math.min(Math.max(s.w + (e.clientX - s.x), MIN_W), window.innerWidth - 120)
    const h = Math.min(Math.max(s.h + (e.clientY - s.y), MIN_H), window.innerHeight - 140)
    setSize({ w, h })
  }
  const onResizeUp = () => {
    dragStart.current = null
  }

  return (
    <div
      data-os-window
      style={size && !maximized ? { width: size.w, height: size.h } : undefined}
      className={cn(
        'relative z-10 flex min-h-0 flex-col transition-[max-width,inset] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        maximized || size
          ? 'h-full w-full'
          : 'h-full w-[min(1160px,calc(100%-10rem))] self-center'
      )}
    >
      {/* 影子窗口 ×2:右下错位露出边缘,营造 macOS 堆叠层次(纯视觉) */}
      <div className='bg-card/45 border-border/40 pointer-events-none absolute inset-0 -z-10 translate-x-3.5 translate-y-3.5 rounded-2xl border shadow-[0_16px_48px_rgba(0,0,0,0.10)] backdrop-blur-sm' />
      <div className='bg-card/30 border-border/30 pointer-events-none absolute inset-0 -z-20 translate-x-7 translate-y-7 rounded-2xl border shadow-[0_16px_48px_rgba(0,0,0,0.08)] backdrop-blur-sm' />

      <div className='bg-card/70 border-border/60 flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.18)] backdrop-blur-[8px] saturate-150'>
        {/* 标题栏:macOS 三色点 + 居中页名 */}
        <div className='border-border/40 flex h-10 shrink-0 items-center gap-2 border-b px-3'>
          <div className='flex items-center gap-1.5'>
            <button
              type='button'
              aria-label='Close window'
              onClick={onClose}
              className='group/red flex size-3 items-center justify-center rounded-full bg-[#ff5f57] shadow-inner transition-transform hover:scale-110'
            >
              <X className='text-[#7d0905] size-2 opacity-0 group-hover/red:opacity-100' aria-hidden='true' />
            </button>
            <span className='flex size-3 items-center justify-center rounded-full bg-[#febc2e] shadow-inner'>
              <Minus className='text-[#7d4a00] size-2 opacity-0' aria-hidden='true' />
            </span>
            <button
              type='button'
              aria-label='Toggle maximize'
              onClick={() => setMaximized((v) => !v)}
              className='group/green flex size-3 items-center justify-center rounded-full bg-[#28c840] shadow-inner transition-transform hover:scale-110'
            >
              <Plus className='text-[#0b5d17] size-2 opacity-0 group-hover/green:opacity-100' aria-hidden='true' />
            </button>
          </div>
          <div className='text-muted-foreground flex min-w-0 flex-1 items-center justify-center gap-1.5 text-sm'>
            {TitleIcon ? (
              <TitleIcon className='size-4 shrink-0' aria-hidden='true' />
            ) : null}
            <span className='truncate'>{active?.title ?? 'muw'}</span>
          </div>
          {/* 右侧留白对称占位(三点宽度) */}
          <div className='w-[3.4rem]' aria-hidden='true' />
        </div>
        {/* 内容区:继承原 SidebarInset 的 container 语义 */}
        <div className='@container/content min-h-0 flex-1 overflow-y-auto overscroll-contain'>
          {children}
        </div>
      </div>

      {/* 右下角缩放把手 */}
      {!maximized ? (
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          className='absolute right-0 bottom-0 z-20 size-4 cursor-nwse-resize touch-none'
          aria-label='Resize window'
          role='presentation'
        >
          <svg viewBox='0 0 16 16' className='text-border size-4' fill='none' aria-hidden='true'>
            <path d='M14 6 L6 14 M14 10 L10 14' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' opacity='0.7' />
          </svg>
        </div>
      ) : null}
    </div>
  )
}
