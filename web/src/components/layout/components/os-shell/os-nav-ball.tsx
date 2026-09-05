// @muw-owned
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { LayoutGrid, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useOsNavGroups } from './use-os-nav'

/**
 * OS 桌面壳 · 导航球(侧栏→球):
 * - 左下角垂直球组下位(最贴角),点击向球右侧弹出玻璃导航卡
 * - 菜单数据复用 useOsNavGroups(侧栏同源,权限/i18n/分组小标题继承)
 * - 球本体配方与移动端 FAB 同款(bg-popover + blur + saturate)
 */
export function OsNavBall() {
  const groups = useOsNavGroups()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type='button'
        aria-label='Open navigation'
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
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
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, x: -10, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -10, scale: 0.96 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className='bg-sidebar/80 border-border/70 fixed bottom-4 left-[4.25rem] z-[69] flex max-h-[calc(100svh-14rem)] w-64 origin-bottom-left flex-col overflow-hidden rounded-2xl border shadow-[0_20px_60px_rgba(0,0,0,0.2)] backdrop-blur-md saturate-150'
            >
              <div className='min-h-0 flex-1 overflow-y-auto p-2'>
                {groups.map((group) => (
                  <div key={group.id} className='mb-1.5 last:mb-0'>
                    <div className='text-muted-foreground/70 px-2.5 pb-1 pt-2 text-[0.68rem] font-medium tracking-wide'>
                      {group.title}
                    </div>
                    {group.items.map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.url}
                          type='button'
                          onClick={() => {
                            navigate({ to: item.url })
                            setOpen(false)
                          }}
                          className='text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors'
                        >
                          {Icon ? (
                            <Icon className='size-4 shrink-0' aria-hidden='true' />
                          ) : null}
                          <span className='truncate'>{item.title}</span>
                        </button>
                      )
                    })}
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
