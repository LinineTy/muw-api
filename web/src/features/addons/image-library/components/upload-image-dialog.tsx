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
import { ImagePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

import { useUploadImage } from '../hooks/use-images'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

type UploadImageDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UploadImageDialog({
  open,
  onOpenChange,
}: UploadImageDialogProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadImage = useUploadImage()

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')

  // 清理旧 object URL:切换文件或组件卸载时自动撤销。
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const reset = () => {
    setFile(null)
    setPreviewUrl('')
    setError('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSelect = (selected: File | undefined) => {
    setError('')
    if (!selected) return
    // type 为空(罕见)时按扩展名兜底判断。
    const isImage =
      selected.type.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp)$/i.test(selected.name)
    if (!isImage) {
      setError(t('Select an image file'))
      return
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      setError(t('Image must be 5MB or smaller'))
      return
    }
    setFile(selected)
    setPreviewUrl(URL.createObjectURL(selected))
  }

  const handleUpload = () => {
    if (!file) return
    uploadImage.mutate(file, {
      onSuccess: (res) => {
        if (res.success) {
          onOpenChange(false)
          reset()
        }
      },
    })
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
          <DialogTitle>{t('Upload Image')}</DialogTitle>
          <DialogDescription>
            {t(
              'PNG, JPEG, GIF or WebP, up to 5MB. The image is stored on this server and served from /uploads/.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='min-w-0 space-y-3'>
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*'
            className='hidden'
            onChange={(event) => {
              void handleSelect(event.target.files?.[0])
            }}
          />
          {previewUrl ? (
            <div className='bg-muted/30 flex items-center justify-center rounded-lg border p-2'>
              <img
                src={previewUrl}
                alt={file?.name ?? ''}
                className='max-h-40 max-w-full rounded object-contain'
              />
            </div>
          ) : (
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-full'
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus
                data-icon='inline-start'
                className='size-4'
                aria-hidden='true'
              />
              {t('Choose image')}
            </Button>
          )}
          {previewUrl && file && (
            <div className='flex min-w-0 items-center gap-1'>
              <p
                className='text-muted-foreground min-w-0 flex-1 truncate text-xs'
                title={file.name}
              >
                {file.name}
              </p>
              <span className='text-muted-foreground shrink-0 text-xs'>
                · {(file.size / 1024).toFixed(0)} KB
              </span>
            </div>
          )}

          {error && <p className='text-destructive text-xs'>{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='outline' />}>
            {t('Cancel')}
          </DialogClose>
          <Button
            type='button'
            onClick={handleUpload}
            disabled={uploadImage.isPending || !file}
          >
            {uploadImage.isPending ? t('Uploading...') : t('Upload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
