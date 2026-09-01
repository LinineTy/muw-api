// @muw-owned
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'

import { purgeUserSubscription } from '../api'
import type { AdminUserSubscriptionSummary } from '../types'
import { useSubscriptions } from './subscriptions-provider'

// 历史订阅中的彻底删除：物理删行、从数据库和历史记录中一并抹掉，二次确认。
export function HistoryPurgeAction({
  summary,
}: {
  summary: AdminUserSubscriptionSummary
}) {
  const { t } = useTranslation()
  const { triggerRefresh } = useSubscriptions()
  const [step, setStep] = useState<0 | 1 | 2>(0) // 0=closed, 1=first confirm, 2=final confirm
  const [loading, setLoading] = useState(false)

  const handleFinalConfirm = async () => {
    setLoading(true)
    try {
      const res = await purgeUserSubscription(summary.subscription.id)
      if (res.success) {
        toast.success(t('Subscription permanently deleted'))
        triggerRefresh()
        setStep(0)
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
      <Button
        variant='ghost'
        size='icon-sm'
        className='text-destructive hover:text-destructive'
        onClick={() => setStep(1)}
        aria-label={t('Permanently delete')}
      >
        <Trash2 />
      </Button>
      <ConfirmDialog
        open={step === 1}
        onOpenChange={(v) => !v && setStep(0)}
        title={t('Permanently delete subscription?')}
        desc={t(
          'This permanently removes the subscription record from the database. It cannot be recovered or viewed in History Subscriptions.'
        )}
        confirmText={t('Continue')}
        destructive
        handleConfirm={() => setStep(2)}
      />
      <ConfirmDialog
        open={step === 2}
        onOpenChange={(v) => !v && setStep(0)}
        title={t('Confirm permanent deletion')}
        desc={t(
          'This action cannot be undone. The record will be permanently deleted from the database.'
        )}
        confirmText={t('Permanently delete')}
        destructive
        handleConfirm={handleFinalConfirm}
        isLoading={loading}
      />
    </>
  )
}
