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
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatCompactTimestamp,
  formatTimestamp,
  formatWindowPeriod,
  isCapWindow,
  parsePlanResetWindows,
  parseWindowStates,
  windowRowDurationSeconds,
} from '@/features/subscriptions/lib'
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
} from '../lib/helpers'
import { CancelSubscriptionDialog } from './dialogs/cancel-subscription-dialog'
import { RenewSubscriptionDialog } from './dialogs/renew-subscription-dialog'
import { useMySubscriptions } from './my-subscriptions-provider'

// 每限额一张独立小卡（动态窗口与 legacy 统一）。外壳带边框；进度条按使用率阈值变色
// （>=90 红 / >=70 琥珀 / 其余主色）；动态窗口底部显示下次重置时间或封顶标注。
function LimitMiniCard({
  label,
  used,
  total,
  resetAt,
  noReset,
  isCap,
}: {
  label: string
  used: number
  total: number
  resetAt?: number
  noReset?: boolean
  // 封顶窗口：label 已是 "Total cap"，不再重复底部提示行。
  isCap?: boolean
}) {
  const { t } = useTranslation()
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  let barClass = 'bg-primary'
  if (pct >= 90) {
    barClass = 'bg-destructive'
  } else if (pct >= 70) {
    barClass = 'bg-warning'
  }
  const showResetLine = noReset || (!!resetAt && resetAt > 0)
  return (
    <div className='bg-background/60 rounded-lg border px-2.5 py-2 sm:rounded-xl sm:p-3'>
      <div className='text-muted-foreground truncate text-[11px]'>{label}</div>
      <div className='mt-1 truncate font-mono text-sm font-semibold tabular-nums'>
        {formatQuota(used)}
        <span className='text-muted-foreground'>/{formatQuota(total)}</span>
      </div>
      <div className='bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full'>
        <div
          className={`${barClass} h-full rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!isCap && showResetLine && (
        <div className='text-muted-foreground mt-1 truncate text-[10px]'>
          {noReset
            ? t('Total cap')
            : `${t('Reset')} ${formatCompactTimestamp(resetAt || 0)}`}
        </div>
      )}
    </div>
  )
}

// 次要徽标：icon-only 小圆点 + hover 提示，避免标题行堆一长串文字。
export function BadgeChip({
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
  // 动态窗口模型：每窗口一张独立限额小卡（各窗口剩余取最小即当前可用）。
  const resetWindows = parsePlanResetWindows(plan?.reset_windows)
  const windowStates = parseWindowStates(subscription?.window_state)
  const isDynamic = resetWindows.length > 0
  // 动态窗口按周期时长升序展示（最短在前）；窗口状态按原索引对齐，排序只影响展示顺序。
  const windowPairs = isDynamic
    ? resetWindows
        .map((w, i) => ({ w, state: windowStates[i] }))
        .sort(
          (a, b) =>
            windowRowDurationSeconds(a.w) - windowRowDurationSeconds(b.w)
        )
    : []
  // 无上限 = 无限额度：legacy 的 total_amount<=0，或动态窗口全部 limit=0（后端视为
  // 无限，后端已拒绝全 0 保存，此处防御手改库/旧数据）。
  const unlimited = isDynamic
    ? resetWindows.every((w) => (w.limit || 0) <= 0)
    : totalAmount <= 0
  const remainDays = getRemainingDays(sub)
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

      {/* 限额主体：每个限额一张独立小卡（动态窗口与 legacy 统一）；无上限时显示 ∞ */}
      <div className='flex flex-1 flex-col gap-3 px-4 py-3'>
        {unlimited ? (
          <div className='flex items-center gap-2'>
            <span className='font-mono text-3xl font-bold tracking-tight'>∞</span>
            <span className='text-muted-foreground text-xs'>
              {t('Unlimited')}
            </span>
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3'>
            {isDynamic
              ? windowPairs.map(({ w, state }) => {
                  // 周期 >= 有效期的窗口是封顶上限：只显示额度，不暴露周期（如 "12 个月"）。
                  const isCap = isCapWindow(w, plan)
                  return (
                    <LimitMiniCard
                      key={`${w.unit}-${w.value}`}
                      label={
                        isCap ? t('Total cap') : formatWindowPeriod(w, t)
                      }
                      used={state?.cycle_used || 0}
                      total={w.limit || 0}
                      resetAt={state?.next_reset_at || 0}
                      noReset={!!(
                        state &&
                        state.next_reset_at === 0 &&
                        state.cycle_start_at > 0
                      )}
                      isCap={isCap}
                    />
                  )
                })
              : (
                  <>
                    {hasCycleLimit && (
                      <LimitMiniCard
                        label={t('This cycle')}
                        used={cycleUsed}
                        total={cycleLimit}
                      />
                    )}
                    {weekLimit > 0 && (
                      <LimitMiniCard
                        label={t('This week')}
                        used={weekUsed}
                        total={weekLimit}
                      />
                    )}
                    {monthLimit > 0 && (
                      <LimitMiniCard
                        label={t('This month')}
                        used={monthUsed}
                        total={monthLimit}
                      />
                    )}
                  </>
                )}
          </div>
        )}

        {/* 副信息：到期时间（legacy 追加周期重置）+ 状态标签（停售/优先/到期取消） */}
        <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs'>
          <span className='flex flex-wrap items-center gap-x-4 gap-y-1'>
            <span className='flex items-center gap-1.5'>
              <Clock className='size-3.5 shrink-0' aria-hidden='true' />
              {endTimeLabel} {formatTimestamp(subscription?.end_time ?? 0)}
            </span>
            {isActive && !isDynamic && nextResetTime > 0 && (
              <span className='flex items-center gap-1.5'>
                <RefreshCw className='size-3.5 shrink-0' aria-hidden='true' />
                {t('Reset')} {formatTimestamp(nextResetTime)}
              </span>
            )}
          </span>
          {(discontinued ||
            isPreferred ||
            (isActive && subscription?.cancel_at_end)) && (
            <span className='flex items-center gap-1.5'>
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
            </span>
          )}
        </div>
      </div>

      {/* 自动续费失败提示 */}
      {isActive && !cancelledAtEnd && subscription?.auto_renew_failed && (
        <div className='bg-destructive/10 text-destructive border-y px-4 py-2 text-xs'>
          {t(
            'Auto-renew failed: insufficient balance or plan unavailable. Please top up or renew manually.'
          )}
        </div>
      )}

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
    // 单个订阅时全宽大卡片（一般只同时持有一个，规则多也不怕）；多个时才并排。
    <div
      className={`grid grid-cols-1 gap-3 sm:gap-4 ${
        subscriptions.length > 1 ? 'md:grid-cols-2 xl:grid-cols-3' : ''
      }`}
    >
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
