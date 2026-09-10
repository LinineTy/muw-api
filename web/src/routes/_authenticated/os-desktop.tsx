import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { MonitorX } from 'lucide-react'
// @muw-owned
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useIsMobile } from '@/hooks/use-mobile'

/**
 * 窄屏提示页停留多久后自动回概览。
 * ⚠️ 文案里写到了这个秒数（`os-shell.desktop-only-hint`，7 种语言），改这里要同步改文案。
 */
const DESKTOP_ONLY_REDIRECT_MS = 5000

/**
 * OS 桌面壳的桌面路由(空桌面态)。
 *
 * 这个路由本身**不渲染任何内容**是设计的一部分：
 * 桌面端由 AuthenticatedLayout 走 OS 壳分支(OsShellDesktopHost)渲染窗口层+Dock,
 * 路由 children 在那条分支里不被使用;窄屏/手机不挂壳,才会落到本组件,
 * 此时给一张"仅桌面端可用"的提示,几秒后自动回概览(也可手动点按钮)。
 *
 * 存在的意义是给桌面一个**独立路径**(不再和 /dashboard 概览共用):
 * 刷新、深链、从设置页返回三种情况都不会再误判成"要开概览窗"。
 */
export const Route = createFileRoute('/_authenticated/os-desktop')({
  component: OsDesktopRoute,
})

function OsDesktopRoute() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { t } = useTranslation()

  // 窄屏:提示页停留几秒后自动回概览,省得用户还要手点一次
  useEffect(() => {
    if (!isMobile) {
      return
    }
    const timer = window.setTimeout(() => {
      void navigate({ to: '/dashboard', replace: true })
    }, DESKTOP_ONLY_REDIRECT_MS)
    return () => window.clearTimeout(timer)
  }, [isMobile, navigate])

  // 桌面端:桌面已由壳宿主渲染,这里什么都不渲染
  if (!isMobile) return null

  return (
    <div className='flex min-h-[60svh] flex-col items-center justify-center gap-4 p-6 text-center'>
      <MonitorX className='text-muted-foreground size-10' aria-hidden='true' />
      <div className='space-y-1.5'>
        <p className='text-base font-medium'>
          {t('os-shell.desktop-only-title')}
        </p>
        <p className='text-muted-foreground max-w-xs text-sm'>
          {t('os-shell.desktop-only-hint')}
        </p>
      </div>
      <Link
        to='/dashboard'
        className='bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium transition-colors'
      >
        {t('os-shell.go-to-overview')}
      </Link>
    </div>
  )
}
