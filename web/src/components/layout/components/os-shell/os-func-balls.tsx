// @muw-owned
import { Bell, Languages, Palette, Search as SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { useNotifications } from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'
import { useOsBallStore } from './os-ball-store'

/**
 * OS 桌面壳 · 功能球组(原顶栏功能逐项拆球):
 * 一项一球直接触发,不再经过"顶栏球→弹卡→二级弹窗"嵌套,
 * Radix 弹层 portal z-80 天然盖过窗口,遮挡问题随嵌套一起消失。
 * 布局:左下垂直,导航球(bottom-4)之上依次 搜索/公告/语言/主题/个人。
 * 点击任意功能球时收起导航球弹卡;功能球之间的 Radix 弹层由
 * dismiss 行为自动互斥(点另一个球=点击外部)。
 */

const BALL_BTN =
  'bg-popover text-primary border-border/60 shadow-[0_8px_24px_rgba(0,0,0,0.15)] backdrop-blur saturate-150' +
  ' hover:scale-[1.08] active:scale-95 rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'

const BALL_SLOTS = [
  'bottom-[21.25rem]',
  'bottom-[17rem]',
  'bottom-[12.75rem]',
  'bottom-[8.5rem]',
  'bottom-[4.25rem]',
] as const

function closeNavCard() {
  useOsBallStore.getState().close('nav')
}

export function OsFuncBalls() {
  const notifications = useNotifications()

  return (
    <>
      {/* 搜索球:唤起全局搜索 Dialog */}
      <Button
        variant='ghost'
        size='icon'
        aria-label='Search'
        onClick={closeNavCard}
        className={cn(
          'fixed left-4 z-[70] hidden size-11',
          BALL_SLOTS[4],
          BALL_BTN
        )}
      >
        <Search className='size-5' aria-hidden='true' />
      </Button>

      {/* 公告球 */}
      <div
        className={cn(
          'fixed left-4 z-[70]',
          BALL_SLOTS[3]
        )}
      >
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
            <Button
              variant='ghost'
              size='icon'
              onClick={closeNavCard}
              className={cn('size-11 rounded-full', BALL_BTN)}
              aria-label='Notifications'
            />
          }
        />
      </div>

      {/* 语言球 */}
      <div className={cn('fixed left-4 z-[70]', BALL_SLOTS[2])}>
        <LanguageSwitcher
          trigger={
            <Button
              variant='ghost'
              size='icon'
              onClick={closeNavCard}
              className={cn('size-11 rounded-full', BALL_BTN)}
              aria-label='Change language'
            />
          }
        />
      </div>

      {/* 主题/配置球 */}
      <div className={cn('fixed left-4 z-[70]', BALL_SLOTS[1])}>
        <ConfigDrawer
          trigger={
            <Button
              size='icon'
              variant='ghost'
              onClick={closeNavCard}
              className={cn('size-11 rounded-full', BALL_BTN)}
              aria-label='Open theme settings'
            />
          }
        />
      </div>

      {/* 个人球 */}
      <div className={cn('fixed left-4 z-[70]', BALL_SLOTS[0])}>
        <ProfileDropdown
          trigger={
            <Button
              variant='ghost'
              onClick={closeNavCard}
              className={cn('size-11 rounded-full', BALL_BTN)}
            />
          }
        />
      </div>
    </>
  )
}

// 供 tooltip 参考的图标命名,保持与原顶栏一致
export const FUNC_BALL_ICONS = { Bell, Languages, Palette, SearchIcon }
