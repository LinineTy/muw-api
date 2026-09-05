// @muw-owned
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { cn } from '@/lib/utils'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'
import { useOsWindowsStore } from '@/stores/os-windows-store'
import { matchOsNavItem, useOsNavItems } from './use-os-nav'

/**
 * OS 桌面壳 · 底部任务栏(Dock):
 * - 只显示已开启的窗口(按开窗顺序),不预置固定入口;关闭即从 Dock 消失
 *   ——开新窗口走左下导航球,Dock 就是任务栏
 * - macOS 行为:已最小化→恢复置顶;已激活→最小化;已开未激活→置顶
 * - 激活窗图标实心高亮,其余运行小点
 */
export function OsDock() {
  const items = useOsNavItems()
  const [hovered, setHovered] = useState<string | null>(null)
  const { windows, activeId, activateWindow, restoreWindow, minimizeWindow } =
    useOsWindowsStore()

  if (windows.length === 0) return null

  const onDockClick = (id: string) => {
    const win = windows.find((w) => w.id === id)
    if (!win) return
    if (win.minimized) {
      restoreWindow(win.id)
      return
    }
    if (win.id === activeId) {
      minimizeWindow(win.id)
      return
    }
    activateWindow(win.id)
  }

  return (
    <nav
      aria-label='Dock'
      className='bg-popover/70 border-border/60 fixed bottom-3 left-1/2 z-[70] flex -translate-x-1/2 items-end gap-1 rounded-2xl border px-2 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] backdrop-blur-[8px] saturate-150'
    >
      {windows.map((win) => {
        const nav = matchOsNavItem(items, win.url)
        const Icon = nav?.icon
        const activeHere = win.id === activeId && !win.minimized
        return (
          <button
            key={win.id}
            type='button'
            aria-label={win.title}
            title={win.title}
            onClick={() => onDockClick(win.id)}
            onMouseEnter={() => setHovered(win.id)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              'text-muted-foreground hover:text-foreground relative flex size-10 items-center justify-center rounded-xl pb-0.5 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1.5 hover:bg-accent',
              activeHere && 'text-foreground'
            )}
          >
            {Icon ? <Icon className='size-[1.15rem]' aria-hidden='true' /> : null}
            <span
              className={cn(
                'absolute bottom-0.5 rounded-full transition-all',
                activeHere
                  ? 'bg-foreground size-1.5'
                  : win.minimized
                    ? 'bg-muted-foreground/40 size-1'
                    : 'bg-muted-foreground/70 size-1'
              )}
            />
            <AnimatePresence>
              {hovered === win.id ? (
                <motion.span
                  initial='hidden'
                  animate='visible'
                  exit='hidden'
                  variants={MOTION_VARIANTS}
                  transition={MOTION_TRANSITION}
                  className='bg-popover border-border/60 text-foreground pointer-events-none absolute -top-9 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md backdrop-blur'
                >
                  {win.title}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </button>
        )
      })}
    </nav>
  )
}
