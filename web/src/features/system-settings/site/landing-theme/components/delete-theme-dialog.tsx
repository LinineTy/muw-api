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

import { useDeleteLandingTheme } from '../hooks/use-landing-themes'

type DeleteThemeDialogProps = {
  themeId: string
  name: string
}

export function DeleteThemeDialog({ themeId, name }: DeleteThemeDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const deleteTheme = useDeleteLandingTheme()

  const handleConfirm = () => {
    setOpen(false)
    deleteTheme.mutate(themeId)
  }

  return (
    <>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        className='text-destructive hover:text-destructive'
        onClick={() => setOpen(true)}
        aria-label={t('Delete theme')}
      >
        <Trash2 className='size-4' aria-hidden='true' />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Theme')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Are you sure you want to delete the theme "{{name}}"? If it is currently active, the landing page will revert to the Default Theme.',
                { name }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleConfirm}
              disabled={deleteTheme.isPending}
            >
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
