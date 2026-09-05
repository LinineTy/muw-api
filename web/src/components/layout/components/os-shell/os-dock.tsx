// @muw-owned
import {
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  MessageSquare,
  Search as SearchIcon,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Link } from '@tanstack/react-router'
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
import { fetchActiveChatKey } from '@/features/chat/hooks/use-active-chat-key'
import { useChatPresets } from '@/features/chat/hooks/use-chat-presets'
import {
  chatLinkRequiresApiKey,
  resolveChatUrl,
  type ChatPreset,
} from '@/features/chat/lib/chat-links'
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
/**
 * OS 桌面壳 · 聊天预设球:第三方聊天客户端接入为独立模块,不与聊天窗绑定。
 * web 类型预设=站内对话(开窗);其余=带 key 拉起外部客户端(原逻辑)。
 */
function ChatPresetsBall() {
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
            className={FAB_BALL}
          />
        }
      >
        <MessageSquare className='size-[1.15rem]' aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        side='top'
        sideOffset={8}
        className='min-w-64 z-[80]'
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
      <DropdownMenuContent align='end' side='top' sideOffset={8} className='z-[80]'>
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

/** 搜索球:唯一留在中 Dock 的固定功能 */
function SearchBall() {
  const { setOpen: setSearchOpen } = useSearch()
  const { t } = useTranslation()

  return (
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
  )
}

/** 右下工具簇(横排类 Dock):公告/语言/预设/主题/头像/快速导航 */
function DockTools() {
  const notifications = useNotifications()
  const osNavigate = useOsShellNavigate()
  const { t } = useTranslation()

  return (
    <nav
      aria-label='Dock Tools'
      className='bg-popover/70 border-border/60 fixed right-3 bottom-3 z-[70] flex items-end gap-1 rounded-2xl border px-2 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] backdrop-blur-[8px] saturate-150'
    >
      {/* 快速导航(链接聚合) */}
      <NavJumpGroup />

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

      {/* 聊天预设(第三方接入) */}
      <ChatPresetsBall />

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

    </nav>
  )
}

export function OsDock() {
  const items = useOsNavItems()
  const [hovered, setHovered] = useState<string | null>(null)
  const {
    windows,
    activeId,
    activateWindow,
    restoreWindow,
    requestMinimizeWindow,
  } = useOsWindowsStore()

  const DOT_CLS = {
    active: 'bg-foreground size-1.5',
    minimized: 'bg-muted-foreground/40 size-1',
    running: 'bg-muted-foreground/70 size-1',
  } as const

  const onDockClick = (id: string) => {
    const win = windows.find((w) => w.id === id)
    if (!win) return
    if (win.minimized) {
      restoreWindow(win.id)
      return
    }
    if (win.id === activeId) {
      requestMinimizeWindow(win.id)
      return
    }
    activateWindow(win.id)
  }

  return (
    <>
      <DockTools />
      <nav
      aria-label='Dock'
      className='bg-popover/70 border-border/60 fixed bottom-3 left-1/2 z-[70] flex -translate-x-1/2 items-end gap-1 rounded-2xl border px-2 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] backdrop-blur-[8px] saturate-150'
    >
      <SearchBall />

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
            // 运行状态点:查表消除嵌套三元
            let dotKey: keyof typeof DOT_CLS = 'running'
            if (win.minimized) dotKey = 'minimized'
            else if (activeHere) dotKey = 'active'
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
                    DOT_CLS[dotKey]
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
    </>
  )
}
