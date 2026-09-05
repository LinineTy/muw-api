// @muw-owned
import { AnimatePresence, motion } from 'motion/react'
import { LayoutGrid, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useOsNavGroups } from './use-os-nav'
import { useOsShellNavigate } from './os-open'
import { useOsBallStore } from './os-ball-store'
import { FAB_BALL } from './os-ball-style'

/**
 * OS 桌面壳 · 磁贴开始面板(原左下导航球迁入 Dock):
 * - 入口按钮在 Dock 固定功能区(Win11 开始按钮位),点击向上弹出磁贴卡
 * - 菜单数据复用 useOsNavGroups(侧栏同源,权限/i18n/分组小标题继承)
 * - 点击磁贴=开窗(已开则置顶);设置页例外(走主层完整布局,不进窗口)
 * - z-[90] 全场最高:开始面板必须盖住一切窗口(≤45)与 Radix 弹卡(80),
 *   否则被窗口挡住就失去存在意义(maintainer拍板)
 * - 面板锚 Dock 上方居中:bottom-4.5rem + motion x:'-50%'(tailwind translate
 *   会被 motion 的 transform 覆盖,居中必须交给 motion 自己)
 */
export function NavTiles() {
  const groups = useOsNavGroups()
  const osNavigate = useOsShellNavigate()
  const open = useOsBallStore((s) => s.active)
  const { toggle, close } = useOsBallStore()

  return (
    <>
      <button
        type='button'
        aria-label='Open navigation'
        aria-expanded={open}
        title='Start'
        onClick={() => toggle()}
        className={cn(
          FAB_BALL,
          open ? 'rounded-lg' : 'rounded-full'
        )}
      >
        {open ? (
          <X className='size-[1.15rem]' aria-hidden='true' />
        ) : (
          <LayoutGrid className='size-[1.15rem]' aria-hidden='true' />
        )}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <div
              className='fixed inset-0 z-[89]'
              onClick={() => close()}
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.96, x: '-50%' }}
              animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
              exit={{ opacity: 0, y: 10, scale: 0.96, x: '-50%' }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              data-os-ball-card='nav'
              className='bg-sidebar/80 border-border/70 fixed bottom-[4.25rem] left-1/2 z-[90] flex max-h-[calc(100svh-8rem)] w-[40rem] origin-bottom flex-col overflow-hidden rounded-2xl border shadow-[0_20px_60px_rgba(0,0,0,0.2)] backdrop-blur-md saturate-150'
            >
              <div className='min-h-0 flex-1 overflow-y-auto p-3'>
                {/* Win 开始页风格:分类标题 + 图标上文字下的磁贴网格 */}
                {groups.map((group) => (
                  <div key={group.id} className='mb-2 last:mb-0'>
                    <div className='text-muted-foreground/70 px-1 pb-1.5 pt-1 text-[0.7rem] font-medium tracking-wide'>
                      {group.title}
                    </div>
                    <div className='grid grid-cols-5 gap-1'>
                      {group.items.map((item) => {
                        const Icon = item.icon
                        return (
                          <button
                            key={item.url}
                            type='button'
                            onClick={() => {
                              osNavigate(item.url)
                              close()
                            }}
                            className='text-muted-foreground hover:bg-accent hover:text-foreground flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 transition-colors'
                          >
                            {Icon ? (
                              <Icon className='size-6 shrink-0' aria-hidden='true' />
                            ) : null}
                            <span className='w-full truncate text-center text-xs leading-tight'>
                              {item.title}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  )
}
