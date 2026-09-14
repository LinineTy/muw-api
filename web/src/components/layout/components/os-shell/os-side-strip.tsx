import { Link } from '@tanstack/react-router'
// @muw-owned
import {
  Bell,
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
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'

import { SystemBrand } from '../system-brand'
import { useOsBallStore } from './os-ball-store'
import { FAB_BALL_SM, FAB_ICON_SM } from './os-ball-style'
import { useOsNoticeStore } from './os-notice-store'
import { useOsShellNavigate } from './os-open'
import { OsWhaleBall } from './os-whale-ball'
import { OsWidgetsBall } from './os-widgets-ball'

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
        collisionPadding={12}
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
        collisionPadding={12}
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

/** 下坨:快速导航 / 公告 / 组件开关 / 第三方接入(工具项) */
function RailToolsGroup({ side }: { side: 'left' | 'right' }) {
  return (
    <div className='flex flex-col items-center gap-0.5'>
      <NavJumpGroup side={side} />

      <OsNoticeBall />

      {/* 组件开关：紧挨公告球下方（maintainer："插中间"）；公告卡不在这个菜单里，
          它归上面的铃铛管 —— 两处能关同一个东西会让人困惑 */}
      <OsWidgetsBall side={side} />

      {/* 鲸鱼挂件：设置只有大小/音效/音量三行，与"组件"球同形态 */}
      <OsWhaleBall side={side} />

      <ChatPresetsBall side={side} />
    </div>
  )
}

/**
 * 时间线公告入口（原来的铃铛位置，外观不变）。
 * 功能改为：点一下展开/收起桌面右上角的公告堆叠卡 ——
 * 卡片上的 × 会把它整个隐藏，恢复显示就靠这里；未读不靠角标，
 * 改由「有新公告自动展开」承担。
 */
function OsNoticeBall() {
  const { t } = useTranslation()
  const collapsed = useOsNoticeStore((state) => state.collapsed)
  const toggleNotice = useOsNoticeStore((state) => state.toggle)

  return (
    <button
      type='button'
      aria-label={t('System Announcements')}
      title={t('System Announcements')}
      data-state={collapsed ? 'closed' : 'open'}
      onClick={() => {
        closeNavCard()
        toggleNotice()
      }}
      className={FAB_BALL_SM}
    >
      <Bell className={FAB_ICON_SM} aria-hidden='true' />
    </button>
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
