// @muw-owned
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { DialogClose } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { useUpdateManualTheme } from '../hooks/use-landing-themes'
import type { LandingManual } from '../types'

const PAGE_FIELDS: { key: keyof LandingManual; labelKey: string }[] = [
  { key: 'home', labelKey: 'Home' },
  { key: 'about', labelKey: 'About' },
  { key: 'user_agreement', labelKey: 'User Agreement' },
  { key: 'privacy_policy', labelKey: 'Privacy Policy' },
]

type ManualThemeEditorDialogProps = {
  open: boolean
  initial: LandingManual
  onOpenChange: (open: boolean) => void
}

export function ManualThemeEditorDialog({
  open,
  initial,
  onOpenChange,
}: ManualThemeEditorDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<LandingManual>(initial)
  const updateManual = useUpdateManualTheme()

  useEffect(() => {
    if (open) {
      setDraft(initial)
    }
  }, [open, initial])

  const handleSave = () => {
    updateManual.mutate(draft, {
      onSuccess: (res) => {
        if (res.success) {
          onOpenChange(false)
        }
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Edit Manual Configuration')}
      description={t(
        'Each page accepts a URL, HTML, or Markdown. Empty pages fall back to the built-in view.'
      )}
      contentClassName='sm:max-w-2xl'
      contentHeight='auto'
      footer={
        <>
          <DialogClose render={<Button variant='outline' />}>
            {t('Cancel')}
          </DialogClose>
          <Button
            type='button'
            onClick={handleSave}
            disabled={updateManual.isPending}
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className='space-y-3'>
        {PAGE_FIELDS.map((field) => (
          <div key={field.key} className='space-y-1.5'>
            <Label htmlFor={`manual-${field.key}`} className='text-xs'>
              {t(field.labelKey)}
            </Label>
            <Textarea
              id={`manual-${field.key}`}
              rows={5}
              value={draft[field.key]}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  [field.key]: event.target.value,
                }))
              }
              // 长 HTML(整行 URL/压缩样式)强制折行,避免横向溢出
              className='[overflow-wrap:anywhere]'
            />
          </div>
        ))}
      </div>
    </Dialog>
  )
}
