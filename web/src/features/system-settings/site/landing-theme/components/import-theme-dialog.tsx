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
import { FileText, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useImportLandingTheme } from '../hooks/use-landing-themes'

const MAX_THEME_CONTENT_BYTES = 500 * 1024
const MAX_THEME_NAME_RUNES = 100

type ImportThemeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function baseNameFromFile(fileName: string): string {
  return fileName.replace(/\.html?$/i, '')
}

export function ImportThemeDialog({
  open,
  onOpenChange,
}: ImportThemeDialogProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importTheme = useImportLandingTheme()

  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState('')

  const handlePickFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return
    if (!/\.html?$/i.test(file.name)) {
      toast.error(t('File must be an HTML file'))
      return
    }
    if (file.size > MAX_THEME_CONTENT_BYTES) {
      toast.error(t('File must be 500KB or smaller'))
      return
    }
    try {
      const text = await file.text()
      setContent(text)
      setFileName(file.name)
      if (!name) {
        setName(baseNameFromFile(file.name))
      }
    } catch {
      toast.error(t('Failed to read file'))
    }
  }

  const reset = () => {
    setName('')
    setContent('')
    setFileName('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleImport = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error(t('Name is required'))
      return
    }
    if ([...trimmedName].length > MAX_THEME_NAME_RUNES) {
      toast.error(t('Name must be 100 characters or fewer'))
      return
    }
    if (!content) {
      toast.error(t('Select an .html file to import'))
      return
    }
    importTheme.mutate(
      { name: trimmedName, content },
      {
        onSuccess: (res) => {
          if (res.success) {
            onOpenChange(false)
            reset()
          }
        },
      }
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          reset()
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('Import Theme')}</DialogTitle>
          <DialogDescription>
            {t(
              'Select an .html file to import. The theme will be applied immediately after import.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='landing-theme-file' className='text-xs'>
              {t('HTML file')}
            </Label>
            <input
              ref={fileInputRef}
              id='landing-theme-file'
              type='file'
              accept='.html,.htm'
              className='hidden'
              onChange={(event) => {
                void handleFileChange(event.target.files?.[0])
              }}
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-full'
              onClick={handlePickFile}
            >
              <FileText data-icon='inline-start' className='size-4' aria-hidden='true' />
              {fileName || t('Choose HTML file')}
            </Button>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='landing-theme-name' className='text-xs'>
              {t('Theme Name')}
            </Label>
            <Input
              id='landing-theme-name'
              value={name}
              maxLength={MAX_THEME_NAME_RUNES}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='outline' />}>
            {t('Cancel')}
          </DialogClose>
          <Button
            type='button'
            onClick={handleImport}
            disabled={importTheme.isPending}
          >
            <Upload data-icon='inline-start' className='size-4' aria-hidden='true' />
            {t('Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
