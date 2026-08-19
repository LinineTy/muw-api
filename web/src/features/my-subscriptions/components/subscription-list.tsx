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
import {
  CalendarX,
  CheckCircle2,
  ChevronsUp,
  Clock,
  PackageX,
  RefreshCw,
  Star,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  StatusBadge,
  textColorMap,
  type StatusVariant,
} from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestamp } from '@/features/subscriptions/lib'
import type {
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { setSubscriptionAutoRenew, setSubscriptionPriority } from '../api'
import {
  classifySubscriptionStatus,
  getRemainingDays,
  getUsagePercent,
} from '../lib/helpers'
import { CancelSubscriptionDialog } from './dialogs/cancel-subscription-dialog'
import { RenewSubscriptionDialog } from './dialogs/renew-subscription-dialog'
import { useMySubscriptions } from './my-subscriptions-provider'

// 周期/周/月限额的紧凑小仪表（并排栅格用）。
function MiniMeter({
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
    <div className='min-w-0'>
      <div className='text-muted-foreground truncate text-[11px]'>{label}</div>
      <div className='mt-0.5 truncate font-mono text-xs font-medium tabular-nums'>
        {formatQuota(used)}
        <span className='text-muted-foreground'>/{formatQuota(total)}</span>
      </div>
      <Progress value={pct} className='mt-1 h-1' />
    </div>
  )
}

// 次要徽标：icon-only 小圆点 + hover 提示，避免标题行堆一长串文字。
function BadgeChip({
  icon: Icon,
  label,
  variant,
}: {
  icon: LucideIcon
  label: string
  variant: StatusVariant
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              'inline-flex size-5 cursor-help items-center justify-center rounded-full bg-muted',
              textColorMap[variant]
            )}
          />
        }
      >
        <Icon className='size-3.5' aria-hidden='true' />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
  // 到期取消后的订阅：续费和自动续费都被后端禁止，操作区只保留取消（可立即取消）。
  const cancelledAtEnd = subscription?.cancel_at_end === true
  // 订阅的套餐已停售（禁用）：存量仍可用/可续，但给个标识让用户知道不再售卖。
  const discontinued = plan?.enabled === false

  // 独立额度计数器：周期/周/月各自累计，不由 amount_used 快照推演。
  const cycleLimit = Number(plan?.reset_amount_limit || 0)
  const cycleUsed = Number(subscription?.cycle_used || 0)
  const hasCycleLimit = cycleLimit > 0
  const weekLimit = Number(plan?.weekly_amount_limit || 0)
  const monthLimit = Number(plan?.monthly_amount_limit || 0)
  const weekUsed = Number(subscription?.week_used || 0)
  const monthUsed = Number(subscription?.month_used || 0)

  let statusBadge = (
    <StatusBadge
      label={t('Expired')}
      variant='neutral'
      icon={Clock}
      copyable={false}
    />
  )
  if (isActive) {
    statusBadge = (
      <StatusBadge
        label={t('Active')}
        variant='success'
        icon={CheckCircle2}
        copyable={false}
      />
    )
  } else if (isCancelled) {
    statusBadge = (
      <StatusBadge
        label={t('Cancelled')}
        variant='neutral'
        icon={XCircle}
        copyable={false}
      />
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
        toast.success(
          enabled ? t('Auto-renew enabled') : t('Auto-renew disabled')
        )
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
      {/* 头部：标题 + 订阅 id + 状态，右侧剩余天数 pill */}
      <div className='flex items-center justify-between gap-2 border-b px-4 py-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <h3 className='truncate text-sm font-semibold'>
            {plan?.title
              ? plan.title
              : `${t('Subscription')} #${subscription?.id}`}
          </h3>
          {plan?.title && subscription?.id ? (
            <span className='text-muted-foreground shrink-0 text-xs'>
              #{subscription.id}
            </span>
          ) : null}
          {statusBadge}
        </div>
        {isActive && (
          <span className='bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'>
            {t('{{count}} days remaining', { count: remainDays })}
          </span>
        )}
      </div>

      {/* 额度主体：剩余额度为视觉焦点 */}
      <div className='flex flex-1 flex-col gap-3 px-4 py-3'>
        {totalAmount > 0 ? (
          <div>
            <div className='flex items-end justify-between gap-2'>
              <div className='min-w-0'>
                <div className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
                  {t('Remaining')}
                </div>
                <div className='text-foreground mt-0.5 truncate font-mono text-2xl font-bold tracking-tight tabular-nums'>
                  {formatQuota(remainAmount)}
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
              <Tooltip>
                <TooltipTrigger render={<span className='cursor-help' />}>
                  {formatQuota(usedAmount)}
                </TooltipTrigger>
                <TooltipContent>
                  {t('Raw Quota')}: {usedAmount}
                </TooltipContent>
              </Tooltip>
              {' / '}
              {formatQuota(totalAmount)}
            </div>
          </div>
        ) : (
          <div className='flex items-center gap-2'>
            <span className='font-mono text-2xl font-bold tracking-tight'>
              ∞
            </span>
            <span className='text-muted-foreground text-xs'>
              {t('Unlimited')}
            </span>
          </div>
        )}

        {/* 周期/周/月限额：并排小栅格 */}
        {(hasCycleLimit || weekLimit > 0 || monthLimit > 0) && isActive && (
          <div className='grid grid-cols-3 gap-3'>
            {hasCycleLimit && (
              <MiniMeter
                label={t('This cycle')}
                used={cycleUsed}
                total={cycleLimit}
              />
            )}
            {weekLimit > 0 && (
              <MiniMeter
                label={t('This week')}
                used={weekUsed}
                total={weekLimit}
              />
            )}
            {monthLimit > 0 && (
              <MiniMeter
                label={t('This month')}
                used={monthUsed}
                total={monthLimit}
              />
            )}
          </div>
        )}

        {/* 次要徽标：icon-only + hover 提示 */}
        {(discontinued ||
          isPreferred ||
          (isActive && subscription?.cancel_at_end)) && (
          <div className='flex items-center gap-1.5'>
            {discontinued && (
              <BadgeChip
                icon={PackageX}
                label={t('Discontinued')}
                variant='warning'
              />
            )}
            {isPreferred && (
              <BadgeChip icon={Star} label={t('Preferred')} variant='info' />
            )}
            {isActive && subscription?.cancel_at_end && (
              <BadgeChip
                icon={CalendarX}
                label={t('Cancels at end')}
                variant='neutral'
              />
            )}
          </div>
        )}
      </div>

      {/* 自动续费失败提示 */}
      {isActive && !cancelledAtEnd && subscription?.auto_renew_failed && (
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
        <div className='border-t px-4 py-2.5'>
          <div className='flex items-center gap-2'>
            {!cancelledAtEnd && (
              <Button
                size='sm'
                variant='outline'
                className='flex-1'
                onClick={() => onRenew(sub)}
              >
                <RefreshCw className='size-3.5' />
                {t('Renew')}
              </Button>
            )}
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
          <div className='mt-2 flex items-center justify-between gap-2 text-xs'>
            <label className='flex items-center gap-1.5'>
              <Switch
                checked={subscription?.auto_renew === true}
                onCheckedChange={handleAutoRenew}
                disabled={updating || cancelledAtEnd}
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
  const [renewTarget, setRenewTarget] = useState<UserSubscriptionRecord | null>(
    null
  )
  const [cancelTarget, setCancelTarget] =
    useState<UserSubscriptionRecord | null>(null)

  // A subscription is "preferred" when it has the lowest priority among active
  // ones and priorities actually differ (i.e. the user has chosen a preference).
  const preferredSet = useMemo(() => {
    const actives = subscriptions.filter(
      (s) => classifySubscriptionStatus(s).isActive
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
        plan={
          renewTarget ? planMap.get(renewTarget.subscription?.plan_id) : null
        }
        onSuccess={refresh}
      />
      <CancelSubscriptionDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
        subscription={cancelTarget}
        plan={
          cancelTarget ? planMap.get(cancelTarget.subscription?.plan_id) : null
        }
        onSuccess={refresh}
      />
    </div>
  )
}
