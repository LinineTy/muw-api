// @muw-owned
import { useEffect } from 'react'

import { extractWallpaperHue } from '@/lib/glass-accent-hue'
import {
  DEFAULT_GLASS_BLUR,
  DEFAULT_GLASS_BRIGHTNESS,
  DEFAULT_GLASS_MASK_OPACITY,
  useSystemConfigStore,
} from '@/stores/system-config-store'

/**
 * 把后台配置的全局背景图写到 body 内联 CSS 变量 --app-bg-photo。
 *
 * 玻璃预设(liquid-glass)的 --app-bg-image 会引用这个变量作为背景层:
 * 管理员配了图则盖在最上层,没配则解析为 none、回落 preset 自带的 aurora 渐变。
 * 非玻璃预设下 --app-bg-image 默认是 none,--app-bg-photo 不会被消费、无副作用。
 *
 * 同时写三个配套变量/标记:
 * - --app-bg-mask-opacity: 背景图遮罩强度(0~0.95),驯服明暗差异较大的照片;
 *   亮色模式用白色遮罩(把照片向白柔和、深色字更清晰)、暗色模式用黑色遮罩,
 *   颜色由 CSS 决定,这里只写强度。强度由管理员在"系统信息"里用滑块配置。
 * - --app-bg-brightness: 背景图整体亮度系数(0.5~1.5),与遮罩分开调节。
 * - --app-bg-blur: 背景图自身模糊强度(0~30px)。这个变量源自写死在
 *   body::before filter 链里的 blur(18px):把它参数化后,管理员把遮罩/亮度/
 *   模糊都调回中性档(0% / 100% / 0px)就能得到未处理的锐利原图。
 * - data-has-bg-photo: 有配图时挂到 body,通知 CSS 在照片层上方插入遮罩层;
 *   无配图时移除,避免遮罩压到 preset 自带的 aurora 渐变上。
 *
 * 写在 body 内联样式而非组件上,是为了避免 React 更新周期参与一次性的 CSS 变量写入。
 */
function toCssUrl(value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return 'none'
  // 管理员输入的 URL 走 background-image 不会执行脚本;仍转义引号/反斜杠防 CSS 注入。
  return `url("${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
}

/** 遮罩强度收敛到 [0, 0.95];非法值回落默认,保证 --app-bg-mask-opacity 永远可解析 */
function clampMaskOpacity(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_GLASS_MASK_OPACITY
  }
  return Math.min(0.95, Math.max(0, value))
}

/** 亮度系数收敛到 [0.5, 1.5](对应滑块 50%~150%);非法值回落默认 */
function clampBrightness(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_GLASS_BRIGHTNESS
  }
  return Math.min(1.5, Math.max(0.5, value))
}

/** 模糊强度收敛到 [0, 30](px);非法值回落默认 */
function clampBlur(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_GLASS_BLUR
  }
  return Math.min(30, Math.max(0, value))
}

export function useAppBackground() {
  const backgroundImage = useSystemConfigStore(
    (state) => state.config.backgroundImage
  )
  const glassMaskOpacity = useSystemConfigStore(
    (state) => state.config.glassMaskOpacity
  )
  const glassBrightness = useSystemConfigStore(
    (state) => state.config.glassBrightness
  )
  const glassBlur = useSystemConfigStore((state) => state.config.glassBlur)

  useEffect(() => {
    const body = document.body
    body.style.setProperty('--app-bg-photo', toCssUrl(backgroundImage))
    body.style.setProperty(
      '--app-bg-mask-opacity',
      String(clampMaskOpacity(glassMaskOpacity))
    )
    body.style.setProperty(
      '--app-bg-brightness',
      String(clampBrightness(glassBrightness))
    )
    body.style.setProperty('--app-bg-blur', `${clampBlur(glassBlur)}px`)
    if (backgroundImage?.trim()) {
      body.setAttribute('data-has-bg-photo', '')
    } else {
      body.removeAttribute('data-has-bg-photo')
    }
    return () => {
      body.style.removeProperty('--app-bg-photo')
      body.style.removeProperty('--app-bg-mask-opacity')
      body.style.removeProperty('--app-bg-brightness')
      body.style.removeProperty('--app-bg-blur')
      body.removeAttribute('data-has-bg-photo')
    }
  }, [backgroundImage, glassMaskOpacity, glassBrightness, glassBlur])

  /**
   * 琉璃主题的按钮色随壁纸色相走：把 --glass-primary-hue 写到 body 内联样式，
   * 预设里的 --primary/--ring 用 var(--glass-primary-hue, 250) 消费它。
   * 取不到颜色（没配图 / 灰图 / 加载失败 / 跨域污染）就把变量摘掉，回落到默认蓝。
   * 壁纸换了（backgroundImage 变）自然重算；同一张图有缓存，不会重复解码。
   */
  useEffect(() => {
    const body = document.body
    const url = backgroundImage?.trim()
    if (!url) {
      body.style.removeProperty('--glass-primary-hue')
      return
    }
    let cancelled = false
    void (async () => {
      const hue = await extractWallpaperHue(url)
      if (cancelled) return
      if (hue == null) {
        body.style.removeProperty('--glass-primary-hue')
        return
      }
      body.style.setProperty('--glass-primary-hue', String(Math.round(hue)))
    })()
    return () => {
      cancelled = true
      body.style.removeProperty('--glass-primary-hue')
    }
  }, [backgroundImage])
}
