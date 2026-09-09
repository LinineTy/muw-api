// @muw-owned
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { History, PinOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { GroupBadge } from '@/components/group-badge'
import { Button } from '@/components/ui/button'
import {
  adminListGroupPins,
  adminReleaseGroupPin,
  type GroupPin,
} from '@/features/subscriptions/api'
import { formatTimestamp } from '@/features/subscriptions/lib'

/**
 * 用户编辑抽屉里的固定分组区块：显示当前 active 钉（分组/来源/创建时间）并允许解除；
 * 历史钉（含已解除）收进弹窗，保持抽屉短。钉由管理员改组自动建立，或用户购买商品建立。
 */
export function UserGroupPinSection({
  userId,
  onChanged,
}: {
  userId: number
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [releasing, setReleasing] = useState<GroupPin | null>(null)
  const [loading, setLoading] = useState(false)

  const { data } = useQuery({
    queryKey: ['admin-group-pins', 'user', userId],
    queryFn: () => adminListGroupPins({ user_id: userId, page_size: 50 }),
    enabled: userId > 0,
  })
  const pins = data?.data?.items ?? []
  const activePin = pins.find((pin) => pin.status === 'active') ?? null

  const handleRelease = async () => {
    if (!releasing) return
    setLoading(true)
    try {
      const res = await adminReleaseGroupPin(releasing.id, 'admin release')
      if (res.success) {
        toast.success(t('Fixed group removed'))
        setReleasing(null)
        void queryClient.invalidateQueries({ queryKey: ['admin-group-pins'] })
        // 解除会收敛用户组，抽屉里的分组字段需要重新拉取。
        onChanged?.()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setLoading(false)
    }
  }

  const sourceLabel = (source: string) =>
    source === 'purchase' ? t('Purchase') : t('Admin')

  return (
    <>
      <div className='flex flex-col gap-3'>
        <div className='flex items-center justify-between gap-2'>
          <h3 className='text-sm font-medium'>{t('Fixed Groups')}</h3>
          {pins.length > 0 && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => setHistoryOpen(true)}
            >
              <History className='mr-1 h-3.5 w-3.5' />
              {t('History')}
            </Button>
          )}
        </div>

        {activePin ? (
          <div className='flex items-center justify-between gap-2 rounded-md border px-3 py-2.5'>
            <div className='flex min-w-0 flex-col gap-1'>
              <GroupBadge group={activePin.group} />
              <span className='text-muted-foreground text-xs'>
                {sourceLabel(activePin.source)} ·{' '}
                {formatTimestamp(activePin.created_at)}
              </span>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='text-destructive hover:text-destructive h-7 shrink-0'
              onClick={() => setReleasing(activePin)}
            >
              <PinOff className='mr-1 h-3.5 w-3.5' />
              {t('Unpin')}
            </Button>
          </div>
        ) : (
          <p className='text-muted-foreground text-xs'>
            {t('No fixed group pinned')}
          </p>
        )}
      </div>

      <Dialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title={t('Fixed group history')}
        description={t(
          'Every pin of this user, including released ones. The active pin is what currently anchors the group.'
        )}
        contentClassName='sm:max-w-xl'
      >
        <div className='flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1'>
          {pins.map((pin) => (
            <div
              key={pin.id}
              className='flex items-center justify-between gap-2 rounded-md border px-3 py-2.5'
            >
              <div className='flex min-w-0 flex-col gap-1'>
                <GroupBadge group={pin.group} />
                <span className='text-muted-foreground text-xs'>
                  {sourceLabel(pin.source)} · {formatTimestamp(pin.created_at)}
                </span>
              </div>
              <div className='text-muted-foreground shrink-0 text-right text-xs'>
                <div className='text-foreground'>
                  {pin.status === 'active'
                    ? t('Active')
                    : t('Group pin released')}
                </div>
                {pin.released_at > 0 && (
                  <div>{formatTimestamp(pin.released_at)}</div>
                )}
                {pin.release_reason && <div>{pin.release_reason}</div>}
              </div>
            </div>
          ))}
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!releasing}
        onOpenChange={(open) => !open && setReleasing(null)}
        title={t('Unpin')}
        desc={t(
          'Release the fixed group "{{group}}" for this user? The group falls back to the highest remaining subscription anchor, or the last downgrade target.',
          { group: releasing?.group ?? '' }
        )}
        confirmText={t('Unpin')}
        destructive
        handleConfirm={handleRelease}
        isLoading={loading}
      />
    </>
  )
}
