// @muw-owned
import { AnimatePresence, motion } from 'motion/react'
import { LayoutGrid, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useOsNavGroups } from './use-os-nav'
import { useOsShellNavigate } from './os-open'
import { useOsBallStore } from './os-ball-store'

/**
 * OS 桌面壳 · 导航球(侧栏→球):
 * - 左下角垂直球组下位(最贴角),点击向球右侧弹出玻璃导航卡
 * - 菜单数据复用 useOsNavGroups(侧栏同源,权限/i18n/分组小标题继承)
 * - 点击菜单项=开窗(已开则置顶);设置页例外(走主层完整布局,不进窗口)
 * - 球本体配方与移动端 FAB 同款(bg-popover + blur + saturate)
 */
export function OsNavBall() {
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
        onClick={() => toggle()}
        className={cn(
          'bg-popover text-primary border-border/60 fixed bottom-4 left-4 z-[70] flex size-11 items-center justify-center border shadow-[0_8px_24px_rgba(0,0,0,0.15)] backdrop-blur saturate-150',
          'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'hover:scale-[1.08] active:scale-95',
          open ? 'rotate-90 rounded-lg' : 'rounded-full'
        )}
      >
        {open ? (
          <X className='size-5' aria-hidden='true' />
        ) : (
          <LayoutGrid className='size-5' aria-hidden='true' />
        )}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <div
              className='fixed inset-0 z-[69]'
              onClick={() => close()}
            />
            <motion.div
              initial={{ opacity: 0, x: -10, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -10, scale: 0.96 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              data-os-ball-card='nav' className='bg-sidebar/80 border-border/70 fixed bottom-4 left-[4.25rem] z-[69] flex max-h-[calc(100svh-8rem)] w-[30rem] origin-bottom-left flex-col overflow-hidden rounded-2xl border shadow-[0_20px_60px_rgba(0,0,0,0.2)] backdrop-blur-md saturate-150'
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
