// @muw-owned
/**
 * OS 壳窗口主题同步:
 * 每个窗口是独立 iframe 文档,主层切主题(亮暗/预设/字体/圆角/缩放/布局)不会
 * 传播到已打开的 iframe,需要主动镜像过去。CSS 变量定义在各文档共享的样式表里,
 * 同步 documentElement 的 light/dark class + body 的 data-theme-* 属性即生效。
 * 由 ThemeProvider / ThemeCustomizationProvider 在应用主题属性后调用;
 * 不传参时自动读取主层当前状态。
 */

const THEME_ATTRS = [
  'data-theme-preset',
  'data-theme-font',
  'data-theme-radius',
  'data-theme-scale',
  'data-theme-content-layout',
] as const

/** 遍历 OS 壳全部窗口 iframe(含最小化保活的),把主层主题镜像到其文档 */
export function syncOsWindowThemes(resolvedTheme?: 'light' | 'dark') {
  if (typeof document === 'undefined') return
  const theme =
    resolvedTheme ??
    (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  const frames = document.querySelectorAll<HTMLIFrameElement>(
    'iframe[data-os-window-id]'
  )
  frames.forEach((frame) => {
    try {
      const doc = frame.contentDocument
      if (!doc?.documentElement || !doc.body) return
      doc.documentElement.classList.remove('light', 'dark')
      doc.documentElement.classList.add(theme)
      for (const attr of THEME_ATTRS) {
        const val = document.body.getAttribute(attr)
        if (val) doc.body.setAttribute(attr, val)
        else doc.body.removeAttribute(attr)
      }
    } catch {
      /* 理论上同源不会抛,防御性忽略 */
    }
  })
}

/**
 * 把界面语言镜像到 OS 壳全部窗口 iframe(含最小化保活的)。
 * iframe 是独立文档、独立 i18n 实例,主层 changeLanguage 不会传播;
 * 通过 postMessage 通知(iframe 侧在 i18n/config.ts 监听并切语言)。
 */
export function syncOsWindowLanguages(lang: string) {
  if (typeof document === 'undefined') return
  document
    .querySelectorAll<HTMLIFrameElement>('iframe[data-os-window-id]')
    .forEach((frame) => {
      try {
        frame.contentWindow?.postMessage(
          { type: 'muw:sync-language', lang },
          window.location.origin
        )
      } catch {
        /* 跨域/已卸载防御性忽略 */
      }
    })
}
