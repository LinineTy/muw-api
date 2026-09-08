// @muw-owned
import { CalendarX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import type {
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { cn } from '@/lib/utils'

import { cancelSubscription } from '../../api'

type CancelMode = 'immediate' | 'end_period'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription: UserSubscriptionRecord | null
  plan?: SubscriptionPlan | null
  onSuccess?: () => void | Promise<void>
}

export function CancelSubscriptionDialog(props: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<CancelMode>('end_period')
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const sub = props.subscription?.subscription
  // 套餐名优先取套餐快照（含已禁用套餐）；缺失时回退到订阅 id。
  let planLabel = ''
  if (props.plan?.title) {
    planLabel = props.plan.title
  } else if (sub?.plan_id) {
    planLabel = `${t('Subscription')} #${sub.plan_id}`
  }

  const doCancel = async (targetMode: CancelMode) => {
    if (!sub) return
    setSubmitting(true)
    try {
      const res = await cancelSubscription(sub.id, targetMode)
      if (res.success) {
        toast.success(res.data?.message || t('Subscription cancelled'))
        props.onOpenChange(false)
        void props.onSuccess?.()
      } else {
        toast.error(res.message || t('Request failed'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setSubmitting(false)
      setConfirming(false)
    }
  }

  // 两种模式都先进二次确认页（内容按模式区分），确认后再执行。
  const handleConfirm = () => {
    setConfirming(true)
  }

  const confirmLabel =
    mode === 'immediate' ? t('Cancel immediately') : t('Cancel at period end')

  const options: { value: CancelMode; title: string; desc: string }[] = [
    {
      value: 'end_period',
      title: t('Cancel at period end'),
      desc: t(
        'Keeps the subscription active until it expires, then ends it automatically. Auto-renew is turned off.'
      ),
    },
    {
      value: 'immediate',
      title: t('Cancel immediately'),
      desc: t(
        'Ends the subscription right away. The user group reverts immediately if applicable.'
      ),
    },
  ]

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <CalendarX className='h-5 w-5' />
          {t('Cancel Subscription')}
        </>
      }
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      {confirming ? (
        <div className='flex flex-col gap-3 rounded-md border p-3'>
          {mode === 'immediate' ? (
            <>
              <p className='text-sm font-medium'>
                {t('Immediately cancel this subscription?')}
              </p>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Ends the subscription right away and reverts the user group if applicable. This cannot be undone.'
                )}
              </p>
            </>
          ) : (
            <>
              <p className='text-sm font-medium'>
                {t('Cancel at period end?')}
              </p>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Keeps the subscription active until it expires, then ends it automatically. Auto-renew is turned off.'
                )}
              </p>
            </>
          )}
          <div className='flex gap-2'>
            <Button
              className='flex-1'
              variant='outline'
              disabled={submitting}
              onClick={() => setConfirming(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              className='flex-1'
              variant={mode === 'immediate' ? 'destructive' : 'default'}
              disabled={submitting}
              onClick={() => void doCancel(mode)}
            >
              {submitting ? t('Saving...') : confirmLabel}
            </Button>
          </div>
        </div>
      ) : (
        <div className='space-y-3'>
          <div className='bg-muted/50 rounded-lg border px-3 py-2 text-sm'>
            <span className='text-muted-foreground'>{t('Plan Name')}: </span>
            <span className='font-medium'>{planLabel}</span>
          </div>
          <div className='space-y-2'>
            {options.map((opt) => (
              <button
                key={opt.value}
                type='button'
                onClick={() => setMode(opt.value)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  mode === opt.value
                    ? 'border-primary bg-primary/5'
                    : 'bg-card hover:bg-muted/50'
                )}
              >
                <div className='text-sm font-medium'>{opt.title}</div>
                <div className='text-muted-foreground mt-0.5 text-xs'>
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>
          <div className='flex justify-end gap-2 pt-1'>
            <Button variant='outline' onClick={() => props.onOpenChange(false)}>
              {t('Close')}
            </Button>
            <Button
              variant='destructive'
              onClick={handleConfirm}
              disabled={submitting || !sub}
            >
              {submitting ? t('Saving...') : t('Confirm Cancel')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
