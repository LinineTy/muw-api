// @muw-owned
import { Search as SearchIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useDirection } from '@/context/direction-provider'
import { useSearch } from '@/context/search-provider'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useOsWindowsStore } from '@/stores/os-windows-store'

import { NavTiles } from './nav-tiles'
import { useOsBallStore } from './os-ball-store'
import { FAB_BALL } from './os-ball-style'
import { matchOsNavItem, useOsNavItems } from './use-os-nav'

/**
 * OS 桌面壳 · 底部 Dock（只有中段这一颗胶囊）：
 *   [ 搜索 | 开始磁贴 | 已打开页面… ]
 * - 左/右两簇已迁到左侧细竖条，见 os-side-strip.tsx（此处不再承载系统工具）
 * - 固定区球体走移动端 FAB 同款配方(bg-popover 玻璃 + blur/saturate,
 *   无容器底色;琉璃主题下透出背景),弹层打开时圆→圆角方(data-state)
 * - 窗口区(macOS 行为):已最小化→恢复置顶;已激活→最小化;
 *   已开未激活→置顶;激活窗图标实心高亮,其余运行小点
 */

function closeNavCard() {
  useOsBallStore.getState().close()
}

/** 搜索球:唯一留在中 Dock 的固定功能 */
function SearchBall() {
  const { setOpen: setSearchOpen } = useSearch()
  const { t } = useTranslation()

  return (
    <button
      type='button'
      aria-label={t('Search')}
      title={t('Search')}
      onClick={() => {
        closeNavCard()
        setSearchOpen(true)
      }}
      className={FAB_BALL}
    >
      <SearchIcon className='size-[1.15rem]' aria-hidden='true' />
    </button>
  )
}

export function OsDock() {
  const items = useOsNavItems()
  const [hovered, setHovered] = useState<string | null>(null)
  const { dir } = useDirection()
  const rtl = dir === 'rtl'
  const {
    windows,
    activeId,
    activateWindow,
    restoreWindow,
    requestMinimizeWindow,
    requestCloseWindow,
  } = useOsWindowsStore()
  const { t } = useTranslation()

  // 批量关闭:逐窗走两段式(各窗组件自带 240ms 兜底 timer),动画同播
  const closeOthers = (id: string) => {
    windows.forEach((w) => {
      if (w.id !== id) requestCloseWindow(w.id)
    })
  }
  const closeAll = () => {
    windows.forEach((w) => requestCloseWindow(w.id))
  }

  const DOT_CLS = {
    active: 'bg-foreground size-1.5',
    minimized: 'bg-muted-foreground/40 size-1',
    running: 'bg-muted-foreground/70 size-1',
  } as const

  const onDockClick = (id: string) => {
    const win = windows.find((w) => w.id === id)
    if (!win) return
    if (win.minimized) {
      restoreWindow(win.id)
      return
    }
    if (win.id === activeId) {
      requestMinimizeWindow(win.id)
      return
    }
    activateWindow(win.id)
  }

  return (
    // 外层只负责"把固定区钉在视口中心":窗口区是它的绝对定位子元素,
    // 所以窗口增减时**固定区不会跟着漂**(合并成一颗时会有这个问题)
    <div className='fixed bottom-3 left-1/2 z-[70] -translate-x-1/2'>
      <nav
        aria-label='Dock'
        className='bg-popover/70 border-border/60 flex items-end gap-1 rounded-2xl border px-2 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] saturate-150 backdrop-blur-[8px]'
      >
        <SearchBall />

        {/* 开始磁贴(原左下导航球,面板从 Dock 上方居中弹出) */}
        <NavTiles />
      </nav>

      {windows.length > 0 ? (
        <nav
          aria-label='Dock Windows'
          className={cn(
            'bg-popover/70 border-border/60 absolute bottom-0 flex items-end gap-1 rounded-2xl border px-2 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] saturate-150 backdrop-blur-[8px]',
            rtl ? 'right-full mr-1.5' : 'left-full ml-1.5'
          )}
        >
          {windows.map((win) => {
            const nav = matchOsNavItem(items, win.url)
            const Icon = nav?.icon
            const activeHere = win.id === activeId && !win.minimized
            // 运行状态点:查表消除嵌套三元
            let dotKey: keyof typeof DOT_CLS = 'running'
            if (win.minimized) dotKey = 'minimized'
            else if (activeHere) dotKey = 'active'
            return (
              <ContextMenu key={win.id}>
                <ContextMenuTrigger
                  render={
                    <button
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
                      {Icon ? (
                        <Icon className='size-[1.15rem]' aria-hidden='true' />
                      ) : null}
                      <span
                        className={cn(
                          'absolute bottom-0.5 rounded-full transition-all',
                          DOT_CLS[dotKey]
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
                            className='bg-popover border-border/60 text-foreground pointer-events-none absolute -top-9 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-md backdrop-blur'
                          >
                            {win.title}
                          </motion.span>
                        ) : null}
                      </AnimatePresence>
                    </button>
                  }
                />
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => requestCloseWindow(win.id)}>
                    {t('Close window')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => closeOthers(win.id)}>
                    {t('Close other windows')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={closeAll}>
                    {t('Close all windows')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
