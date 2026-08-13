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
import {
  Download,
  ExternalLink,
  ImageOff,
  Loader2,
  Save,
  Square,
  Trash2,
  Wand2,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import {
  deletePlaygroundImage,
  generatePlaygroundImage,
  listPlaygroundImages,
  uploadPlaygroundImage,
} from '../../api'
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_SIZES,
  STORAGE_KEYS,
} from '../../constants'
import { resolveImageDataUrl } from '../../lib'
import { downloadBlobObject } from '@/lib/download'

type PlaygroundImageGenerationProps = {
  group: string
}

type GeneratedImage = {
  id: string
  src: string
  isBase64: boolean
  fileName: string
}

type HistoryItem = {
  id: string
  prompt: string
  model: string
  images: GeneratedImage[]
}

type GalleryItem = {
  id: number
  name: string
  ext: string
  url: string
  size: number
  created_time: number
}

function base64ToBlob(base64: string, mime = 'application/octet-stream'): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',')
  const mime = meta?.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream'
  return base64ToBlob(base64, mime)
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'CanceledError')
  )
}

/**
 * Playground image-generation tab: prompt → images via /pg/images/generations,
 * plus a "my images" gallery of permanently saved generations.
 */
export function PlaygroundImageGeneration({
  group,
}: PlaygroundImageGenerationProps) {
  const { t } = useTranslation()

  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.IMAGE_MODEL)
    return stored || DEFAULT_IMAGE_GENERATION_MODEL
  })
  const [n, setN] = useState('1')
  const [size, setSize] = useState('1024x1024')
  const [isGenerating, setIsGenerating] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.IMAGE_MODEL, model)
    } catch {
      // ignore storage quota errors
    }
  }, [model])

  const refreshGallery = useCallback(async () => {
    setGalleryLoading(true)
    try {
      setGallery(await listPlaygroundImages(true))
    } catch {
      setGallery([])
    } finally {
      setGalleryLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshGallery()
  }, [refreshGallery])

  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    []
  )

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || isGenerating) return

    const controller = new AbortController()
    abortRef.current = controller
    setIsGenerating(true)

    try {
      const parsedN = Math.min(4, Math.max(1, Number(n) || 1))
      const response = await generatePlaygroundImage(
        {
          model: model.trim() || DEFAULT_IMAGE_GENERATION_MODEL,
          prompt: trimmedPrompt,
          group,
          n: parsedN,
          size,
        },
        controller.signal
      )

      const items = response.data ?? []
      if (items.length === 0) {
        throw new Error('empty result')
      }

      const timestamp = Date.now()
      const images: GeneratedImage[] = items
        .map((item, index) => ({
          id: nanoid(),
          ...(item.b64_json
            ? {
                src: `data:image/png;base64,${item.b64_json}`,
                isBase64: true,
              }
            : {
                src: item.url || '',
                isBase64: false,
              }),
          fileName: `playground-${timestamp}-${index}.png`,
        }))
        .filter((image) => image.src !== '')

      if (images.length === 0) {
        throw new Error('empty result')
      }

      setHistory((prev) => [
        { id: nanoid(), prompt: trimmedPrompt, model, images },
        ...prev,
      ])
      setPrompt('')
    } catch (error: unknown) {
      if (isAbortError(error)) return
      toast.error(t('Image generation failed'))
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setIsGenerating(false)
  }

  const downloadImage = async (image: GeneratedImage) => {
    try {
      if (image.isBase64) {
        downloadBlobObject(
          base64ToBlob(image.src.split(',')[1], 'image/png'),
          image.fileName
        )
        return
      }
      const response = await fetch(image.src)
      const blob = await response.blob()
      downloadBlobObject(blob, image.fileName)
    } catch {
      window.open(image.src, '_blank', 'noopener,noreferrer')
    }
  }

  const saveToGallery = async (image: GeneratedImage) => {
    try {
      let file: File
      if (image.isBase64) {
        const mime =
          image.src.match(/^data:([^;,]+);/)?.[1] || 'image/png'
        file = new File(
          [base64ToBlob(image.src.split(',')[1], mime)],
          image.fileName,
          { type: mime }
        )
      } else {
        const response = await fetch(image.src)
        const blob = await response.blob()
        file = new File([blob], image.fileName, {
          type: blob.type || 'image/png',
        })
      }
      await uploadPlaygroundImage(file, true)
      toast.success(t('Image saved'))
      void refreshGallery()
    } catch {
      toast.error(t('Save failed'))
    }
  }

  const deleteGalleryItem = async (id: number) => {
    try {
      await deletePlaygroundImage(id)
      toast.success(t('Image deleted'))
      void refreshGallery()
    } catch {
      toast.error(t('Delete failed'))
    }
  }

  const downloadGalleryItem = async (item: GalleryItem) => {
    try {
      const dataUrl = await resolveImageDataUrl(item.url)
      if (!dataUrl) {
        throw new Error('unavailable')
      }
      downloadBlobObject(
        dataUrlToBlob(dataUrl),
        `${item.name || `image-${item.id}`}.${item.ext || 'png'}`
      )
    } catch {
      toast.error(t('Image unavailable'))
    }
  }

  const canGenerate = prompt.trim().length > 0 && !isGenerating

  return (
    <div className='mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-4 pb-8'>
      {/* Prompt + options */}
      <div className='space-y-3 pt-2'>
        <Textarea
          className='min-h-24'
          disabled={isGenerating}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void handleGenerate()
            }
          }}
          placeholder={t('Describe the image you want...')}
          value={prompt}
        />

        <div className='flex flex-wrap items-end gap-3'>
          <div className='min-w-40 flex-1 space-y-1'>
            <Label htmlFor='image-model'>{t('Image model')}</Label>
            <Input
              id='image-model'
              onChange={(event) => setModel(event.target.value)}
              placeholder={DEFAULT_IMAGE_GENERATION_MODEL}
              value={model}
            />
          </div>

          <div className='w-24 space-y-1'>
            <Label htmlFor='image-count'>{t('Number of images')}</Label>
            <Input
              id='image-count'
              max={4}
              min={1}
              onChange={(event) => setN(event.target.value)}
              type='number'
              value={n}
            />
          </div>

          <div className='w-36 space-y-1'>
            <Label>{t('Size')}</Label>
            <Select
              onValueChange={(value) => {
                if (value) setSize(value)
              }}
              value={size}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_GENERATION_SIZES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isGenerating ? (
            <Button onClick={handleStop} variant='secondary'>
              <Square className='fill-current' />
              {t('Stop')}
            </Button>
          ) : (
            <Button disabled={!canGenerate} onClick={handleGenerate}>
              <Wand2 />
              {t('Generate')}
            </Button>
          )}
        </div>
      </div>

      {/* Generation history */}
      {history.length === 0 ? (
        <div className='text-muted-foreground flex h-48 flex-col items-center justify-center gap-2 text-sm'>
          <ImageOff className='size-6' />
          {t('No images yet. Enter a prompt to get started.')}
        </div>
      ) : (
        <div className='mt-6 space-y-6'>
          {history.map((item) => (
            <div key={item.id} className='space-y-2'>
              <p className='text-muted-foreground text-xs'>
                {item.model} · {item.prompt}
              </p>
              <div className='grid grid-cols-2 gap-3 md:grid-cols-3'>
                {item.images.map((image) => (
                  <div
                    className='bg-muted/30 group relative overflow-hidden rounded-lg border border-border/60'
                    key={image.id}
                  >
                    <img
                      alt={item.prompt}
                      className='aspect-square w-full object-cover'
                      src={image.src}
                    />
                    <div className='absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100'>
                      <Button
                        aria-label={t('Save to my images')}
                        className='size-7'
                        onClick={() => void saveToGallery(image)}
                        size='icon-xs'
                        variant='secondary'
                      >
                        <Save />
                      </Button>
                      <Button
                        aria-label={t('Download')}
                        className='size-7'
                        onClick={() => void downloadImage(image)}
                        size='icon-xs'
                        variant='secondary'
                      >
                        <Download />
                      </Button>
                      {!image.isBase64 && (
                        <Button
                          aria-label={t('Open in new tab')}
                          className='size-7'
                          onClick={() =>
                            window.open(image.src, '_blank', 'noopener,noreferrer')
                          }
                          size='icon-xs'
                          variant='secondary'
                        >
                          <ExternalLink />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* My images gallery */}
      <div className='mt-10'>
        <h3 className='text-muted-foreground mb-3 flex items-center gap-2 text-sm font-medium'>
          {t('My images')}
          <span className='text-xs'>({gallery.length})</span>
        </h3>
        {galleryLoading && (
          <div className='flex h-24 items-center justify-center'>
            <Loader2 className='size-5 animate-spin' />
          </div>
        )}
        {!galleryLoading && gallery.length === 0 && (
          <p className='text-muted-foreground text-xs'>
            {t('No saved images yet')}
          </p>
        )}
        {!galleryLoading && gallery.length > 0 && (
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
            {gallery.map((item) => (
              <GalleryImage
                item={item}
                key={item.id}
                onDelete={() => void deleteGalleryItem(item.id)}
                onDownload={() => void downloadGalleryItem(item)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type GalleryImageProps = {
  item: GalleryItem
  onDelete: () => void
  onDownload: () => void
}

function GalleryImage({ item, onDelete, onDownload }: GalleryImageProps) {
  const { t } = useTranslation()
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    resolveImageDataUrl(item.url)
      .then((result) => {
        if (cancelled) return
        if (result) {
          setDataUrl(result)
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [item.url])

  let content
  if (failed) {
    content = (
      <div className='text-muted-foreground flex aspect-square w-full items-center justify-center text-xs'>
        {t('Image unavailable')}
      </div>
    )
  } else if (dataUrl) {
    content = (
      <img
        alt={item.name}
        className='aspect-square w-full object-cover'
        src={dataUrl}
      />
    )
  } else {
    content = <div className='bg-muted/40 aspect-square w-full animate-pulse' />
  }

  return (
    <div className='bg-muted/30 group relative overflow-hidden rounded-lg border border-border/60'>
      {content}
      <div className='absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100'>
        <Button
          aria-label={t('Download')}
          className='size-7'
          onClick={onDownload}
          size='icon-xs'
          variant='secondary'
        >
          <Download />
        </Button>
        <Button
          aria-label={t('Delete')}
          className='size-7'
          onClick={onDelete}
          size='icon-xs'
          variant='secondary'
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}
