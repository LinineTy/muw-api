// @muw-owned
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

// 完整 HTML 文档(营销页主题/About/协议/隐私)用 iframe srcdoc 渲染:独立文档上下文,
// html/body/:root 选择器与外链 CSS/JS 均正常,无 FOUC,也不受全局样式污染。
// sandbox 与 URL 模式一致——无 allow-same-origin,iframe 为 opaque origin,
// 主题内脚本无法访问父页面 cookie/localStorage/DOM。
const THEME_FRAME_SANDBOX =
  'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'

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

type ThemeSrcdocFrameProps = {
  content: string
  className?: string
  title?: string
  /** 滚动状态上报(>20px);调用方应传稳定的 setState,用于 PublicHeader 的 scrolledOverride。 */
  onScrolledChange: (scrolled: boolean) => void
  /** 加载后向 iframe 内 postMessage 的偏好(如主题模式/语言),主题可自行监听。 */
  preferences?: { themeMode?: string; lang?: string }
}

export function ThemeSrcdocFrame({
  content,
  className,
  title,
  onScrolledChange,
  preferences,
}: ThemeSrcdocFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeToken = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  ).current

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string
        token?: string
        scrolled?: boolean
      } | null
      if (
        data?.type === 'new-api-theme-scrolled' &&
        data.token === bridgeToken
      ) {
        onScrolledChange(Boolean(data.scrolled))
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [bridgeToken, onScrolledChange])

  const syncPreferences = () => {
    if (!preferences) return
    try {
      const { themeMode, lang } = preferences
      if (themeMode) {
        iframeRef.current?.contentWindow?.postMessage({ themeMode }, '*')
      }
      if (lang) {
        iframeRef.current?.contentWindow?.postMessage({ lang }, '*')
      }
    } catch {
      // Cross-origin frames may reject access while navigating.
    }
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={injectThemeScrollBridge(content, bridgeToken)}
      className={cn('h-screen w-full border-none', className)}
      title={title}
      sandbox={THEME_FRAME_SANDBOX}
      onLoad={syncPreferences}
    />
  )
}
