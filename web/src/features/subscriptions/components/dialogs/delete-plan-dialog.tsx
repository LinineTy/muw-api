// @muw-owned
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'

import { deletePlan } from '../../api'
import { useSubscriptions } from '../subscriptions-provider'

export function DeletePlanDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useSubscriptions()
  const [loading, setLoading] = useState(false)

  if (open !== 'delete' || !currentRow) return null

  const handleConfirm = async () => {
    setLoading(true)
    try {
      const res = await deletePlan(currentRow.plan.id)
      if (res.success) {
        toast.success(t('Deleted successfully'))
        triggerRefresh()
        setOpen(null)
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(v) => !v && setOpen(null)}
      title={
        <>
          <Trash2 className='h-4 w-4' />
          {t('Confirm delete')}
        </>
      }
      desc={t(
        'Delete subscription plan "{{title}}"? This cannot be undone. Only plans without active subscriptions or pending orders can be deleted.',
        { title: currentRow.plan.title }
      )}
      handleConfirm={handleConfirm}
      isLoading={loading}
      confirmText={t('Delete')}
      destructive
    />
  )
}
