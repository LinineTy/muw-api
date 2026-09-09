// @muw-owned
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'

import { adminDeleteGroupPinProduct, deletePlan } from '../../api'
import { useSubscriptions } from '../subscriptions-provider'

export function DeletePlanDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useSubscriptions()
  const [loading, setLoading] = useState(false)

  if (open !== 'delete' || !currentRow) return null

  // 固定分组商品与套餐 id 会撞号，必须按 kind 分派到各自的删除接口。
  const isGroupPin = currentRow.kind === 'group_pin'

  const handleConfirm = async () => {
    setLoading(true)
    try {
      const res = isGroupPin
        ? await adminDeleteGroupPinProduct(currentRow.plan.id)
        : await deletePlan(currentRow.plan.id)
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
      desc={
        isGroupPin
          ? t(
              'Delete fixed group product "{{title}}"? This cannot be undone. Existing pins of users are not affected.',
              { title: currentRow.plan.title }
            )
          : t(
              'Delete subscription plan "{{title}}"? This cannot be undone. Only plans without active subscriptions or pending orders can be deleted.',
              { title: currentRow.plan.title }
            )
      }
      handleConfirm={handleConfirm}
      isLoading={loading}
      confirmText={t('Delete')}
      destructive
    />
  )
}
