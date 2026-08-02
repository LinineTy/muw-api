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
import { ArrowLeftRight, Sparkles } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import {
  formatDuration,
  formatResetPeriod,
} from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  SubscriptionPlan,
} from '@/features/subscriptions/types'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { useMySubscriptions } from './my-subscriptions-provider'
import { getEpayMethods } from '../lib/helpers'
import { classifySubscriptionStatus } from '../lib/helpers'
import { SwitchPlanDialog } from './dialogs/switch-plan-dialog'

function parseAllowedGroups(raw?: string): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((g): g is string => typeof g === 'string')
      : []
  } catch {
    return []
  }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <div className='text-muted-foreground text-[11px] font-medium select-none'>
        {label}
      </div>
      <div className='text-muted-foreground min-w-0 truncate text-sm'>
        {value}
      </div>
    </div>
  )
}

export function PlanCatalogSection() {
  const { t } = useTranslation()
  const { plans, selfData, topupInfo, userQuota, userGroup, refresh } =
    useMySubscriptions()

  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  const [switchTarget, setSwitchTarget] = useState<PlanRecord | null>(null)

  const enableOnlineTopUp = !!topupInfo?.enable_online_topup
  const epayMethods = useMemo(
    () => getEpayMethods(topupInfo?.pay_methods),
    [topupInfo?.pay_methods]
  )

  const allSubscriptions = useMemo(
    () => selfData?.all_subscriptions ?? [],
    [selfData]
  )
  const planPurchaseCountMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const sub of allSubscriptions) {
      const planId = sub?.subscription?.plan_id
      if (!planId) continue
      map.set(planId, (map.get(planId) || 0) + 1)
    }
    return map
  }, [allSubscriptions])

  const planMap = useMemo(() => {
    const map = new Map<number, SubscriptionPlan>()
    for (const p of plans) {
      if (p?.plan?.id) {
        map.set(p.plan.id, p.plan)
      }
    }
    return map
  }, [plans])

  const findSameGroupSub = useCallback(
    (targetPlan?: SubscriptionPlan | null) => {
      if (!targetPlan?.exclusive_group) return null
      for (const s of allSubscriptions) {
        const sub = s.subscription
        if (!sub || sub.exclusive_group !== targetPlan.exclusive_group) continue
        if (!classifySubscriptionStatus(s).isActive) continue
        return { sub, oldPlan: planMap.get(sub.plan_id) || null }
      }
      return null
    },
    [allSubscriptions, planMap]
  )

  // 当前已订阅的本套餐（按 plan_id 匹配活跃订阅，与互斥组无关）。
  const findActiveSubByPlanId = useCallback(
    (planId?: number) => {
      if (!planId) return null
      for (const s of allSubscriptions) {
        const sub = s.subscription
        if (!sub || sub.plan_id !== planId) continue
        if (!classifySubscriptionStatus(s).isActive) continue
        return { sub, plan: planMap.get(sub.plan_id) || null }
      }
      return null
    },
    [allSubscriptions, planMap]
  )

  // 档位比较：优先比套餐 Priority，相等回退比价格。>0 = target 更高档。
  const comparePlanTier = useCallback(
    (target?: SubscriptionPlan | null, current?: SubscriptionPlan | null) => {
      if (!target || !current) return 0
      const tp = Number(target.priority || 0)
      const cp = Number(current.priority || 0)
      if (tp !== cp) return tp > cp ? 1 : -1
      const ta = Number(target.price_amount || 0)
      const ca = Number(current.price_amount || 0)
      if (ta !== ca) return ta > ca ? 1 : -1
      return 0
    },
    []
  )

  const switchInfo = switchTarget
    ? findSameGroupSub(switchTarget.plan)
    : null

  if (plans.length === 0) {
    return (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        {t('No plans available')}
      </p>
    )
  }

  return (
    <>
      <div className='grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3 2xl:gap-4'>
        {plans.map((p) => {
          const plan = p?.plan
          if (!plan) return null
          const totalAmount = Number(plan.total_amount || 0)
          const price = Number(plan.price_amount || 0).toFixed(2)
          const isPopular = plan.is_recommended === true
          const limit = Number(plan.max_purchase_per_user || 0)
          const count = planPurchaseCountMap.get(plan.id) || 0
          const reached = limit > 0 && count >= limit

          const allowedGroups = parseAllowedGroups(plan.allowed_groups)
          const groupRestricted =
            allowedGroups.length > 0 && !allowedGroups.includes(userGroup)
          const sameGroupActive = findSameGroupSub(plan)
          const activeSubByPlan = findActiveSubByPlanId(plan.id)
          const isCurrent = !!activeSubByPlan
          const tierDirection = sameGroupActive
            ? comparePlanTier(plan, sameGroupActive.oldPlan)
            : 0

          const weekLimit = Number(plan.weekly_amount_limit || 0)
          const monthLimit = Number(plan.monthly_amount_limit || 0)
          const maxDays = Math.floor(Number(plan.max_cumulative_seconds || 0) / 86400)

          const infoRows = [
            { label: t('Validity'), value: formatDuration(plan, t) },
            formatResetPeriod(plan, t) !== t('No Reset')
              ? { label: t('Quota Reset'), value: formatResetPeriod(plan, t) }
              : null,
            {
              label: t('Plan Quota'),
              value:
                totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited'),
            },
            weekLimit > 0
              ? { label: t('Weekly Quota'), value: formatQuota(weekLimit) }
              : null,
            monthLimit > 0
              ? { label: t('Monthly Quota'), value: formatQuota(monthLimit) }
              : null,
            maxDays > 0
              ? {
                  label: t('Max Duration'),
                  value: `${maxDays} ${t('days')}`,
                }
              : null,
            limit > 0
              ? { label: t('Purchase Limit'), value: `${limit}` }
              : null,
            plan.upgrade_group
              ? { label: t('Upgrade Group'), value: plan.upgrade_group }
              : null,
          ].filter(Boolean) as { label: string; value: string }[]

          return (
            <div
              key={plan.id}
              data-card-hover='false'
              className={cn(
                'bg-card relative flex flex-col overflow-hidden rounded-2xl border shadow-xs',
                isPopular && 'border-primary/70 shadow-sm'
              )}
            >
              {isPopular && (
                <div className='from-primary/60 to-primary/20 absolute inset-x-0 top-0 h-1 bg-linear-to-r' />
              )}

              {/* 顶栏：标题 + 推荐徽标 */}
              <div className='flex items-center justify-between gap-2 border-b px-4 py-3'>
                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate text-sm font-semibold'>
                    {plan.title || t('Subscription Plans')}
                  </span>
                  {isPopular && (
                    <StatusBadge
                      variant='info'
                      copyable={false}
                      className='shrink-0'
                    >
                      <Sparkles className='h-3 w-3' />
                      {t('Recommended')}
                    </StatusBadge>
                  )}
                  {isCurrent && (
                    <StatusBadge
                      variant='success'
                      copyable={false}
                      className='shrink-0'
                    >
                      {t('Current')}
                    </StatusBadge>
                  )}
                </div>
                {plan.subtitle && (
                  <span className='text-muted-foreground truncate text-xs'>
                    {plan.subtitle}
                  </span>
                )}
              </div>

              {/* 价格 + 有效期 */}
              <div className='flex items-baseline gap-2 px-4 pt-3'>
                <span className='text-primary text-2xl font-bold'>
                  ${price}
                </span>
                <span className='text-muted-foreground text-sm'>
                  {formatDuration(plan, t)}
                </span>
              </div>

              {/* 元信息 */}
              <div className='flex-1 px-4 py-3'>
                <div className='grid grid-cols-2 gap-x-4 gap-y-2'>
                  {infoRows.map((row) => (
                    <InfoRow key={row.label} label={row.label} value={row.value} />
                  ))}
                </div>
              </div>

              {/* 操作区 */}
              <div className='border-t px-4 py-2.5'>
                {reached ? (
                  <Tooltip>
                    <TooltipTrigger render={<div />}>
                      <Button variant='outline' className='w-full' disabled>
                        {t('Limit Reached')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('Purchase limit reached')} ({count}/{limit})
                    </TooltipContent>
                  </Tooltip>
                ) : groupRestricted ? (
                  <Tooltip>
                    <TooltipTrigger render={<div />}>
                      <Button variant='outline' className='w-full' disabled>
                        {t('Only for: {{groups}}', {
                          groups: allowedGroups.join(', '),
                        })}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('Only users in these groups can subscribe')}:{' '}
                      {allowedGroups.join(', ')}
                    </TooltipContent>
                  </Tooltip>
                ) : isCurrent ? (
                  <Button variant='outline' className='w-full' disabled>
                    {t('Subscribed')}
                  </Button>
                ) : sameGroupActive ? (
                  <Button
                    variant='outline'
                    className='w-full'
                    onClick={() => setSwitchTarget(p)}
                  >
                    <ArrowLeftRight className='size-4' />
                    {tierDirection > 0
                      ? t('Upgrade')
                      : tierDirection < 0
                        ? t('Downgrade')
                        : t('Upgrade / Downgrade')}
                  </Button>
                ) : (
                  <Button
                    variant='outline'
                    className='w-full'
                    onClick={() => {
                      setSelectedPlan(p)
                      setPurchaseOpen(true)
                    }}
                  >
                    {t('Subscribe Now')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            refresh()
          }
        }}
        plan={selectedPlan}
        enableOnlineTopUp={enableOnlineTopUp}
        epayMethods={epayMethods}
        userQuota={userQuota}
        onPurchaseSuccess={refresh}
        purchaseLimit={
          selectedPlan?.plan?.max_purchase_per_user
            ? Number(selectedPlan.plan.max_purchase_per_user)
            : undefined
        }
        purchaseCount={
          selectedPlan?.plan?.id
            ? planPurchaseCountMap.get(selectedPlan.plan.id)
            : undefined
        }
      />

      <SwitchPlanDialog
        open={!!switchTarget}
        onOpenChange={(open) => {
          if (!open) setSwitchTarget(null)
        }}
        plan={switchTarget?.plan || null}
        oldSub={switchInfo?.sub || null}
        oldPlan={switchInfo?.oldPlan || null}
        onSuccess={refresh}
      />
    </>
  )
}
