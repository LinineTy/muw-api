// @muw-owned
import { useRef } from 'react'
import { Minus, Plus, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  useOsWindowsStore,
  type OsWindowState,
} from '@/stores/os-windows-store'

/** 拖拽/缩放下限(px) */
const MIN_W = 480
const MIN_H = 320

type DragState =
  | { mode: 'move'; dx: number; dy: number }
  | { mode: 'resize'; sx: number; sy: number; w: number; h: number }
  | null

/**
 * OS 受控窗口(多窗口版):
 * - macOS 三色点全语义:红=关闭(销毁) 黄=最小化(藏到Dock,iframe保活) 绿=最大化
 * - 标题栏拖动移动,右下把手缩放;非激活窗口点击任意处置顶
 * - 内容=同源 iframe:保活完美(切窗/最小化状态全保留),关闭即销毁
 * - iframe 内 AuthenticatedLayout 检测 self!==top 退化为纯内容模式(无壳)
 * - 最小化窗口 display:none 常驻 DOM,保 iframe 会话
 */
export function OsWindowFrame({
  win,
  active,
  icon: TitleIcon,
}: {
  win: OsWindowState
  active: boolean
  icon?: React.ElementType
}) {
  const drag = useRef<DragState>(null)
  const { closeWindow, minimizeWindow, activateWindow, toggleMaximize, moveWindow, resizeWindow } =
    useOsWindowsStore()

  const onTitleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (win.maximized) return
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { mode: 'move', dx: e.clientX - win.x, dy: e.clientY - win.y }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 个别环境对合成/异常 pointerId 会 throw;drag 状态已就绪,仅失去强制捕获 */
    }
  }
  const onTitleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d?.mode !== 'move') return
    const x = Math.min(
      Math.max(e.clientX - d.dx, -40),
      window.innerWidth - MIN_W + 40
    )
    const y = Math.min(Math.max(e.clientY - d.dy, 0), window.innerHeight - 80)
    moveWindow(win.id, x, y)
  }
  const onTitleUp = () => {
    drag.current = null
  }

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (win.maximized) return
    drag.current = { mode: 'resize', sx: e.clientX, sy: e.clientY, w: win.w, h: win.h }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 同 onTitleDown */
    }
  }
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d?.mode !== 'resize' || d.w == null || d.h == null) return
    const w = Math.min(Math.max(d.w + (e.clientX - d.sx), MIN_W), window.innerWidth - 120)
    const h = Math.min(Math.max(d.h + (e.clientY - d.sy), MIN_H), window.innerHeight - 140)
    resizeWindow(win.id, w, h)
  }
  const onResizeUp = () => {
    drag.current = null
  }

  const style: React.CSSProperties = win.maximized
    ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: win.zIndex }
    : { left: win.x, top: win.y, width: win.w ?? undefined, height: win.h ?? undefined, zIndex: win.zIndex }

  // 最小化保活:DOM 结构保持不变,仅 display:none——若走条件渲染换结构,
  // React 会卸载重建 iframe,导致每次最小化/恢复整页重载(请求风暴 429)
  if (win.minimized) style.display = 'none'

  return (
    <div
      data-os-window={win.id}
      style={style}
      onPointerDown={() => !active && activateWindow(win.id)}
      className={cn(
        // 暗色 bg-black/70:琉璃暗色 token 自带 ~40% 透明度太透,亮壁纸直透;
        // 纯黑玻璃+blur 头身一体且白字可读(macOS 暗色材质思路)
        'bg-card/70 dark:bg-black/70 border-border/60 absolute flex flex-col overflow-hidden rounded-2xl border backdrop-blur-[8px] saturate-150',
        active
          ? 'shadow-[0_24px_80px_rgba(0,0,0,0.22)]'
          : 'shadow-[0_12px_40px_rgba(0,0,0,0.12)] opacity-95'
      )}
    >
      {/* 标题栏:三色点 + 居中页名,可拖动 */}
      <div
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onPointerCancel={onTitleUp}
        className={cn(
          'border-border/40 flex h-10 shrink-0 items-center gap-2 border-b px-3',
          !win.maximized && 'cursor-grab active:cursor-grabbing'
        )}
      >
        <div className='flex items-center gap-1.5'>
          <button
            type='button'
            aria-label='Close window'
            onClick={() => closeWindow(win.id)}
            className='group/red flex size-3 items-center justify-center rounded-full bg-[#ff5f57] shadow-inner transition-transform hover:scale-110'
          >
            <X className='text-[#7d0905] size-2 opacity-0 group-hover/red:opacity-100' aria-hidden='true' />
          </button>
          <button
            type='button'
            aria-label='Minimize window'
            onClick={() => minimizeWindow(win.id)}
            className='group/yellow flex size-3 items-center justify-center rounded-full bg-[#febc2e] shadow-inner transition-transform hover:scale-110'
          >
            <Minus className='text-[#7d4a00] size-2 opacity-0 group-hover/yellow:opacity-100' aria-hidden='true' />
          </button>
          <button
            type='button'
            aria-label='Toggle maximize'
            onClick={() => toggleMaximize(win.id)}
            className='group/green flex size-3 items-center justify-center rounded-full bg-[#28c840] shadow-inner transition-transform hover:scale-110'
          >
            <Plus className='text-[#0b5d17] size-2 opacity-0 group-hover/green:opacity-100' aria-hidden='true' />
          </button>
        </div>
        <div className='text-muted-foreground pointer-events-none flex min-w-0 flex-1 items-center justify-center gap-1.5 text-sm'>
          {TitleIcon ? (
            <TitleIcon className='size-4 shrink-0' aria-hidden='true' />
          ) : null}
          <span className='truncate'>{win.title}</span>
        </div>
        {/* 右侧留白对称占位(三点宽度) */}
        <div className='w-[3.4rem]' aria-hidden='true' />
      </div>

      {/* 内容:同源 iframe(self!==top 时子应用渲染纯内容)
          lazy=恢复后未唤起的窗,挂 about:blank 占位,唤起才真加载 */}
      <iframe
        src={win.lazy ? 'about:blank' : win.url}
        data-os-window-id={win.id}
        title={win.title}
        className='min-h-0 flex-1 border-0 bg-transparent'
      />

      {/* 右下角缩放把手 */}
      {!win.maximized ? (
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          className='absolute right-0 bottom-0 z-20 size-4 cursor-nwse-resize touch-none'
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
