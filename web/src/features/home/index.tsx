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
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { RichContent } from '@/components/rich-content'
import { useTheme } from '@/context/theme-provider'
import { isFullHtmlDocument, isLikelyHtml } from '@/lib/content-format'
import { useAuthStore } from '@/stores/auth-store'

import { CTA, Features, Hero, HowItWorks, Stats } from './components'
import { useAnnouncementDialog, useHomePageContent } from './hooks'

// srcdoc iframe 滚动桥接:沙箱(无 allow-same-origin)下父页面读不到 iframe 内部
// scrollY,由注入的主题内脚本把"是否已滚过阈值"通过 postMessage 报给父页面,
// 驱动 PublicHeader 的滚动缩短效果(见 public-header.tsx scrolledOverride)。
// token 用于来源校验:sandbox opaque origin 下 event.source 的引用比较不可靠
// (浏览器可能给出不同的受限代理对象),改为父页面生成随机 token 注入脚本、汇报时
// 带回,父页面按 token 匹配——token 只存在于本次注入的 srcdoc,其他来源无法伪造。
function buildThemeScrollBridge(token: string): string {
  return [
    '<script>',
    '(function () {',
    `  var token = ${JSON.stringify(token)};`,
    '  var ticking = false;',
    // 同时覆盖 window 滚动与内部滚动容器(html/body overflow hidden + 内层 div 滚动):
    // scroll 事件不冒泡,但在 document 上 capture 阶段可以捕获任意元素的滚动,
    // 取滚动目标自身的 scrollTop 判断是否越过阈值。
    '  function report(scrolled) {',
    '    ticking = false;',
    '    window.parent.postMessage({ type: "new-api-theme-scrolled", token: token, scrolled: !!scrolled }, "*");',
    '  }',
    '  function requestReport(scrolled) {',
    '    if (ticking) return;',
    '    ticking = true;',
    // 沙箱 iframe 里 requestAnimationFrame 在部分环境下不触发(无头/后台标签),
    // 用 setTimeout 合并高频滚动事件,保证上报一定执行。
    '    setTimeout(function () { ticking = false; report(scrolled); }, 0);',
    '  }',
    '  function onScroll(event) {',
    '    var el = event.target;',
    '    var amount = (el === document || el === document.documentElement || el === document.body)',
    '      ? window.scrollY',
    '      : (el && el.scrollTop) || 0;',
    '    requestReport(amount > 20);',
    '  }',
    '  function onLoad() { onScroll({ target: document }); }',
    '  if (document.readyState === "complete") { onLoad(); }',
    '  else { window.addEventListener("load", onLoad); }',
    '  document.addEventListener("scroll", onScroll, { passive: true, capture: true });',
    '})();',
    '</script>',
  ].join('\n')
}

// 完整 HTML 文档可能不带 <body> 标签;桥接脚本注入到真实的 </body> 前(或追加在末尾)。
// 注意:模板头部注释里常出现 "</body>" 字样(如部署说明),不能用 replace 匹配第一个
// 匹配,否则会把脚本插进注释里被浏览器忽略;用 lastIndexOf 定位最后一个(真实的)闭合标签。
function injectThemeScrollBridge(html: string, token: string): string {
  const bridge = buildThemeScrollBridge(token)
  const idx = html.toLowerCase().lastIndexOf('</body>')
  if (idx === -1) {
    return `${html}\n${bridge}`
  }
  return `${html.slice(0, idx)}${bridge}\n${html.slice(idx)}`
}

export function Home() {
  const { i18n, t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeToken = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  ).current
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
    if (isUrl || isFullDocument) {
      syncIframePreferences()
    }
  }, [isUrl, isFullDocument, syncIframePreferences])

  // 监听主题 iframe 的滚动状态上报(桥接脚本发出),驱动顶栏缩短效果。
  useEffect(() => {
    if (!isFullDocument) return
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; token?: string; scrolled?: boolean }
        | null
      if (
        data?.type === 'new-api-theme-scrolled' &&
        data.token === bridgeToken
      ) {
        setThemeScrolled(Boolean(data.scrolled))
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [isFullDocument, bridgeToken])

  const renderBody = () => {
    if (!isLoaded) {
      return (
        <PublicLayout showMainContainer={false}>
          <main className='flex min-h-screen items-center justify-center'>
            <div className='text-muted-foreground'>{t('Loading...')}</div>
          </main>
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
              onLoad={syncIframePreferences}
            />
          </PublicLayout>
        )
      }

      if (isFullDocument) {
        return (
          <PublicLayout showMainContainer={false} headerScrolled={themeScrolled}>
            {/*
              完整 HTML 文档(导入的营销页主题或手填的完整页面)用 iframe srcdoc 渲染:
              独立文档上下文,html/body/:root 选择器与外链 CSS/JS 均正常,无 FOUC,
              也不受全局样式污染。sandbox 与 URL 模式一致——无 allow-same-origin,
              iframe 为 opaque origin,主题内脚本无法访问父页面 cookie/localStorage/DOM。
              滚动发生在 iframe 内部,由桥接脚本把滚动状态报给父页面驱动顶栏缩短。
            */}
            <iframe
              ref={iframeRef}
              srcDoc={injectThemeScrollBridge(content, bridgeToken)}
              className='h-screen w-full border-none'
              title={t('Custom Home Page')}
              sandbox='allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'
              onLoad={syncIframePreferences}
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
    </>
  )
}
