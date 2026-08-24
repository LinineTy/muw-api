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
import { ArrowLeftRight, CheckCircle2, Sparkles } from 'lucide-react'
import { Fragment, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import { GroupCollapsibleSection } from '@/features/subscriptions/components/group-collapsible-section'
import {
  formatDuration,
  formatWindowPeriodLabel,
  isCapWindow,
  parsePlanResetWindows,
} from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  SubscriptionPlan,
  UserSubscription,
} from '@/features/subscriptions/types'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { useMySubscriptions } from './my-subscriptions-provider'
import { classifySubscriptionStatus, getEpayMethods } from '../lib/helpers'
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

function BenefitRow({ children }: { children: string }) {
  return (
    <li className='flex min-h-5 min-w-0 items-center gap-2'>
      <CheckCircle2
        className='text-primary size-4 shrink-0'
        aria-hidden='true'
      />
      <span className='text-foreground/80 truncate text-xs'>{children}</span>
    </li>
  )
}

// 每个套餐在目录里展示时的可购买状态，供平铺卡片与分组视图条目共用。
interface PlanActionState {
  count: number
  limit: number
  reached: boolean
  allowedGroups: string[]
  groupRestricted: boolean
  isCurrent: boolean
  sameGroupActive: {
    sub: UserSubscription
    oldPlan: SubscriptionPlan | null
  } | null
  tierDirection: number
  maxSimultaneous: number
  activeCount: number
  simultaneousReached: boolean
}

function PlanActionButton({
  plan,
  state,
  onSubscribe,
  onSwitch,
}: {
  plan: SubscriptionPlan
  state: PlanActionState
  onSubscribe: (plan: SubscriptionPlan) => void
  onSwitch: (plan: SubscriptionPlan) => void
}) {
  const { t } = useTranslation()

  if (state.reached) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div />}>
          <Button variant='outline' className='w-full' disabled>
            {t('Limit Reached')}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('Purchase limit reached')} ({state.count}/{state.limit})
        </TooltipContent>
      </Tooltip>
    )
  }
  if (state.groupRestricted) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div />}>
          <Button variant='outline' className='w-full' disabled>
            {t('Only for: {{groups}}', {
              groups: state.allowedGroups.join(', '),
            })}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('Only users in these groups can subscribe')}:{' '}
          {state.allowedGroups.join(', ')}
        </TooltipContent>
      </Tooltip>
    )
  }
  if (state.isCurrent) {
    return (
      <Button variant='outline' className='w-full' disabled>
        {t('Subscribed')}
      </Button>
    )
  }
  if (state.sameGroupActive) {
    let direction = t('Upgrade / Downgrade')
    if (state.tierDirection > 0) {
      direction = t('Upgrade')
    } else if (state.tierDirection < 0) {
      direction = t('Downgrade')
    }
    return (
      <Button
        variant='outline'
        className='w-full'
        onClick={() => onSwitch(plan)}
      >
        <ArrowLeftRight className='size-4' />
        {direction}
      </Button>
    )
  }
  if (state.simultaneousReached) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div />}>
          <Button variant='outline' className='w-full' disabled>
            {t('Max Simultaneous Reached')}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('Max simultaneous subscriptions')} ({state.activeCount}/
          {state.maxSimultaneous})
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Button
      variant={plan.is_recommended ? 'default' : 'outline'}
      className='w-full'
      onClick={() => onSubscribe(plan)}
    >
      {t('Subscribe Now')}
    </Button>
  )
}

// 平铺视图下的单套餐卡片。
function CatalogPlanCard({
  plan,
  state,
  onSubscribe,
  onSwitch,
}: {
  plan: SubscriptionPlan
  state: PlanActionState
  onSubscribe: (plan: SubscriptionPlan) => void
  onSwitch: (plan: SubscriptionPlan) => void
}) {
  const { t } = useTranslation()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencySymbol =
    currencyMeta.kind === 'tokens' ? '$' : currencyMeta.symbol
  const price = Number(plan.price_amount || 0).toFixed(2)
  const isPopular = plan.is_recommended === true

  const maxDays = Math.floor(Number(plan.max_cumulative_seconds || 0) / 86400)
  const resetWindows = parsePlanResetWindows(plan.reset_windows)
  const unlimited =
    resetWindows.length > 0 && resetWindows.every((w) => Number(w.limit) <= 0)

  // 权益清单：动态窗口 = 每个窗口一条（封顶窗口单独标注）；全部窗口额度 0 = 无限额度。
  const benefits: string[] = []
  if (unlimited) {
    benefits.push(t('Unlimited'))
  } else {
    resetWindows.forEach((w) => {
      const period = formatWindowPeriodLabel(w, t)
      const amount = formatQuota(w.limit || 0)
      benefits.push(
        // 封顶窗口（周期 >= 有效期）只显示总额度，不暴露周期（如 "12 个月"）。
        isCapWindow(w, plan)
          ? t('{{amount}} total', { amount })
          : t('{{amount}} every {{period}}', { amount, period })
      )
    })
  }
  if (maxDays > 0) {
    benefits.push(t('Up to {{days}} days', { days: maxDays }))
  }
  if (plan.upgrade_group) {
    benefits.push(t('Upgrade to {{group}}', { group: plan.upgrade_group }))
  }

  return (
    <div
      data-card-hover='false'
      className={cn(
        'bg-card flex h-full min-h-[280px] flex-col justify-between gap-4 rounded-xl border border-border/70 p-5',
        isPopular && 'border-primary/40'
      )}
    >
      {/* 头部：标题 + 推荐 tag + 副标题 */}
      <div className='flex flex-col gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <h3 className='truncate text-lg font-medium'>
            {plan.title || t('Subscription Plans')}
          </h3>
          {isPopular && (
            <span className='bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium'>
              <Sparkles className='size-3' />
              {t('Recommended')}
            </span>
          )}
        </div>

        {/* 副标题固定单行高度：无说明文字时显示淡色占位，保证卡片间虚线对齐 */}
        <p
          className={cn(
            'min-h-5 truncate text-xs',
            plan.subtitle ? 'text-muted-foreground' : 'text-muted-foreground/50'
          )}
          title={plan.subtitle}
        >
          {plan.subtitle || t('No description')}
        </p>

        {/* 价格行：货币符号 + 大价格 + 周期 */}
        <div className='flex flex-wrap items-end gap-1 pt-1'>
          <span className='text-primary text-sm leading-5'>
            {currencySymbol}
          </span>
          <span className='text-primary text-3xl leading-8 font-bold'>
            {price}
          </span>
          <span className='text-foreground/70 text-sm leading-6'>
            / {formatDuration(plan, t)}
          </span>
        </div>

        {/* 虚线分隔 */}
        <div className='border-t border-dashed border-border/70 pt-3' />

        {/* 权益列表：双列排布压缩卡片高度 */}
        <ul className='grid grid-cols-2 gap-x-3 gap-y-1.5'>
          {benefits.map((benefit) => (
            <BenefitRow key={benefit}>{benefit}</BenefitRow>
          ))}
        </ul>
      </div>

      {/* 底部操作区：限购提示 + 按钮 */}
      <div className='flex flex-col gap-2'>
        {state.limit > 0 && (
          <p className='text-muted-foreground text-center text-[11px]'>
            {t('Purchase Limit')}: {state.limit}
          </p>
        )}
        <PlanActionButton
          plan={plan}
          state={state}
          onSubscribe={onSubscribe}
          onSwitch={onSwitch}
        />
      </div>
    </div>
  )
}

export function PlanCatalogSection({ grouped }: { grouped: boolean }) {
  const { t } = useTranslation()
  const { plans, planMap, selfData, topupInfo, userQuota, userGroup, refresh } =
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

  const findSameGroupSub = useCallback(
    (targetPlan?: SubscriptionPlan | null) => {
      if (!targetPlan?.exclusive_group) return null
      for (const s of allSubscriptions) {
        const sub = s.subscription
        if (!sub) continue
        // 优先用订阅创建时的互斥组快照；为空时回退到该订阅对应套餐当前的互斥组，
        // 兼容互斥组配置之后才创建/分配的订阅（快照缺失）。
        const subGroup =
          sub.exclusive_group ||
          planMap.get(sub.plan_id)?.exclusive_group ||
          ''
        if (!subGroup || subGroup !== targetPlan.exclusive_group) continue
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

  // 分组视图：互斥组聚合成块，无互斥组的套餐单独列出。
  const groupedData = useMemo(() => {
    const groupMap = new Map<string, SubscriptionPlan[]>()
    const standalone: SubscriptionPlan[] = []
    for (const p of plans) {
      const plan = p?.plan
      if (!plan) continue
      const group = plan.exclusive_group
      if (!group) {
        standalone.push(plan)
      } else {
        const list = groupMap.get(group)
        if (list) {
          list.push(plan)
        } else {
          groupMap.set(group, [plan])
        }
      }
    }
    return { groups: [...groupMap.entries()], standalone }
  }, [plans])

  const resolvePlanState = useCallback(
    (plan: SubscriptionPlan): PlanActionState => {
      const limit = Number(plan.max_purchase_per_user || 0)
      const count = planPurchaseCountMap.get(plan.id) || 0
      const reached = limit > 0 && count >= limit
      const allowedGroups = parseAllowedGroups(plan.allowed_groups)
      const groupRestricted =
        allowedGroups.length > 0 && !allowedGroups.includes(userGroup)
      const sameGroupActive = findSameGroupSub(plan)
      const isCurrent = !!findActiveSubByPlanId(plan.id)
      const tierDirection = sameGroupActive
        ? comparePlanTier(plan, sameGroupActive.oldPlan)
        : 0
      // 全局同时持有订阅数上限：与每套餐购买上限独立。达到上限后整份购买被后端拒绝，
      // 这里提前置灰；互斥组内切换不新增订阅，仍允许。
      const maxSimultaneous = Number(selfData?.max_simultaneous || 0)
      const activeCount = selfData?.subscriptions?.length ?? 0
      const simultaneousReached =
        maxSimultaneous > 0 &&
        activeCount >= maxSimultaneous &&
        !sameGroupActive
      return {
        count,
        limit,
        reached,
        allowedGroups,
        groupRestricted,
        isCurrent,
        sameGroupActive,
        tierDirection,
        maxSimultaneous,
        activeCount,
        simultaneousReached,
      }
    },
    [
      planPurchaseCountMap,
      userGroup,
      findSameGroupSub,
      findActiveSubByPlanId,
      comparePlanTier,
      selfData,
    ]
  )

  const handleSubscribe = useCallback((plan: SubscriptionPlan) => {
    setSelectedPlan({ plan })
    setPurchaseOpen(true)
  }, [])
  const handleSwitch = useCallback((plan: SubscriptionPlan) => {
    setSwitchTarget({ plan })
  }, [])

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
      <div className='space-y-3'>
        {grouped ? (
          <div className='space-y-2'>
            {groupedData.groups.map(([group, groupPlans], index) => (
              <Fragment key={group}>
                {index > 0 && <Separator />}
                <GroupCollapsibleSection
                  group={group}
                  count={groupPlans.length}
                  contentClassName='gap-3 sm:gap-4 lg:grid-cols-3'
                >
                  {groupPlans.map((plan) => (
                    <CatalogPlanCard
                      key={plan.id}
                      plan={plan}
                      state={resolvePlanState(plan)}
                      onSubscribe={handleSubscribe}
                      onSwitch={handleSwitch}
                    />
                  ))}
                </GroupCollapsibleSection>
              </Fragment>
            ))}
            {groupedData.standalone.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className='text-muted-foreground px-2 py-1.5 text-sm font-medium'>
                    {t('Standalone plans')}
                  </div>
                  <div className='mt-3 grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3'>
                    {groupedData.standalone.map((plan) => (
                      <CatalogPlanCard
                        key={plan.id}
                        plan={plan}
                        state={resolvePlanState(plan)}
                        onSubscribe={handleSubscribe}
                        onSwitch={handleSwitch}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3'>
            {plans.map((p) => {
              const plan = p?.plan
              if (!plan) return null
              return (
                <CatalogPlanCard
                  key={plan.id}
                  plan={plan}
                  state={resolvePlanState(plan)}
                  onSubscribe={handleSubscribe}
                  onSwitch={handleSwitch}
                />
              )
            })}
          </div>
        )}
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
