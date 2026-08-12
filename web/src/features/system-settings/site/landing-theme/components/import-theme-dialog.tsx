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
import JSZip from 'jszip'
import { FileText, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useImportLandingTheme } from '../hooks/use-landing-themes'
import type { LandingManual } from '../types'

const MAX_PAGE_BYTES = 500 * 1024
const MAX_ZIP_BYTES = 2 * 1024 * 1024
const MAX_THEME_NAME_RUNES = 100

// zip 内部固定页名(规范):zip 文件名 = 主题名。
const PAGE_FILE_MAP: Record<string, keyof LandingManual> = {
  'home.html': 'home',
  'about.html': 'about',
  'agreement.html': 'user_agreement',
  'privacy.html': 'privacy_policy',
}

type ImportThemeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function baseNameFromFile(fileName: string): string {
  return fileName.replace(/\.(zip|html?)$/i, '')
}

export function ImportThemeDialog({
  open,
  onOpenChange,
}: ImportThemeDialogProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importTheme = useImportLandingTheme()

  const [name, setName] = useState('')
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  // 选中文件后的前端校验结果:非空表示可导入
  const [file, setFile] = useState<File | null>(null)

  const reset = () => {
    setName('')
    setFileName('')
    setError('')
    setFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const validateAndStage = async (selected: File | undefined) => {
    setError('')
    setFile(null)
    if (!selected) return

    const isZip = /\.zip$/i.test(selected.name)
    const isHtml = /\.html?$/i.test(selected.name)
    if (!isZip && !isHtml) {
      setError(t('File must be an HTML or ZIP file'))
      return
    }
    if (selected.size > MAX_ZIP_BYTES) {
      setError(t('File must be 2MB or smaller'))
      return
    }

    if (isZip) {
      try {
        const zip = await JSZip.loadAsync(selected)
        const manual: LandingManual = {
          home: '',
          about: '',
          user_agreement: '',
          privacy_policy: '',
        }
        for (const rawPath of Object.keys(zip.files)) {
          const cleanPath = rawPath.split('/').filter(Boolean).join('/')
          const base = cleanPath.split('/').pop() ?? ''
          if (base === '.DS_Store' || cleanPath.startsWith('__MACOSX')) continue
          const slug = PAGE_FILE_MAP[base.toLowerCase()]
          if (!slug) continue
          const entry = zip.files[rawPath]
          if (entry.dir) continue
          const content = await entry.async('string')
          if (content.length > MAX_PAGE_BYTES) {
            setError(t('File must be 500KB or smaller'))
            return
          }
          manual[slug] = content
        }
        if (!manual.home) {
          setError(t('The zip must contain a home.html file'))
          return
        }
      } catch {
        setError(t('Invalid ZIP file'))
        return
      }
    } else {
      try {
        const content = await selected.text()
        if (content.length > MAX_PAGE_BYTES) {
          setError(t('File must be 500KB or smaller'))
          return
        }
      } catch {
        setError(t('Failed to read file'))
        return
      }
    }

    setFileName(selected.name)
    setFile(selected)
    if (!name) {
      setName(baseNameFromFile(selected.name))
    }
  }

  const handleImport = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('Name is required'))
      return
    }
    if ([...trimmedName].length > MAX_THEME_NAME_RUNES) {
      setError(t('Name must be 100 characters or fewer'))
      return
    }
    if (!file) {
      setError(t('Select a .zip or .html file to import'))
      return
    }
    importTheme.mutate(
      { name: trimmedName, file },
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
              'Upload a .html or .zip theme. The ZIP file name becomes the theme name.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='landing-theme-file' className='text-xs'>
              {t('Theme file')}
            </Label>
            <input
              ref={fileInputRef}
              id='landing-theme-file'
              type='file'
              accept='.html,.htm,.zip'
              className='hidden'
              onChange={(event) => {
                void validateAndStage(event.target.files?.[0])
              }}
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-full'
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText
                data-icon='inline-start'
                className='size-4'
                aria-hidden='true'
              />
              {fileName || t('Choose file')}
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

          {error && <p className='text-destructive text-xs'>{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='outline' />}>
            {t('Cancel')}
          </DialogClose>
          <Button
            type='button'
            onClick={handleImport}
            disabled={importTheme.isPending || !file}
          >
            <Upload
              data-icon='inline-start'
              className='size-4'
              aria-hidden='true'
            />
            {t('Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
