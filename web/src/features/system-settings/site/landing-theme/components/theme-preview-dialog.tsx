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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { getLandingTheme } from '../api'

// 与公开营销页同一 sandbox:无 allow-same-origin,预览时主题内脚本也摸不到父页面数据。
const PREVIEW_IFRAME_SANDBOX =
  'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'

type ThemePreviewDialogProps = {
  themeId: string | null
  onOpenChange: (open: boolean) => void
}

export function ThemePreviewDialog({
  themeId,
  onOpenChange,
}: ThemePreviewDialogProps) {
  const { t } = useTranslation()

  const contentQuery = useQuery({
    queryKey: ['landing-theme', 'detail', themeId],
    queryFn: async () => {
      if (!themeId) return undefined
      const res = await getLandingTheme(themeId)
      if (!res.success || !res.data) {
        throw new Error(res.message || t('Failed to load theme'))
      }
      return res.data.content
    },
    enabled: Boolean(themeId),
    retry: false,
  })

  const open = Boolean(themeId)

  let previewArea
  if (contentQuery.isLoading) {
    previewArea = <Skeleton className='h-[50vh] w-full rounded-none' />
  } else if (contentQuery.isError || !contentQuery.data) {
    previewArea = (
      <div className='flex h-[50vh] items-center justify-center text-sm text-muted-foreground'>
        {t('Failed to load theme')}
      </div>
    )
  } else {
    previewArea = (
      <iframe
        srcDoc={contentQuery.data}
        title={t('Theme preview')}
        className='h-[70vh] w-full border-none'
        sandbox={PREVIEW_IFRAME_SANDBOX}
      />
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onOpenChange(false)
        }
      }}
    >
      <DialogContent className='max-w-[min(56rem,calc(100%-2rem))]'>
        <DialogHeader>
          <DialogTitle>{t('Preview Theme')}</DialogTitle>
        </DialogHeader>
        <div className='max-h-[70vh] min-h-[50vh] overflow-hidden rounded-md border'>
          {previewArea}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='outline' />}>
            {t('Close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
