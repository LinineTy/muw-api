// @muw-owned
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { resolveImageDataUrl } from '../../lib'

type MessageAttachmentsProps = {
  attachments: string[]
}

/**
 * Render a message's private image attachments. Each URL is fetched through the
 * authenticated API and shown as a data URL; failed loads (e.g. after TTL GC)
 * render a muted placeholder.
 */
export function MessageAttachments({
  attachments,
}: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) {
    return null
  }
  return (
    <div className='flex flex-wrap gap-2'>
      {attachments.map((url) => (
        <AttachmentImage key={url} url={url} />
      ))}
    </div>
  )
}

function AttachmentImage({ url }: { url: string }) {
  const { t } = useTranslation()
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    setFailed(false)

    resolveImageDataUrl(url)
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
  }, [url])

  const baseClass = 'overflow-hidden rounded-md border border-border/60'

  if (failed) {
    return (
      <div
        className={cn(
          baseClass,
          'bg-muted/40 text-muted-foreground flex h-24 w-32 items-center justify-center px-2 text-center text-xs'
        )}
      >
        {t('Image unavailable')}
      </div>
    )
  }

  if (!dataUrl) {
    return (
      <div
        className={cn(
          baseClass,
          'bg-muted/40 h-24 w-32 animate-pulse'
        )}
      />
    )
  }

  return (
    <a
      className={cn(baseClass, 'block')}
      href={dataUrl}
      rel='noreferrer'
      target='_blank'
    >
      <img
        alt={t('Image attachment')}
        className='max-h-48 w-auto max-w-full object-cover md:max-h-72'
        src={dataUrl}
      />
    </a>
  )
}
