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
import { LayoutTemplate } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { isHttpUrl } from '@/lib/content-format'
import { cn } from '@/lib/utils'

// 缩略图按固定逻辑尺寸渲染主题首页,再等比缩到容器宽度——这就是"自动缩略图":
// 不需要用户手动截图,卡片里直接是主题页面的真实迷你渲染,永远和主题一致。
// 逻辑尺寸取 ~960 宽的首屏,既能反映桌面布局,又比 1280 轻。
const THUMB_LOGICAL_WIDTH = 960
const THUMB_LOGICAL_HEIGHT = 600

// 与公开页/预览弹窗同一 sandbox:无 allow-same-origin,缩略图内脚本摸不到父页面。
const THUMB_SANDBOX =
  'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'

// 主题首页内容缩放渲染成迷你截图。内容若是 http(s) URL 则直接 iframe 外链,
// 否则是完整 HTML,用 srcdoc 渲染。pointer-events-none 保证缩略图不可交互。
function ScaledThemeFrame({
  content,
  title,
}: {
  content: string
  title: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      setScale(el.clientWidth / THUMB_LOGICAL_WIDTH)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (isHttpUrl(content.trim())) {
    return (
      <iframe
        src={content}
        title={title}
        scrolling='no'
        className='pointer-events-none h-full w-full border-0'
        sandbox={THUMB_SANDBOX}
      />
    )
  }

  return (
    <div ref={containerRef} className='relative h-full w-full overflow-hidden'>
      {scale > 0 && (
        <iframe
          srcDoc={content}
          title={title}
          scrolling='no'
          className='pointer-events-none absolute top-0 left-0 border-0'
          sandbox={THUMB_SANDBOX}
          style={{
            width: THUMB_LOGICAL_WIDTH,
            height: THUMB_LOGICAL_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        />
      )}
    </div>
  )
}

type ThemeThumbnailProps = {
  /** 主题名,作为缩略图/iframe 的 alt/title。 */
  name: string
  /** 静态缩略图(data URI,来自 zip 内 preview 图);无则走实时渲染或占位。 */
  preview?: string
  /** 主题首页 HTML/URL,无 preview 时实时渲染用。 */
  content?: string
  /** 正在拉取 content 时显示骨架。 */
  contentLoading?: boolean
  /** 容器尺寸,由父级传入(如 h-24 w-40)。 */
  className?: string
}

export function ThemeThumbnail({
  name,
  preview,
  content,
  contentLoading,
  className,
}: ThemeThumbnailProps) {
  const boxClass = cn(
    'bg-muted/40 relative shrink-0 overflow-hidden rounded-md border',
    className
  )

  if (preview) {
    return (
      <div className={boxClass}>
        <img src={preview} alt={name} className='size-full object-cover' />
      </div>
    )
  }

  if (content) {
    return (
      <div className={boxClass}>
        <ScaledThemeFrame content={content} title={name} />
      </div>
    )
  }

  if (contentLoading) {
    return <Skeleton className={cn('shrink-0 rounded-md', className)} />
  }

  return (
    <div className={cn(boxClass, 'flex items-center justify-center')}>
      <LayoutTemplate
        className='text-muted-foreground size-5'
        aria-hidden='true'
      />
    </div>
  )
}
