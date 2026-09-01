// @muw-owned
import { Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { downloadThemeTemplate } from '../theme-template'

type ThemeHelpDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ThemeHelpDialog({ open, onOpenChange }: ThemeHelpDialogProps) {
  const { t } = useTranslation()
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      await downloadThemeTemplate()
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('How to make a theme')}</DialogTitle>
          <DialogDescription>
            {t(
              'A theme is a ZIP archive that covers up to four public pages. Download the template, edit the pages, and import the ZIP back here.'
            )}
          </DialogDescription>
        </DialogHeader>

        <Button
          type='button'
          onClick={handleDownload}
          disabled={downloading}
          className='w-full'
        >
          <Download
            data-icon='inline-start'
            className='size-4'
            aria-hidden='true'
          />
          {downloading
            ? t('Preparing template...')
            : t('Download theme template')}
        </Button>

        <div className='space-y-4'>
          <section className='space-y-1'>
            <h4 className='text-sm font-semibold'>{t('Structure')}</h4>
            <ul className='text-muted-foreground list-disc space-y-1 pl-5 text-sm'>
              <li>
                {t(
                  'Fixed page files: home.html, about.html, agreement.html, privacy.html (only home.html is required).'
                )}
              </li>
              <li>
                {t(
                  'Optional preview.{png,jpg,jpeg,webp} shows as the card thumbnail; without it the card automatically renders a live thumbnail of the home page.'
                )}
              </li>
              <li>
                {t(
                  'Optional version.txt shows the version in the card corner.'
                )}
              </li>
            </ul>
          </section>

          <section className='space-y-1'>
            <h4 className='text-sm font-semibold'>{t('Limits')}</h4>
            <p className='text-muted-foreground text-sm'>
              {t('ZIP ≤ 2MB, each page ≤ 500KB, preview image ≤ 200KB.')}
            </p>
          </section>

          <section className='space-y-1'>
            <h4 className='text-sm font-semibold'>{t('Tips')}</h4>
            <ul className='text-muted-foreground list-disc space-y-1 pl-5 text-sm'>
              <li>
                {t(
                  'Pages can be full HTML documents; external CSS and JS are allowed and rendered in a sandboxed iframe.'
                )}
              </li>
              <li>
                {t('A single .html import only covers the landing page.')}
              </li>
              <li>{t('Importing a theme selects it immediately.')}</li>
            </ul>
          </section>
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
