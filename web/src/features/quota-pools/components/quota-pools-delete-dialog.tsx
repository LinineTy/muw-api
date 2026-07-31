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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'

import { deleteQuotaPool } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import { useQuotaPools } from './quota-pools-provider'

export function QuotaPoolsDeleteDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useQuotaPools()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!currentRow) return
    setIsDeleting(true)
    try {
      const result = await deleteQuotaPool(currentRow.id)
      if (result.success) {
        toast.success(t(SUCCESS_MESSAGES.QUOTA_POOL_DELETED))
        setOpen(null)
        triggerRefresh()
      } else {
        toast.error(result.message || t(ERROR_MESSAGES.DELETE_FAILED))
      }
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <ConfirmDialog
      destructive
      open={open === 'delete'}
      onOpenChange={(isOpen) => !isOpen && setOpen(null)}
      handleConfirm={handleDelete}
      isLoading={isDeleting}
      className='max-w-md'
      title={t('Delete Quota Pool?')}
      desc={
        <>
          {t('This will permanently delete the pool')}{' '}
          <strong>{currentRow?.name}</strong>{' '}
          {t('and all of its claim records. This action cannot be undone.')}
        </>
      }
      confirmText={t('Delete')}
    />
  )
}
