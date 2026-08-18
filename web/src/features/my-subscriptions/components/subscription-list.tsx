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
import { CalendarX, ChevronsUp, Clock, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestamp } from '@/features/subscriptions/lib'
import { formatQuota } from '@/lib/format'

import type {
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { setSubscriptionAutoRenew, setSubscriptionPriority } from '../api'
import {
  classifySubscriptionStatus,
  getRemainingDays,
  getUsagePercent,
} from '../lib/helpers'
import { useMySubscriptions } from './my-subscriptions-provider'
import { CancelSubscriptionDialog } from './dialogs/cancel-subscription-dialog'
import { RenewSubscriptionDialog } from './dialogs/renew-subscription-dialog'

function CycleUsageRow({
  label,
  used,
  total,
}: {
  label: string
  used: number
  total: number
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div>
      <div className='text-muted-foreground flex items-center justify-between text-xs'>
        <span>{label}</span>
        <span>
          {formatQuota(used)} / {formatQuota(total)}
        </span>
      </div>
      <Progress value={pct} className='mt-0.5 h-1' />
    </div>
  )
}

function SubscriptionItem({
  sub,
  plan,
  isPreferred,
  onRenew,
  onCancel,
}: {
  sub: UserSubscriptionRecord
  plan?: SubscriptionPlan
  isPreferred?: boolean
  onRenew: (sub: UserSubscriptionRecord) => void
  onCancel: (sub: UserSubscriptionRecord) => void
}) {
  const { t } = useTranslation()
  const { refresh } = useMySubscriptions()
  const [updating, setUpdating] = useState(false)

  const subscription = sub.subscription
  const totalAmount = Number(subscription?.amount_total || 0)
  const usedAmount = Number(subscription?.amount_used || 0)
  const remainAmount =
    totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
  const remainDays = getRemainingDays(sub)
  const usagePercent = getUsagePercent(sub)
  const nextResetTime = subscription?.next_cycle_reset_at ?? 0
  const { isActive, isCancelled } = classifySubscriptionStatus(sub)

  // 独立额度计数器：周期/周/月各自累计，不由 amount_used 快照推演。
  const cycleLimit = Number(plan?.reset_amount_limit || 0)
  const cycleUsed = Number(subscription?.cycle_used || 0)
  const hasCycleLimit = cycleLimit > 0
  const weekLimit = Number(plan?.weekly_amount_limit || 0)
  const monthLimit = Number(plan?.monthly_amount_limit || 0)
  const weekUsed = Number(subscription?.week_used || 0)
  const monthUsed = Number(subscription?.month_used || 0)

  let statusBadge = (
    <StatusBadge label={t('Expired')} variant='neutral' copyable={false} />
  )
  if (isActive) {
    statusBadge = (
      <StatusBadge label={t('Active')} variant='success' copyable={false} />
    )
  } else if (isCancelled) {
    statusBadge = (
      <StatusBadge label={t('Cancelled')} variant='neutral' copyable={false} />
    )
  }

  let endTimeLabel = t('Expired at')
  if (isActive) {
    endTimeLabel = t('Until')
  } else if (isCancelled) {
    endTimeLabel = t('Cancelled at')
  }

  const handleAutoRenew = async (enabled: boolean) => {
    if (!subscription) return
    setUpdating(true)
    try {
      const res = await setSubscriptionAutoRenew(subscription.id, enabled)
      if (res.success) {
        toast.success(enabled ? t('Auto-renew enabled') : t('Auto-renew disabled'))
      } else {
        toast.error(res.message || t('Request failed'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setUpdating(false)
      void refresh()
    }
  }

  const handleSetPriority = async () => {
    if (!subscription) return
    setUpdating(true)
    try {
      const res = await setSubscriptionPriority(subscription.id)
      if (res.success) {
        toast.success(t('Set as preferred subscription'))
      } else {
        toast.error(res.message || t('Request failed'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setUpdating(false)
      void refresh()
    }
  }

  return (
    <div className='bg-card flex flex-col overflow-hidden rounded-2xl border shadow-xs'>
      {/* 顶栏：计划名 + 状态 + 剩余天数 */}
      <div className='flex items-center justify-between gap-2 border-b px-4 py-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-semibold'>
            {plan?.title
              ? `${plan.title} · ${t('Subscription')} #${subscription?.id}`
              : `${t('Subscription')} #${subscription?.id}`}
          </span>
          {statusBadge}
          {isPreferred && (
            <StatusBadge
              label={t('Preferred')}
              variant='info'
              copyable={false}
            />
          )}
          {isActive && subscription?.cancel_at_end && (
            <StatusBadge
              label={t('Cancels at end')}
              variant='neutral'
              copyable={false}
            />
          )}
        </div>
        {isActive && (
          <span className='text-muted-foreground shrink-0 text-xs'>
            {t('{{count}} days remaining', {
              count: remainDays,
            })}
          </span>
        )}
      </div>

      {/* 额度主体 */}
      <div className='flex-1 px-4 py-3'>
        {totalAmount > 0 ? (
          <>
            <div className='flex items-end justify-between gap-2'>
              <div className='min-w-0'>
                <div className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
                  {t('Total Quota')}
                </div>
                <div className='text-foreground mt-0.5 truncate font-mono text-xl font-bold tracking-tight tabular-nums sm:text-2xl'>
                  <Tooltip>
                    <TooltipTrigger render={<span className='cursor-help' />}>
                      {formatQuota(usedAmount)}
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('Raw Quota')}: {usedAmount}
                    </TooltipContent>
                  </Tooltip>
                  <span className='text-muted-foreground text-sm font-normal'>
                    {' '}
                    / {formatQuota(totalAmount)}
                  </span>
                </div>
              </div>
              <span className='text-muted-foreground shrink-0 text-xs'>
                {t('Used')} {usagePercent}%
              </span>
            </div>
            {isActive ? (
              <Progress value={usagePercent} className='mt-2 h-1.5' />
            ) : (
              <div className='bg-muted/50 mt-2 h-1.5 overflow-hidden rounded-full'>
                <div
                  className='bg-muted h-full rounded-full'
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            )}
            <div className='text-muted-foreground mt-1 text-xs'>
              {t('Remaining')} {formatQuota(remainAmount)}
            </div>
          </>
        ) : (
          <div className='flex items-center gap-2'>
            <span className='font-mono text-xl font-bold tracking-tight sm:text-2xl'>
              ∞
            </span>
            <span className='text-muted-foreground text-xs'>
              {t('Unlimited')}
            </span>
          </div>
        )}

        {/* 周期/周/月限额独立于总额度展示：总额度 0（无限）时仍需显示用量 */}
        {(hasCycleLimit || weekLimit > 0 || monthLimit > 0) && isActive && (
          <div className='mt-2 space-y-1.5'>
            {hasCycleLimit && (
              <CycleUsageRow
                label={t('This cycle')}
                used={cycleUsed}
                total={cycleLimit}
              />
            )}
            {weekLimit > 0 && (
              <CycleUsageRow
                label={t('This week')}
                used={weekUsed}
                total={weekLimit}
              />
            )}
            {monthLimit > 0 && (
              <CycleUsageRow
                label={t('This month')}
                used={monthUsed}
                total={monthLimit}
              />
            )}
          </div>
        )}
      </div>

      {/* 自动续费失败提示 */}
      {isActive && subscription?.auto_renew_failed && (
        <div className='bg-destructive/10 text-destructive border-y px-4 py-2 text-xs'>
          {t(
            'Auto-renew failed: insufficient balance or plan unavailable. Please top up or renew manually.'
          )}
        </div>
      )}

      {/* 时间信息条 */}
      <div className='bg-muted/40 text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs'>
        <span className='flex items-center gap-1.5'>
          <Clock className='size-3.5 shrink-0' aria-hidden='true' />
          {endTimeLabel} {formatTimestamp(subscription?.end_time ?? 0)}
        </span>
        {isActive && nextResetTime > 0 && (
          <span className='flex items-center gap-1.5'>
            <RefreshCw className='size-3.5 shrink-0' aria-hidden='true' />
            {t('Reset')} {formatTimestamp(nextResetTime)}
          </span>
        )}
      </div>

      {/* 操作区 */}
      {isActive && (
        <div className='space-y-2 border-t px-4 py-2.5'>
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              className='flex-1'
              onClick={() => onRenew(sub)}
            >
              <RefreshCw className='size-3.5' />
              {t('Renew')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              className='flex-1'
              onClick={() => onCancel(sub)}
            >
              <CalendarX className='size-3.5' />
              {t('Cancel')}
            </Button>
          </div>
          <div className='flex items-center justify-between gap-2 text-xs'>
            <label className='flex items-center gap-1.5'>
              <Switch
                checked={subscription?.auto_renew === true}
                onCheckedChange={handleAutoRenew}
                disabled={updating}
                size='sm'
              />
              {t('Auto-renew')}
            </label>
            <Button
              size='sm'
              variant='ghost'
              onClick={handleSetPriority}
              disabled={updating}
            >
              <ChevronsUp className='size-3.5' />
              {t('Use First')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function SubscriptionList({
  subscriptions,
  planMap,
}: {
  subscriptions: UserSubscriptionRecord[]
  planMap: Map<number, SubscriptionPlan>
}) {
  const { t } = useTranslation()
  const { refresh } = useMySubscriptions()
  const [renewTarget, setRenewTarget] =
    useState<UserSubscriptionRecord | null>(null)
  const [cancelTarget, setCancelTarget] =
    useState<UserSubscriptionRecord | null>(null)

  // A subscription is "preferred" when it has the lowest priority among active
  // ones and priorities actually differ (i.e. the user has chosen a preference).
  const preferredSet = useMemo(() => {
    const actives = subscriptions.filter((s) =>
      classifySubscriptionStatus(s).isActive
    )
    if (actives.length < 2) return new Set<number>()
    const ps = actives.map((s) => Number(s.subscription?.priority || 0))
    const minP = Math.min(...ps)
    const maxP = Math.max(...ps)
    if (maxP <= minP) return new Set<number>()
    return new Set(
      actives
        .filter((s) => Number(s.subscription?.priority || 0) === minP)
        .map((s) => s.subscription?.id)
    )
  }, [subscriptions])

  if (subscriptions.length === 0) {
    return (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        {t('No subscriptions yet')}
      </p>
    )
  }

  return (
    <div className='grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3'>
      {subscriptions.map((sub) => {
        const subscription = sub.subscription
        return (
          <SubscriptionItem
            key={subscription?.id}
            sub={sub}
            plan={planMap.get(subscription?.plan_id)}
            isPreferred={!!subscription && preferredSet.has(subscription.id)}
            onRenew={(s) => setRenewTarget(s)}
            onCancel={(s) => setCancelTarget(s)}
          />
        )
      })}

      <RenewSubscriptionDialog
        open={!!renewTarget}
        onOpenChange={(open) => {
          if (!open) setRenewTarget(null)
        }}
        subscription={renewTarget}
        plan={renewTarget ? planMap.get(renewTarget.subscription?.plan_id) : null}
        onSuccess={refresh}
      />
      <CancelSubscriptionDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
        subscription={cancelTarget}
        onSuccess={refresh}
      />
    </div>
  )
}

