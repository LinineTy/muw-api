// @muw-owned
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

import { useDeleteImage } from '../hooks/use-images'

type DeleteImageDialogProps = {
  imageId: number
  name: string
}

export function DeleteImageDialog({ imageId, name }: DeleteImageDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const deleteImage = useDeleteImage()

  const handleConfirm = () => {
    setOpen(false)
    deleteImage.mutate(imageId)
  }

  return (
    <>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        className='text-destructive hover:text-destructive'
        onClick={() => setOpen(true)}
        aria-label={t('Delete Image')}
      >
        <Trash2 className='size-4' aria-hidden='true' />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Image')}</AlertDialogTitle>
            <AlertDialogDescription className='break-words'>
              {t(
                'Are you sure you want to delete the image "{{name}}"? Themes that reference its URL will stop showing it.',
                { name }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleConfirm}
              disabled={deleteImage.isPending}
            >
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
