/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnnouncementDialog } from '@/components/announcement-dialog'
import { AppLoading } from '@/components/app-loading'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { RichContent } from '@/components/rich-content'
import { ThemeSrcdocFrame } from '@/components/theme-srcdoc-frame'
import { useTheme } from '@/context/theme-provider'
import { useAppLoadingGate } from '@/hooks'
import { splashBootRoundPlayed } from '@/lib/app-loading'
import { isFullHtmlDocument, isLikelyHtml } from '@/lib/content-format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { CTA, Features, Hero, HowItWorks, Stats } from './components'
import { useAnnouncementDialog, useHomePageContent } from './hooks'

export function Home() {
  const { i18n, t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { resolvedTheme } = useTheme()
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user
  const { content, isLoaded, isUrl } = useHomePageContent()
  const announcementDialog = useAnnouncementDialog()
  const isFullDocument = isFullHtmlDocument(content)
  const [themeScrolled, setThemeScrolled] = useState(false)

  const syncIframePreferences = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { themeMode: resolvedTheme },
        '*'
      )
      iframeRef.current?.contentWindow?.postMessage(
        { lang: i18n.language },
        '*'
      )
    } catch {
      // Cross-origin frames may reject access while navigating.
    }
  }, [i18n.language, resolvedTheme])

  useEffect(() => {
    if (isUrl) {
      syncIframePreferences()
    }
  }, [isUrl, syncIframePreferences])

  // 首屏占位里那一轮逐字上浮要走完才放行(见 useAppLoadingGate);首页内容就绪但这一轮没完时继续挂着
  const roundReleased = useAppLoadingGate(!isLoaded)
  // 外链首页是 iframe 加载的:等它 onLoad(真的画出来了)再交接,
  // 否则占位一撤、iframe 还是白的,看着就是"空一下又刷出来"。8s 兜底防挂死。
  const [frameLoaded, setFrameLoaded] = useState(false)
  useEffect(() => {
    if (!isUrl || frameLoaded) return
    const timer = window.setTimeout(() => setFrameLoaded(true), 8000)
    return () => window.clearTimeout(timer)
  }, [isUrl, frameLoaded])
  const ready = isLoaded && roundReleased && (!isUrl || frameLoaded)

  // 占位的进出场:
  // - 接续首屏那一轮时,名字**此刻已经在屏上**,浮层直接以不透明就位,绝不能淡入
  //   (淡入 = 名字先淡出再淡入,快网下就是肉眼可见的一闪)
  // - 内容就绪后再让占位淡出 320ms 才卸载,交接做成交叉淡化
  const bootPlayed = splashBootRoundPlayed()
  const [entered, setEntered] = useState(bootPlayed)
  const [splashGone, setSplashGone] = useState(false)
  useEffect(() => {
    if (bootPlayed) return
    const raf = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(raf)
  }, [bootPlayed])
  useEffect(() => {
    if (!ready) {
      setSplashGone(false)
      return
    }
    const timer = window.setTimeout(() => setSplashGone(true), 320)
    return () => window.clearTimeout(timer)
  }, [ready])
  const splashVisible = !ready || !splashGone
  const splashLeaving = ready && !splashGone

  const renderBody = () => {
    if (!ready) {
      // 内容还没就绪:先用空白版面撑住,占位作为浮层盖在上面(与首屏内联那份视觉一致)
      return (
        <PublicLayout showMainContainer={false}>
          <div className='min-h-screen' />
        </PublicLayout>
      )
    }

    if (content) {
      if (isUrl) {
        return (
          <PublicLayout showMainContainer={false}>
            {/*
              allow-top-navigation-by-user-activation: the custom home page URL is
              admin-configured (trusted); this lets its target="_top" nav/menu links
              navigate the top-level window on user click. The default sandbox blocks
              this on desktop, while some mobile browsers allow it via allow-popups,
              causing inconsistent behavior. This token only permits user-activated
              top-level navigation and does NOT grant same-origin access.
            */}
            <iframe
              ref={iframeRef}
              src={content}
              className='h-screen w-full border-none'
              title={t('Custom Home Page')}
              sandbox='allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'
              onLoad={() => {
                syncIframePreferences()
                setFrameLoaded(true)
              }}
            />
          </PublicLayout>
        )
      }

      if (isFullDocument) {
        return (
          <PublicLayout
            showMainContainer={false}
            headerScrolled={themeScrolled}
          >
            {/*
              完整 HTML 文档(导入的营销页主题或手填的完整页面)用 iframe srcdoc 渲染,
              见 ThemeSrcdocFrame:独立文档上下文 + sandbox 隔离 + 顶栏滚动联动。
            */}
            <ThemeSrcdocFrame
              content={content}
              title={t('Custom Home Page')}
              onScrolledChange={setThemeScrolled}
              preferences={{ themeMode: resolvedTheme, lang: i18n.language }}
            />
          </PublicLayout>
        )
      }

      const contentIsHtml = isLikelyHtml(content)

      if (contentIsHtml) {
        return (
          <PublicLayout showMainContainer={false}>
            <RichContent
              mode='html'
              htmlVariant='isolated'
              content={content}
              className='custom-home-content'
            />
          </PublicLayout>
        )
      }

      return (
        <PublicLayout>
          <div className='mx-auto max-w-6xl px-4 py-8'>
            <RichContent
              mode='markdown'
              content={content}
              className='custom-home-content'
            />
          </div>
        </PublicLayout>
      )
    }

    return (
      <PublicLayout showMainContainer={false}>
        <Hero isAuthenticated={isAuthenticated} />
        <Stats />
        <Features />
        <HowItWorks />
        <CTA isAuthenticated={isAuthenticated} />
        <Footer />
      </PublicLayout>
    )
  }

  return (
    <>
      <AnnouncementDialog
        open={announcementDialog.open}
        onOpenChange={announcementDialog.setOpen}
        notice={announcementDialog.notice}
        onDismiss={announcementDialog.dismiss}
        countdownSeconds={announcementDialog.countdownSeconds}
      />
      {renderBody()}
      {splashVisible && (
        <div
          className={cn(
            'pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background px-6 transition-opacity duration-300 ease-out',
            entered && !splashLeaving ? 'opacity-100' : 'opacity-0'
          )}
        >
          <AppLoading />
        </div>
      )}
    </>
  )
}
