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
import { useEffect, useState } from 'react'
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
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onOpenChange(false)
        }
      }}
    >
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('Edit Manual Configuration')}</DialogTitle>
        </DialogHeader>

        <p className='text-muted-foreground text-xs'>
          {t(
            'Each page accepts a URL, HTML, or Markdown. Empty pages fall back to the built-in view.'
          )}
        </p>

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
              />
            </div>
          ))}
        </div>

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
