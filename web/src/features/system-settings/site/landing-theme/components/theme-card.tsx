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
import { Check, Eye, Trash2 } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import dayjs from '@/lib/dayjs'

import { useDeleteLandingTheme } from '../hooks/use-landing-themes'
import type { LandingThemeSummary } from '../types'

type ThemeCardProps = {
  theme: LandingThemeSummary
  selected: boolean
  onSelect: () => void
  onPreview: () => void
}

export function ThemeCard({
  theme,
  selected,
  onSelect,
  onPreview,
}: ThemeCardProps) {
  const { t } = useTranslation()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const deleteTheme = useDeleteLandingTheme()

  const handleDelete = () => {
    setShowDeleteDialog(false)
    deleteTheme.mutate(theme.id)
  }

  return (
    <>
      <Card
        className={cn(
          'transition-colors',
          selected && 'border-primary/60 ring-primary/20 ring-1'
        )}
      >
        <CardContent className='flex flex-col gap-3 p-4'>
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium'>{theme.name}</p>
              <p className='text-muted-foreground text-xs tabular-nums'>
                {dayjs(theme.created_at * 1000).format('YYYY-MM-DD HH:mm')}
              </p>
            </div>
            {selected && <Badge>{t('Active')}</Badge>}
          </div>
          <div className='flex flex-wrap items-center gap-1.5'>
            <Button
              variant={selected ? 'secondary' : 'outline'}
              size='sm'
              onClick={onSelect}
              disabled={selected}
            >
              {selected ? (
                <Check data-icon='inline-start' className='size-3.5' aria-hidden='true' />
              ) : null}
              {selected ? t('Selected') : t('Select')}
            </Button>
            <Button variant='ghost' size='sm' onClick={onPreview}>
              <Eye data-icon='inline-start' className='size-3.5' aria-hidden='true' />
              {t('Preview')}
            </Button>
            <Button
              variant='ghost'
              size='sm'
              className='text-destructive hover:text-destructive ml-auto'
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 data-icon='inline-start' className='size-3.5' aria-hidden='true' />
              {t('Delete')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Theme')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Are you sure you want to delete this theme? If it is currently active, the landing page will revert to the Default Theme.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={handleDelete}
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
