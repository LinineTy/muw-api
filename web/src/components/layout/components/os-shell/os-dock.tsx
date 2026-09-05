// @muw-owned
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { cn } from '@/lib/utils'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'
import { useOsWindowsStore } from '@/stores/os-windows-store'
import { useOsNavItems } from './use-os-nav'

/** Dock 最多展示的入口数 */
const DOCK_MAX = 9

/**
 * OS 桌面壳 · 底部悬浮任务栏(Dock):
 * - 玻璃胶囊悬浮底部居中,入口图标取自侧栏导航数据(权限/i18n 继承)
 * - macOS Dock 行为:未开→开新窗;已开未激活→置顶;已激活→最小化;
 *   已最小化→恢复置顶
 * - 运行中(已开窗)的入口图标下显示运行小点,激活窗实心高亮
 */
export function OsDock() {
  const items = useOsNavItems()
  const [hovered, setHovered] = useState<string | null>(null)
  const { windows, activeId, openWindow, activateWindow, restoreWindow, minimizeWindow } =
    useOsWindowsStore()
  const dockItems = items.slice(0, DOCK_MAX)

  const onDockClick = (url: string) => {
    const win = windows.find((w) => w.url === url)
    if (!win) {
      const nav = items.find((i) => i.url === url)
      openWindow({ url, title: nav?.title ?? url })
      return
    }
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
      {dockItems.map((item) => {
        const Icon = item.icon
        const win = windows.find((w) => w.url === item.url)
        const running = Boolean(win)
        const activeHere = Boolean(win && win.id === activeId && !win.minimized)
        return (
          <button
            key={item.url}
            type='button'
            aria-label={item.title}
            title={item.title}
            onClick={() => onDockClick(item.url)}
            onMouseEnter={() => setHovered(item.url)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              'text-muted-foreground hover:text-foreground relative flex size-10 items-center justify-center rounded-xl pb-0.5 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1.5 hover:bg-accent',
              activeHere && 'text-foreground'
            )}
          >
            {Icon ? <Icon className='size-[1.15rem]' aria-hidden='true' /> : null}
            {running ? (
              <span
                className={cn(
                  'absolute bottom-0.5 rounded-full transition-all',
                  activeHere
                    ? 'bg-foreground size-1.5'
                    : 'bg-muted-foreground/70 size-1'
                )}
              />
            ) : null}
            <AnimatePresence>
              {hovered === item.url ? (
                <motion.span
                  initial='hidden'
                  animate='visible'
                  exit='hidden'
                  variants={MOTION_VARIANTS}
                  transition={MOTION_TRANSITION}
                  className='bg-popover border-border/60 text-foreground pointer-events-none absolute -top-9 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md backdrop-blur'
                >
                  {item.title}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </button>
        )
      })}
    </nav>
  )
}
