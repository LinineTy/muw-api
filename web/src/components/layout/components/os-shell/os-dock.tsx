// @muw-owned
import { Globe, Search as SearchIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { cn } from '@/lib/utils'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'
import { useSearch } from '@/context/search-provider'
import { useNotifications } from '@/hooks/use-notifications'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { useOsBallStore } from './os-ball-store'
import { useOsWindowsStore } from '@/stores/os-windows-store'
import { matchOsNavItem, useOsNavItems } from './use-os-nav'

/**
 * OS 桌面壳 · 底部 Dock(一段式,原顶栏功能并入固定区):
 *   [ 搜索 公告 语言 主题 头像 连接组 | 已打开页面… ]
 * - 固定区与窗口区同尺寸同配方(size-10 rounded-xl / 头像圆),
 *   分隔线隔开;固定项点击时收起左下导航球弹卡,Radix 弹层靠
 *   dismiss 自动互斥
 * - 窗口区(macOS 行为):已最小化→恢复置顶;已激活→最小化;
 *   已开未激活→置顶;激活窗图标实心高亮,其余运行小点
 */

const ITEM_BTN =
  'text-muted-foreground hover:text-foreground relative flex size-10 items-center justify-center rounded-xl transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1.5 hover:bg-accent'

function closeNavCard() {
  useOsBallStore.getState().close()
}

/** 连接组:管理端 HeaderNavModules 配置的顶栏页面链接(首页/定价/文档等) */
function NavJumpItems() {
  const links = useTopNavLinks()
  const cls = cn(ITEM_BTN, 'text-primary')
  return (
    <>
      {links.map((link) =>
        link.external ? (
          <a
            key={link.href}
            href={link.href}
            target='_blank'
            rel='noreferrer'
            title={link.title}
            aria-label={link.title}
            onClick={closeNavCard}
            className={cls}
          >
            <Globe className='size-[1.15rem]' aria-hidden='true' />
          </a>
        ) : (
          <Link
            key={link.href}
            to={link.href}
            title={link.title}
            aria-label={link.title}
            onClick={closeNavCard}
            className={cls}
          >
            <Globe className='size-[1.15rem]' aria-hidden='true' />
          </Link>
        )
      )}
    </>
  )
}

/** 固定功能区:原顶栏的搜索/公告/语言/主题/个人 + 连接组 */
function DockFixedItems() {
  const notifications = useNotifications()
  const { setOpen: setSearchOpen } = useSearch()

  return (
    <>
      {/* 搜索 */}
      <button
        type='button'
        aria-label='Search'
        title='Search'
        onClick={() => {
          closeNavCard()
          setSearchOpen(true)
        }}
        className={ITEM_BTN}
      >
        <SearchIcon className='size-[1.15rem]' aria-hidden='true' />
      </button>

      {/* 公告 */}
      <NotificationPopover
        open={notifications.popoverOpen}
        onOpenChange={notifications.setPopoverOpen}
        unreadCount={notifications.unreadCount}
        activeTab={notifications.activeTab}
        onTabChange={notifications.setActiveTab}
        notice={notifications.notice}
        announcements={notifications.announcements}
        loading={notifications.loading}
        trigger={
          <button
            type='button'
            aria-label='Notifications'
            title='Notifications'
            onClick={closeNavCard}
            className={ITEM_BTN}
          />
        }
      />

      {/* 语言 */}
      <LanguageSwitcher
        trigger={
          <button
            type='button'
            aria-label='Change language'
            title='Change language'
            onClick={closeNavCard}
            className={ITEM_BTN}
          />
        }
      />

      {/* 主题/配置 */}
      <ConfigDrawer
        trigger={
          <button
            type='button'
            aria-label='Open theme settings'
            title='Open theme settings'
            onClick={closeNavCard}
            className={ITEM_BTN}
          />
        }
      />

      {/* 个人(头像,圆形) */}
      <ProfileDropdown
        trigger={
          <button
            type='button'
            onClick={closeNavCard}
            aria-label='Profile'
            className={cn(ITEM_BTN, 'rounded-full')}
          />
        }
      />

      <NavJumpItems />
    </>
  )
}

export function OsDock() {
  const items = useOsNavItems()
  const [hovered, setHovered] = useState<string | null>(null)
  const { windows, activeId, activateWindow, restoreWindow, minimizeWindow } =
    useOsWindowsStore()

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
      <DockFixedItems />

      {windows.length > 0 ? (
        <>
          <span
            aria-hidden='true'
            className='bg-border/80 mx-1 h-8 w-px self-center'
          />
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
                  ITEM_BTN,
                  'pb-0.5',
                  activeHere && 'text-foreground'
                )}
              >
                {Icon ? (
                  <Icon className='size-[1.15rem]' aria-hidden='true' />
                ) : null}
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
        </>
      ) : null}
    </nav>
  )
}
