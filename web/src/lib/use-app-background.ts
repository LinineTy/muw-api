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
import { useEffect } from 'react'

import {
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
    if (backgroundImage?.trim()) {
      body.setAttribute('data-has-bg-photo', '')
    } else {
      body.removeAttribute('data-has-bg-photo')
    }
    return () => {
      body.style.removeProperty('--app-bg-photo')
      body.style.removeProperty('--app-bg-mask-opacity')
      body.style.removeProperty('--app-bg-brightness')
      body.removeAttribute('data-has-bg-photo')
    }
  }, [backgroundImage, glassMaskOpacity, glassBrightness])
}
