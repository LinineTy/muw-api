// @muw-owned
import { Ban, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'

import { deleteUserSubscription, invalidateUserSubscription } from '../api'
import type { AdminUserSubscriptionSummary } from '../types'
import { useSubscriptions } from './subscriptions-provider'

// 单条订阅的管理操作：作废（保留记录，转为 cancelled）/ 删除（软删，保留在历史订阅）。
export function SubscriptionAdminActions({
  summary,
}: {
  summary: AdminUserSubscriptionSummary
}) {
  const { t } = useTranslation()
  const { triggerRefresh } = useSubscriptions()
  const [action, setAction] = useState<'invalidate' | 'delete' | null>(null)
  const [loading, setLoading] = useState(false)

  // 已删除的订阅只出现在历史视图，不再提供操作。
  if (summary.subscription.status === 'deleted') return null

  const isInvalidate = action === 'invalidate'

  const handleConfirm = async () => {
    if (!action) return
    setLoading(true)
    try {
      const res =
        action === 'invalidate'
          ? await invalidateUserSubscription(summary.subscription.id)
          : await deleteUserSubscription(summary.subscription.id)
      if (res.success) {
        toast.success(
          isInvalidate
            ? t('Subscription invalidated')
            : t('Subscription deleted')
        )
        triggerRefresh()
        setAction(null)
      } else {
        toast.error(res.message || t('Request failed'))
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className='flex items-center gap-1'>
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={() => setAction('invalidate')}
          aria-label={t('Invalidate')}
        >
          <Ban />
        </Button>
        <Button
          variant='ghost'
          size='icon-sm'
          className='text-destructive hover:text-destructive'
          onClick={() => setAction('delete')}
          aria-label={t('Delete')}
        >
          <Trash2 />
        </Button>
      </div>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(v) => !v && setAction(null)}
        title={
          isInvalidate
            ? t('Invalidate subscription?')
            : t('Delete subscription?')
        }
        desc={
          isInvalidate
            ? t(
                'This immediately stops the subscription and downgrades the user group. The record is kept as cancelled.'
              )
            : t(
                'This removes the subscription from the active list. The record is preserved in History Subscriptions.'
              )
        }
        confirmText={isInvalidate ? t('Invalidate') : t('Delete')}
        destructive={!isInvalidate}
        handleConfirm={handleConfirm}
        isLoading={loading}
      />
    </>
  )
}
