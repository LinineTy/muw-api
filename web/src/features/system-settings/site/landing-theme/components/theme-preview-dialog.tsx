// @muw-owned
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isHttpUrl } from '@/lib/content-format'

import { getLandingTheme } from '../api'
import type { LandingTheme } from '../types'

// 与公开页面同一 sandbox:无 allow-same-origin,预览时脚本摸不到父页面数据。
const PREVIEW_IFRAME_SANDBOX =
  'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'

const PAGE_TABS: { key: keyof LandingTheme; labelKey: string }[] = [
  { key: 'content', labelKey: 'Home' },
  { key: 'about', labelKey: 'About' },
  { key: 'user_agreement', labelKey: 'User Agreement' },
  { key: 'privacy_policy', labelKey: 'Privacy Policy' },
]

type ThemePreviewDialogProps = {
  themeId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ThemePreviewDialog({
  themeId,
  open,
  onOpenChange,
}: ThemePreviewDialogProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] =
    useState<(typeof PAGE_TABS)[number]['key']>('content')

  const themeQuery = useQuery({
    queryKey: ['landing-theme', 'detail', themeId],
    queryFn: async () => {
      if (!themeId) return undefined
      const res = await getLandingTheme(themeId)
      if (!res.success || !res.data) {
        throw new Error(res.message || t('Failed to load theme'))
      }
      return res.data
    },
    enabled: Boolean(themeId) && open,
    retry: false,
  })

  const content = (themeQuery.data?.[activeTab] as string | undefined) ?? ''
  const isUrl = isHttpUrl(content.trim())

  let previewArea
  if (themeQuery.isLoading) {
    previewArea = <Skeleton className='h-[70vh] w-full rounded-none' />
  } else if (themeQuery.isError || !themeQuery.data) {
    previewArea = (
      <div className='text-muted-foreground flex h-[70vh] items-center justify-center text-sm'>
        {t('Failed to load theme')}
      </div>
    )
  } else if (!content) {
    previewArea = (
      <div className='text-muted-foreground flex h-[70vh] items-center justify-center text-sm'>
        {t('This page is not covered by the theme.')}
      </div>
    )
  } else if (isUrl) {
    previewArea = (
      <iframe
        src={content}
        title={t('Theme preview')}
        className='h-[70vh] w-full border-none'
        sandbox={PREVIEW_IFRAME_SANDBOX}
      />
    )
  } else {
    previewArea = (
      <iframe
        srcDoc={content}
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
      <DialogContent className='max-w-[min(56rem,calc(100%-2rem))] sm:max-w-[min(56rem,calc(100%-2rem))]'>
        <DialogHeader>
          <DialogTitle>{t('Preview Theme')}</DialogTitle>
        </DialogHeader>

        {/* 页面切换 */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as (typeof PAGE_TABS)[number]['key'])
          }}
        >
          <TabsList
            aria-label={t('Preview pages')}
            className='grid w-full grid-cols-2 sm:grid-cols-4'
          >
            {PAGE_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent
            value={activeTab}
            className='max-h-[70vh] overflow-hidden rounded-md border'
          >
            {previewArea}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <DialogClose render={<Button variant='outline' />}>
            {t('Close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
