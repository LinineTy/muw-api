import { Link } from '@tanstack/react-router'
// @muw-owned
import {
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  MessageSquare,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDirection } from '@/context/direction-provider'
import { fetchActiveChatKey } from '@/features/chat/hooks/use-active-chat-key'
import { useChatPresets } from '@/features/chat/hooks/use-chat-presets'
import {
  chatLinkRequiresApiKey,
  resolveChatUrl,
  type ChatPreset,
} from '@/features/chat/lib/chat-links'
import { useNotifications } from '@/hooks/use-notifications'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'

import { SystemBrand } from '../system-brand'
import { useOsBallStore } from './os-ball-store'
import { FAB_BALL_SM, FAB_ICON_SM } from './os-ball-style'
import { useOsShellNavigate } from './os-open'

/**
 * OS 桌面壳 · 左侧细竖条(原底部左右两簇合并而来):
 *   上端 = 品牌,点击去站点首页
 *   下端 = 两坨:[ 语言 主题 头像 ] ──细线── [ 快速导航 公告 第三方接入 ]
 * - 尺寸比底部 Dock 小一号(32px vs 40px),层级分明,不读成"第二个 Dock"
 * - 站点方向 Direction=rtl 时整条翻到右边,弹层方向一并翻
 * - 弹层一律朝条内侧弹(side=right/left),不再用底部 Dock 的 top 语义
 */

function closeNavCard() {
  useOsBallStore.getState().close()
}

/** 第三方接入球:web 类型=站内对话(开窗);其余=带 key 拉起外部客户端 */
function ChatPresetsBall({ side }: { side: 'left' | 'right' }) {
  const { t } = useTranslation()
  const { chatPresets, serverAddress } = useChatPresets()
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null)
  const loadingRef = useRef<string | null>(null)

  const visiblePresets = useMemo(
    () => chatPresets.filter((preset) => preset.type !== 'fluent'),
    [chatPresets]
  )

  const handleOpenExternal = useCallback(
    async (preset: ChatPreset) => {
      if (preset.type === 'web') return

      const needsKey = chatLinkRequiresApiKey(preset.url)
      let activeKey: string | undefined

      if (needsKey && loadingRef.current) {
        toast.info(t('Preparing your chat link, please try again in a moment.'))
        return
      }

      if (needsKey) {
        loadingRef.current = preset.id
        setLoadingPresetId(preset.id)
        try {
          activeKey = await fetchActiveChatKey()
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : t(
                  'Unable to prepare chat link. Please ensure you have an enabled API key.'
                )
          toast.error(message)
          return
        } finally {
          loadingRef.current = null
          setLoadingPresetId(null)
        }
      }

      const url = resolveChatUrl({
        template: preset.url,
        apiKey: needsKey ? activeKey : undefined,
        serverAddress,
      })

      if (!url) {
        toast.error(t('Invalid chat link. Please contact the administrator.'))
        return
      }

      window.open(url, '_blank', 'noopener')
    },
    [serverAddress, t]
  )

  if (visiblePresets.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            aria-label={t('Third-party Integration')}
            title={t('Third-party Integration')}
            onClick={closeNavCard}
            className={FAB_BALL_SM}
          />
        }
      >
        <MessageSquare className={FAB_ICON_SM} aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='center'
        side={side}
        sideOffset={8}
        className='z-[80] min-w-64'
      >
        {visiblePresets.map((preset) =>
          preset.type === 'web' ? (
            <DropdownMenuItem
              key={preset.id}
              render={
                <Link
                  to='/chat/$chatId'
                  params={{ chatId: preset.id }}
                  onClick={closeNavCard}
                />
              }
            >
              <Link2 className='size-4 shrink-0' aria-hidden='true' />
              <span className='whitespace-nowrap'>{preset.name}</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => {
                if (!loadingPresetId) void handleOpenExternal(preset)
              }}
            >
              {loadingPresetId === preset.id ? (
                <Loader2 className='size-4 animate-spin' aria-hidden='true' />
              ) : (
                <ExternalLink className='size-4 shrink-0' aria-hidden='true' />
              )}
              <span className='whitespace-nowrap'>{preset.name}</span>
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 快速导航:收纳管理端 HeaderNavModules 配置的顶栏页面链接 */
function NavJumpGroup({ side }: { side: 'left' | 'right' }) {
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
            className={FAB_BALL_SM}
          />
        }
      >
        <Globe className={FAB_ICON_SM} aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='center'
        side={side}
        sideOffset={8}
        className='z-[80]'
      >
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

/** 上坨:语言 / 主题 / 头像(系统项) */
function RailSystemGroup({ side }: { side: 'left' | 'right' }) {
  const osNavigate = useOsShellNavigate()
  const { t } = useTranslation()

  return (
    <div className='flex flex-col items-center gap-0.5'>
      <LanguageSwitcher
        contentSide={side}
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

/** 下坨:快速导航 / 公告 / 第三方接入(工具项) */
function RailToolsGroup({ side }: { side: 'left' | 'right' }) {
  const notifications = useNotifications()
  const { t } = useTranslation()

  return (
    <div className='flex flex-col items-center gap-0.5'>
      <NavJumpGroup side={side} />

      <NotificationPopover
        open={notifications.popoverOpen}
        onOpenChange={notifications.setPopoverOpen}
        unreadCount={notifications.unreadCount}
        activeTab={notifications.activeTab}
        onTabChange={notifications.setActiveTab}
        notice={notifications.notice}
        announcements={notifications.announcements}
        loading={notifications.loading}
        contentSide={side}
        trigger={
          <button
            type='button'
            aria-label={t('Notifications')}
            title={t('Notifications')}
            onClick={closeNavCard}
            className={cn(FAB_BALL_SM, 'relative')}
          />
        }
      />

      <ChatPresetsBall side={side} />
    </div>
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
        <RailToolsGroup side={side} />
        <span className='bg-border/60 my-1.5 h-px w-6' aria-hidden='true' />
        <RailSystemGroup side={side} />
      </div>
    </nav>
  )
}
