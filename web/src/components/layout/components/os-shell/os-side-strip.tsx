// @muw-owned
import { Bell, Component, Globe, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { useDirection } from '@/context/direction-provider'
import { useChatPresets } from '@/features/chat/hooks/use-chat-presets'
import {
  NotificationsDialog,
  useUserNotifications,
} from '@/features/notifications/components/notifications-dialog'
import { useIsAdmin } from '@/hooks/use-admin'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'

import { SystemBrand } from '../system-brand'
import { useOsBallStore } from './os-ball-store'
import { FAB_BALL_SM, FAB_ICON_SM } from './os-ball-style'
import { useOsShellNavigate } from './os-open'
import { OsPreferencesDialog } from './os-preferences-dialog'
import { OsQuickLinksDialog } from './os-quick-links-dialog'
import { OsThirdPartyDialog } from './os-third-party-dialog'

/**
 * OS 桌面壳 · 左侧细竖条(原底部左右两簇合并而来):
 *   上端 = 品牌,点击去站点首页
 *   下端 = 两坨:[ 语言 主题 头像 ] ──细线── [ 快速导航 消息 偏好设置 第三方接入 ]
 * - 尺寸比底部 Dock 小一号(32px vs 40px),层级分明,不读成"第二个 Dock"
 * - 站点方向 Direction=rtl 时整条翻到右边,弹层方向一并翻
 * - 弹层一律朝条内侧弹(side=right/left),不再用底部 Dock 的 top 语义
 */

function closeNavCard() {
  useOsBallStore.getState().close()
}

/** 第三方接入球:打开弹窗列对话客户端（原下拉菜单，2026-09-21要弹窗） */
function OsThirdPartyBall() {
  const { t } = useTranslation()
  const { chatPresets } = useChatPresets()
  const [open, setOpen] = useState(false)
  // fluent 是上游残留类型，三处入口都过滤；全被过滤掉时这颗球不渲染
  const hasVisiblePresets = chatPresets.some(
    (preset) => preset.type !== 'fluent'
  )

  if (!hasVisiblePresets) return null

  return (
    <>
      <button
        type='button'
        aria-label={t('Third-party Integration')}
        title={t('Third-party Integration')}
        data-state={open ? 'open' : 'closed'}
        onClick={() => {
          closeNavCard()
          setOpen(true)
        }}
        className={FAB_BALL_SM}
      >
        <MessageSquare className={FAB_ICON_SM} aria-hidden='true' />
      </button>
      <OsThirdPartyDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** 快速导航球:打开弹窗列管理端配置的顶栏链接（原下拉菜单，2026-09-21要弹窗） */
function OsQuickLinksBall() {
  const { t } = useTranslation()
  const links = useTopNavLinks()
  const [open, setOpen] = useState(false)

  if (links.length === 0) return null

  return (
    <>
      <button
        type='button'
        aria-label={t('Quick links')}
        title={t('Quick links')}
        data-state={open ? 'open' : 'closed'}
        onClick={() => {
          closeNavCard()
          setOpen(true)
        }}
        className={FAB_BALL_SM}
      >
        <Globe className={FAB_ICON_SM} aria-hidden='true' />
      </button>
      <OsQuickLinksDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** 上坨:语言 / 主题 / 头像(系统项) */
function RailSystemGroup({ side }: { side: 'left' | 'right' }) {
  const osNavigate = useOsShellNavigate()
  const { t } = useTranslation()

  return (
    <div className='flex flex-col items-center gap-0.5'>
      <LanguageSwitcher
        contentSide={side}
        // 居中：弹卡以球为竖直中心；太长时由 collisionPadding 保证上移且不贴屏幕边
        contentAlign='center'
        trigger={
          <button
            type='button'
            aria-label={t('Change language')}
            title={t('Change language')}
            onClick={closeNavCard}
            className={FAB_BALL_SM}
          />
        }
      />

      <ConfigDrawer
        trigger={
          <button
            type='button'
            aria-label={t('Open theme settings')}
            title={t('Open theme settings')}
            onClick={closeNavCard}
            className={FAB_BALL_SM}
          />
        }
      />

      <ProfileDropdown
        contentSide={side}
        contentAlign='center'
        onNavigate={(path) => osNavigate(path)}
        trigger={
          <button
            type='button'
            onClick={closeNavCard}
            aria-label={t('Profile')}
            className={FAB_BALL_SM}
          />
        }
      />
    </div>
  )
}

/** 下坨:快速导航 / 消息 / 偏好设置(组件·鲸鱼) / 第三方接入(工具项) */
function RailToolsGroup() {
  return (
    <div className='flex flex-col items-center gap-0.5'>
      <OsQuickLinksBall />

      <OsNotificationsBall />

      {/* 组件 + 鲸鱼合并成一个弹窗入口（2026-09-20：边栏少一颗球、功能放一起）。
          公告卡开关也在这个弹窗里 —— 它本来就是桌面组件之一 */}
      <OsPreferencesBall />

      <OsThirdPartyBall />
    </div>
  )
}

/**
 * 消息球（原公告铃铛的位置，外观不变）。
 *
 * 功能换成**站内消息**：点开消息弹窗（上游模型巡检等管理端通知），带未读角标。
 * 角标是"还剩几条未读"，只在**逐条标为已读**时递减（打开弹窗不清空，2026-09-21定）。
 * 公告卡的展开/收起已并入「偏好设置」弹窗，两处能关同一个东西只会让人困惑。
 * 目前只有管理员会收到站内消息，所以对非管理员不渲染这颗球。
 */
function OsNotificationsBall() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [open, setOpen] = useState(false)
  const { data } = useUserNotifications()
  const unread = data?.unread ?? 0

  if (!isAdmin) return null

  return (
    <>
      <button
        type='button'
        aria-label={t('Notifications')}
        title={t('Notifications')}
        data-state={open ? 'open' : 'closed'}
        onClick={() => {
          closeNavCard()
          setOpen(true)
        }}
        className={cn(FAB_BALL_SM, 'relative')}
      >
        <Bell className={FAB_ICON_SM} aria-hidden='true' />
        {unread > 0 && (
          <span
            data-testid='notifications-unread-badge'
            className='bg-destructive absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] leading-none font-medium text-white tabular-nums'
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      <NotificationsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** 偏好设置球:桌面组件显隐 + 鲸鱼挂件，合并后的唯一入口 */
function OsPreferencesBall() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type='button'
        aria-label={t('Preferences')}
        title={t('Preferences')}
        data-state={open ? 'open' : 'closed'}
        onClick={() => {
          closeNavCard()
          setOpen(true)
        }}
        className={FAB_BALL_SM}
      >
        {/* 沿用原「组件」球的 Component 图标：用户对这个入口的认知就是"桌面上的东西" */}
        <Component className={FAB_ICON_SM} aria-hidden='true' />
      </button>
      <OsPreferencesDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

export function OsSideStrip() {
  const { dir } = useDirection()
  const rtl = dir === 'rtl'
  const side: 'left' | 'right' = rtl ? 'left' : 'right'

  return (
    <nav
      aria-label='OS side rail'
      className={cn(
        'fixed inset-y-0 z-[70] flex w-12 flex-col items-center justify-between py-3',
        rtl ? 'right-1' : 'left-1'
      )}
    >
      {/* 上端:品牌,点击去站点首页 */}
      <SystemBrand variant='icon' />

      {/* 下端:两坨,中间一道细线(工具在上、系统项含头像在下) */}
      <div className='flex flex-col items-center'>
        <RailToolsGroup />
        <span className='bg-border/60 my-1.5 h-px w-6' aria-hidden='true' />
        <RailSystemGroup side={side} />
      </div>
    </nav>
  )
}
