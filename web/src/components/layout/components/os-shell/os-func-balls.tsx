// @muw-owned
import { Globe, Search as SearchIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { useSearch } from '@/context/search-provider'
import { useNotifications } from '@/hooks/use-notifications'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'
import { useOsBallStore } from './os-ball-store'

/**
 * OS 桌面壳 · 功能球组(原顶栏功能逐项拆球,横向一行):
 * [跳转球…][搜索][公告][语言][主题][个人] — 贴在 Dock 左侧同一底线,
 * 由 authenticated-layout 的固定行容器定位(本组件自身不 fixed)。
 * 一项一球直接触发各自 Radix 弹层,不再经过"球→弹卡→二级弹窗"嵌套;
 * 点击任意球时收起导航球弹卡,球间弹层由 Radix dismiss 自动互斥。
 */

const BALL_BTN =
  'bg-popover text-primary border-border/60 shadow-[0_8px_24px_rgba(0,0,0,0.15)] backdrop-blur saturate-150' +
  ' hover:scale-[1.08] active:scale-95 rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'

function closeNavCard() {
  useOsBallStore.getState().close('nav')
}

/** 跳转球:管理端 HeaderNavModules 配置的顶栏页面链接(首页/定价/文档等) */
function NavJumpBalls() {
  const links = useTopNavLinks()
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
            className={cn(
              'text-primary hover:text-foreground flex size-10 items-center justify-center border',
              BALL_BTN
            )}
          >
            <Globe className='size-[1.1rem]' aria-hidden='true' />
          </a>
        ) : (
          <Link
            key={link.href}
            to={link.href}
            title={link.title}
            aria-label={link.title}
            onClick={closeNavCard}
            className={cn(
              'text-primary hover:text-foreground flex size-10 items-center justify-center border',
              BALL_BTN
            )}
          >
            <Globe className='size-[1.1rem]' aria-hidden='true' />
          </Link>
        )
      )}
    </>
  )
}

export function OsFuncBalls() {
  const notifications = useNotifications()
  const { setOpen: setSearchOpen } = useSearch()

  const ballBtn = (label: string) => (
    <Button
      variant='ghost'
      size='icon'
      onClick={closeNavCard}
      aria-label={label}
      className={cn('size-10 rounded-full', BALL_BTN)}
    />
  )

  return (
    <div className='flex items-center gap-1.5'>
      <NavJumpBalls />

      {/* 搜索球:唤起全局搜索 Dialog */}
      <Button
        variant='ghost'
        size='icon'
        aria-label='Search'
        title='Search'
        onClick={() => {
          closeNavCard()
          setSearchOpen(true)
        }}
        className={cn('size-10 rounded-full border', BALL_BTN)}
      >
        <SearchIcon className='size-[1.1rem]' aria-hidden='true' />
      </Button>

      {/* 公告球 */}
      <NotificationPopover
        open={notifications.popoverOpen}
        onOpenChange={notifications.setPopoverOpen}
        unreadCount={notifications.unreadCount}
        activeTab={notifications.activeTab}
        onTabChange={notifications.setActiveTab}
        notice={notifications.notice}
        announcements={notifications.announcements}
        loading={notifications.loading}
        trigger={ballBtn('Notifications')}
      />

      {/* 语言球 */}
      <LanguageSwitcher trigger={ballBtn('Change language')} />

      {/* 主题/配置球 */}
      <ConfigDrawer trigger={ballBtn('Open theme settings')} />

      {/* 个人球 */}
      <ProfileDropdown trigger={ballBtn('Profile')} />
    </div>
  )
}
