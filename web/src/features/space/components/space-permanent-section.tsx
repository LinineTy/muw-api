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
import { Download, ImageOff, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { downloadBlobObject } from '@/lib/download'
import {
  deletePlaygroundImage,
  listPlaygroundImages,
} from '@/features/playground/api'
import { resolveImageDataUrl } from '@/features/playground/lib/image/image-data-url'

type PermanentImageItem = Awaited<ReturnType<typeof listPlaygroundImages>>[number]

const PERMANENT_PAGE_SIZE = 12

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',')
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'application/octet-stream'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/**
 * 云空间「永久图」区：可预览、下载、删除。
 */
export function SpacePermanentSection() {
  const { t } = useTranslation()
  const [images, setImages] = useState<PermanentImageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PermanentImageItem | null>(
    null
  )
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(images.length / PERMANENT_PAGE_SIZE))
  const pagedImages = images.slice(
    page * PERMANENT_PAGE_SIZE,
    (page + 1) * PERMANENT_PAGE_SIZE
  )

  // 删除/刷新后页码回落到有效范围。
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1))
  }, [totalPages])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setImages(await listPlaygroundImages(true))
    } catch {
      // 网络失败与「无数据」空态区分：失败给明确提示，避免误导用户以为没有图片。
      toast.error(t('Failed to load images'))
      setImages([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const handleDelete = async () => {
    if (!deleteTarget || deleting) {
      return
    }
    setDeleting(true)
    try {
      await deletePlaygroundImage(deleteTarget.id)
      toast.success(t('Image deleted'))
      setDeleteTarget(null)
      await load()
    } catch {
      toast.error(t('Delete failed'))
    } finally {
      setDeleting(false)
    }
  }

  const handleDownload = async (item: PermanentImageItem) => {
    const dataUrl = await resolveImageDataUrl(item.url)
    if (!dataUrl) {
      toast.error(t('Image unavailable'))
      return
    }
    const name = item.name || `image-${item.id}`
    const ext = item.ext || 'png'
    downloadBlobObject(dataUrlToBlob(dataUrl), `${name}.${ext}`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Permanent images')}</CardTitle>
        <CardDescription>
          {t('Saved generated images. They never expire.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4'>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton className='aspect-square w-full rounded-lg' key={i} />
            ))}
          </div>
        ) : (
          <>
            <PermanentGrid
              images={pagedImages}
              onDelete={setDeleteTarget}
              onDownload={handleDownload}
              emptyLabel={t('No images yet. Generate one in the playground.')}
            />
            {totalPages > 1 && (
              <div className='mt-4 flex items-center justify-center gap-2'>
                <Button
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  size='sm'
                  variant='outline'
                >
                  ‹
                </Button>
                <span className='text-muted-foreground text-xs'>
                  {page + 1} / {totalPages}
                </span>
                <Button
                  disabled={page >= totalPages - 1}
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  size='sm'
                  variant='outline'
                >
                  ›
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <ConfirmDialog
        destructive
        desc={t(
          'This image will be removed from your cloud space. This cannot be undone.'
        )}
        confirmText={t('Delete')}
        handleConfirm={() => void handleDelete()}
        isLoading={deleting}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        title={t('Delete image?')}
      />
    </Card>
  )
}

function PermanentGrid({
  images,
  onDelete,
  onDownload,
  emptyLabel,
}: {
  images: PermanentImageItem[]
  onDelete: (item: PermanentImageItem) => void
  onDownload: (item: PermanentImageItem) => void
  emptyLabel: string
}) {
  if (images.length === 0) {
    return <p className='text-muted-foreground text-sm'>{emptyLabel}</p>
  }
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4'>
      {images.map((item) => (
        <PermanentImageCard
          item={item}
          key={item.id}
          onDelete={() => onDelete(item)}
          onDownload={() => onDownload(item)}
        />
      ))}
    </div>
  )
}

function PermanentImageCard({
  item,
  onDelete,
  onDownload,
}: {
  item: PermanentImageItem
  onDelete: () => void
  onDownload: () => void
}) {
  const { t } = useTranslation()
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void resolveImageDataUrl(item.url).then((url) => {
      if (cancelled) {
        return
      }
      if (url) {
        setDataUrl(url)
      } else {
        setFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [item.url])

  let body = (
    <div className='bg-muted/40 aspect-square w-full animate-pulse' />
  )
  if (dataUrl) {
    body = (
      // eslint-disable-next-line jsx-a11y/alt-text
      <img
        alt={item.name}
        className='aspect-square w-full object-cover'
        src={dataUrl}
      />
    )
  } else if (failed) {
    body = (
      <div className='text-muted-foreground flex aspect-square w-full items-center justify-center'>
        <ImageOff className='size-5' />
      </div>
    )
  }

  return (
    <div className='group relative overflow-hidden rounded-lg border border-border/60'>
      {body}
      <div className='absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100'>
        <Button
          aria-label={t('Download')}
          className='size-7 bg-white/20 hover:bg-white/30'
          onClick={onDownload}
          size='icon'
          variant='ghost'
        >
          <Download className='size-3.5' />
        </Button>
        <Button
          aria-label={t('Delete')}
          className='size-7 bg-white/20 hover:bg-red-500/60'
          onClick={onDelete}
          size='icon'
          variant='ghost'
        >
          <Trash2 className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}
