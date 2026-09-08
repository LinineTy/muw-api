// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { Check, Eye, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { getLandingTheme } from '../api'
import { DeleteThemeDialog } from './delete-theme-dialog'
import { ThemePreviewDialog } from './theme-preview-dialog'
import { ThemeThumbnail } from './theme-thumbnail'

const PAGE_SLUG_LABELS: Record<string, string> = {
  home: 'Home',
  about: 'About',
  user_agreement: 'User Agreement',
  privacy_policy: 'Privacy Policy',
}

type ThemeCardProps = {
  name: string
  selected: boolean
  /** 缩略图 data URI(来自 zip 内 preview 图);缺省走实时渲染或占位。 */
  preview?: string
  pages?: string[]
  /** 版本描述(来自 zip 内 version.txt),右下角纯文本展示。 */
  version?: string
  /** 导入主题的 id,用于预览/删除;缺省(Default/手动)不显示。 */
  previewId?: string
  onSelect: () => void
  onEdit?: () => void
}

export function ThemeCard({
  name,
  selected,
  preview,
  pages = [],
  version,
  previewId,
  onSelect,
  onEdit,
}: ThemeCardProps) {
  const { t } = useTranslation()
  const [showPreview, setShowPreview] = useState(false)

  // 无静态缩略图的导入主题:拉取首页内容做实时迷你渲染(自动缩略图)。
  // 与预览弹窗共用同一个 detail 缓存,打开预览时不再重复请求。
  const themeDetail = useQuery({
    queryKey: ['landing-theme', 'detail', previewId],
    queryFn: async () => {
      if (!previewId) return undefined
      const res = await getLandingTheme(previewId)
      if (!res.success || !res.data) {
        throw new Error(res.message || t('Failed to load theme'))
      }
      return res.data
    },
    enabled: Boolean(previewId) && !preview,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  return (
    <>
      <Card size='sm' className={cn(selected && 'ring-primary/20')}>
        <CardContent className='flex items-stretch gap-3'>
          <ThemeThumbnail
            name={name}
            preview={preview}
            content={themeDetail.data?.content}
            contentLoading={themeDetail.isLoading}
            className='h-28 w-44'
          />

          <div className='flex min-w-0 flex-1 flex-col'>
            {/* 第一排:名称 + 已启用 | 图标按钮 */}
            <div className='flex items-center justify-between gap-2'>
              <div className='flex min-w-0 items-center gap-1.5'>
                <p className='truncate text-sm font-medium'>{name}</p>
                {selected && <Badge>{t('Enabled')}</Badge>}
              </div>
              <div className='flex shrink-0 items-center gap-0.5'>
                {!selected && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    onClick={onSelect}
                    aria-label={t('Enable theme')}
                  >
                    <Check className='size-4' aria-hidden='true' />
                  </Button>
                )}
                {onEdit && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    onClick={onEdit}
                    aria-label={t('Edit')}
                  >
                    <Pencil className='size-4' aria-hidden='true' />
                  </Button>
                )}
                {previewId && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => setShowPreview(true)}
                    aria-label={t('Preview')}
                  >
                    <Eye className='size-4' aria-hidden='true' />
                  </Button>
                )}
                {previewId && (
                  <DeleteThemeDialog themeId={previewId} name={name} />
                )}
              </div>
            </div>

            {/* 第二排:覆盖页面 + 页面标签 */}
            {pages.length > 0 && (
              <div className='mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1'>
                <span className='text-muted-foreground text-xs'>
                  {t('Covered Pages')}
                </span>
                <div className='flex flex-wrap gap-1'>
                  {pages.map((slug) => (
                    <Badge
                      key={slug}
                      variant='secondary'
                      className='text-[10px]'
                    >
                      {t(PAGE_SLUG_LABELS[slug] ?? slug)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* 底部:版本,右下角纯文本 */}
            {version && (
              <div className='mt-auto flex justify-end'>
                <span className='text-muted-foreground text-xs'>{version}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {previewId && (
        <ThemePreviewDialog
          themeId={previewId}
          onOpenChange={(open) => {
            if (!open) setShowPreview(false)
          }}
          open={showPreview}
        />
      )}
    </>
  )
}
