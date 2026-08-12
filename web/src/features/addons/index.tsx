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
import { Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { ImageCard } from './image-library/components/image-card'
import { UploadImageDialog } from './image-library/components/upload-image-dialog'
import { useImages } from './image-library/hooks/use-images'

function ImageLibrary() {
  const { t } = useTranslation()
  const { data: images, isLoading, isError, error } = useImages()

  if (isLoading) {
    return (
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <Skeleton key={index} className='aspect-[4/3] w-full rounded-lg' />
        ))}
      </div>
    )
  }

  if (isError) {
    return <p className='text-destructive text-xs'>{error?.message}</p>
  }

  if (!images || images.length === 0) {
    return <p className='text-muted-foreground text-xs'>{t('No media yet')}</p>
  }

  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
      {images.map((image) => (
        <ImageCard key={image.id} image={image} />
      ))}
    </div>
  )
}

export function AddonsPage() {
  const { t } = useTranslation()
  const [showUpload, setShowUpload] = useState(false)

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('Image Host')}</span>
          <Badge variant='outline' className='shrink-0'>
            Root
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button type='button' size='sm' onClick={() => setShowUpload(true)}>
          <Upload
            data-icon='inline-start'
            className='size-4'
            aria-hidden='true'
          />
          {t('Upload')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Upload images or videos to reference them in themes. Copy the absolute URL and paste it into your theme HTML.'
            )}
          </p>
          <ImageLibrary />
        </div>
        <UploadImageDialog open={showUpload} onOpenChange={setShowUpload} />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
