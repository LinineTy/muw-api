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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

import { isVideoExt } from '../lib/media'
import type { ImageAsset } from '../types'
import { DeleteImageDialog } from './delete-image-dialog'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

type ImageCardProps = {
  image: ImageAsset
}

// 画廊网格卡片:4:3 缩略图占满格子,悬浮(移动端常显)显示复制/删除。
// 视频按扩展名渲染 <video>,图片渲染 <img>。
export function ImageCard({ image }: ImageCardProps) {
  const { t } = useTranslation()
  // 主题在 srcdoc iframe 中渲染,相对路径解析不了,复制绝对 URL。
  const absoluteUrl = `${window.location.origin}${image.url}`
  const isVideo = isVideoExt(image.ext)

  return (
    <Card size='sm' className='group overflow-hidden'>
      <CardContent className='p-0'>
        <div className='bg-muted/30 relative aspect-[4/3] overflow-hidden'>
          {isVideo ? (
            <video
              src={image.url}
              controls
              muted
              playsInline
              preload='metadata'
              className='h-full w-full object-cover'
            />
          ) : (
            <img
              src={image.url}
              alt={image.name}
              className='h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]'
            />
          )}
          {isVideo && (
            <Badge
              variant='secondary'
              className='bg-background/85 absolute top-1.5 left-1.5 text-[10px] font-medium shadow-sm backdrop-blur-sm'
            >
              {t('Video')}
            </Badge>
          )}
          <div className='bg-background/85 absolute top-1.5 right-1.5 flex items-center gap-1 rounded-lg p-0.5 opacity-100 shadow-sm backdrop-blur-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100'>
            <CopyButton
              value={absoluteUrl}
              size='icon'
              className='size-7'
              tooltip={t('Copy URL')}
              successTooltip={t('URL copied')}
              aria-label={t('Copy URL')}
            />
            <DeleteImageDialog imageId={image.id} name={image.name} />
          </div>
        </div>
        <div className='flex items-center justify-between gap-2 p-2'>
          <p
            className='min-w-0 truncate text-xs font-medium'
            title={image.name}
          >
            {image.name}
          </p>
          <span className='text-muted-foreground shrink-0 text-[10px]'>
            {formatBytes(image.size)}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
