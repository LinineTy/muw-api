// @muw-owned
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Settings2, X } from 'lucide-react'

import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { useNotifications } from '@/hooks/use-notifications'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'
import { SystemBrand } from '../system-brand'

/**
 * OS 桌面壳 · 顶栏球(顶栏→球):
 * - 左下角垂直球组上位(导航球上方),点击向球右侧弹出玻璃控制卡
 * - 收纳原 AppHeader 的全局功能件:品牌/搜索/通知/语言/配置/用户
 * - 页面级上下文(面包屑/页名)职责已转移给窗口标题栏
 */
export function OsTopbarBall() {
  const [open, setOpen] = useState(false)
  const notifications = useNotifications()
  // 原顶栏的页面跳转(后端 HeaderNavModules 配置驱动:首页/定价/模型广场等)
  const topLinks = useTopNavLinks()

  return (
    <>
      <button
        type='button'
        aria-label='Open system menu'
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'bg-popover text-primary border-border/60 fixed bottom-[4.25rem] left-4 z-[70] flex size-11 items-center justify-center border shadow-[0_8px_24px_rgba(0,0,0,0.15)] backdrop-blur saturate-150',
          'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'hover:scale-[1.08] active:scale-95',
          open ? 'rotate-90 rounded-lg' : 'rounded-full'
        )}
      >
        {open ? (
          <X className='size-5' aria-hidden='true' />
        ) : (
          <Settings2 className='size-5' aria-hidden='true' />
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
              className='bg-sidebar/80 border-border/70 fixed bottom-[4.25rem] left-[4.25rem] z-[69] flex w-72 origin-bottom-left flex-col gap-2 overflow-hidden rounded-2xl border p-3 shadow-[0_20px_60px_rgba(0,0,0,0.2)] backdrop-blur-md saturate-150'
            >
              <div className='border-border/40 flex items-center justify-center border-b pb-2.5'>
                <SystemBrand variant='inline' />
              </div>
              {/* 原顶栏页面跳转(HeaderNavModules 动态配置) */}
              {topLinks.length > 0 ? (
                <div className='flex flex-col gap-0.5 border-b border-border/40 pb-2'>
                  {topLinks.map((link) =>
                    link.external ? (
                      <a
                        key={link.href}
                        href={link.href}
                        target='_blank'
                        rel='noreferrer'
                        className='text-muted-foreground hover:bg-accent hover:text-foreground flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors'
                      >
                        <span className='truncate'>{link.title}</span>
                        <ArrowUpRight className='size-3.5 shrink-0' aria-hidden='true' />
                      </a>
                    ) : (
                      <Link
                        key={link.href}
                        to={link.href}
                        onClick={() => setOpen(false)}
                        className='text-muted-foreground hover:bg-accent hover:text-foreground flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors'
                      >
                        <span className='truncate'>{link.title}</span>
                        <ArrowUpRight className='opacity-0 size-3.5 shrink-0' aria-hidden='true' />
                      </Link>
                    )
                  )}
                </div>
              ) : null}
              {/* 搜索独占一行,避免把功能按钮挤出容器 */}
              <div className='flex w-full'>
                <Search />
              </div>
              <div className='flex items-center justify-end gap-1'>
                <NotificationPopover
                  open={notifications.popoverOpen}
                  onOpenChange={notifications.setPopoverOpen}
                  unreadCount={notifications.unreadCount}
                  activeTab={notifications.activeTab}
                  onTabChange={notifications.setActiveTab}
                  notice={notifications.notice}
                  announcements={notifications.announcements}
                  loading={notifications.loading}
                />
                <LanguageSwitcher />
                <ConfigDrawer />
                <ProfileDropdown />
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  )
}
