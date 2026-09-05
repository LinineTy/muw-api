// @muw-owned
import { Globe, Search as SearchIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { cn } from '@/lib/utils'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'
import { useSearch } from '@/context/search-provider'
import { useTranslation } from 'react-i18next'
import { useNotifications } from '@/hooks/use-notifications'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { useOsBallStore } from './os-ball-store'
import { useOsWindowsStore } from '@/stores/os-windows-store'
import { matchOsNavItem, useOsNavItems } from './use-os-nav'
import { useOsShellNavigate } from './os-open'

/**
 * OS 桌面壳 · 底部 Dock(一段式):
 *   [ 搜索 公告 语言 主题 头像 连接组 | 已打开页面… ]
 * - 固定区球体走移动端 FAB 同款配方(bg-popover 玻璃 + blur/saturate,
 *   无容器底色;琉璃主题下透出背景),弹层打开时圆→圆角方(data-state)
 * - 连接组:一颗球弹出菜单,收纳管理端 HeaderNavModules 配置的页面链接
 * - 窗口区(macOS 行为):已最小化→恢复置顶;已激活→最小化;
 *   已开未激活→置顶;激活窗图标实心高亮,其余运行小点
 */

const FAB_BALL =
  // 纯图标球:无 border 无自带底色(深色下圈套圈很脏),hover 微亮,
  // 容器感交给 Dock 胶囊;弹层打开时圆→圆角方(data-state)
  'text-primary flex size-10 items-center justify-center' +
  ' transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]' +
  ' hover:bg-accent hover:scale-[1.08] active:scale-95 rounded-full data-[state=open]:rounded-lg'

function closeNavCard() {
  useOsBallStore.getState().close()
}

/** 连接组:一颗球收纳管理端 HeaderNavModules 配置的顶栏页面链接 */
function NavJumpGroup() {
  const { t } = useTranslation()
  const links = useTopNavLinks()
  if (links.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            aria-label={t('Quick links')}
            title={t('Quick links')}
            onClick={closeNavCard}
            className={FAB_BALL}
          />
        }
      >
        <Globe className='size-[1.15rem]' aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side='top'>
        {links.map((link) =>
          link.external ? (
            <DropdownMenuItem
              key={link.href}
              render={
                <a
                  href={link.href}
                  target='_blank'
                  rel='noreferrer'
                  onClick={closeNavCard}
                />
              }
            >
              <Globe className='size-4' aria-hidden='true' />
              {link.title}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={link.href}
              render={<Link to={link.href} onClick={closeNavCard} />}
            >
              <Globe className='size-4' aria-hidden='true' />
              {link.title}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 固定功能区:原顶栏的搜索/公告/语言/主题/个人 + 连接组 */
function DockFixedItems() {
  const notifications = useNotifications()
  const { setOpen: setSearchOpen } = useSearch()
  const osNavigate = useOsShellNavigate()
  const { t } = useTranslation()

  return (
    <>
      {/* 搜索 */}
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
            aria-label={t('Notifications')}
            title={t('Notifications')}
            onClick={closeNavCard}
            className={cn(FAB_BALL, 'relative')}
          />
        }
      />

      {/* 语言 */}
      <LanguageSwitcher
        trigger={
          <button
            type='button'
            aria-label={t('Change language')}
            title={t('Change language')}
            onClick={closeNavCard}
            className={FAB_BALL}
          />
        }
      />

      {/* 主题/配置 */}
      <ConfigDrawer
        trigger={
          <button
            type='button'
            aria-label={t('Open theme settings')}
            title={t('Open theme settings')}
            onClick={closeNavCard}
            className={FAB_BALL}
          />
        }
      />

      {/* 个人(头像) */}
      <ProfileDropdown
        onNavigate={(path) => osNavigate(path)}
        trigger={
          <button
            type='button'
            onClick={closeNavCard}
            aria-label={t('Profile')}
            className={FAB_BALL}
          />
        }
      />

      <NavJumpGroup />
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
            className='bg-border/60 mx-0.5 h-8 w-px self-center'
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
