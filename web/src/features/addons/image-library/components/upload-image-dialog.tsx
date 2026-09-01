// @muw-owned
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
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../lib/media'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

type UploadImageDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// 按 MIME + 扩展名判定媒体类型;不认识的返回 null。
function classifyFile(file: File): 'image' | 'video' | null {
  const ext = extOf(file.name)
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext))
    return 'image'
  if (file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(ext))
    return 'video'
  return null
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
    const kind = classifyFile(selected)
    if (kind === null) {
      setError(t('Select an image or video file'))
      return
    }
    if (kind === 'image' && selected.size > MAX_IMAGE_BYTES) {
      setError(t('Image must be 5MB or smaller'))
      return
    }
    if (kind === 'video' && selected.size > MAX_VIDEO_BYTES) {
      setError(t('Video must be 100MB or smaller'))
      return
    }
    setFile(selected)
    setPreviewUrl(URL.createObjectURL(selected))
  }

  const isVideo = file !== null && classifyFile(file) === 'video'

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
          <DialogTitle>{t('Upload Media')}</DialogTitle>
          <DialogDescription>
            {t(
              'PNG, JPEG, GIF or WebP images up to 5MB, or MP4/WebM/MOV videos up to 100MB. The file is stored on this server and served from /uploads/.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='min-w-0 space-y-3'>
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*,video/*'
            className='hidden'
            onChange={(event) => {
              void handleSelect(event.target.files?.[0])
            }}
          />
          {previewUrl ? (
            <div className='bg-muted/30 flex items-center justify-center rounded-lg border p-2'>
              {isVideo ? (
                <video
                  src={previewUrl}
                  controls
                  muted
                  className='max-h-40 max-w-full rounded object-contain'
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={file?.name ?? ''}
                  className='max-h-40 max-w-full rounded object-contain'
                />
              )}
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
              {t('Choose file')}
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
