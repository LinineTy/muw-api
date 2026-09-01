// @muw-owned
import {
  CalendarX,
  CheckCircle2,
  PackageX,
  RefreshCw,
  Star,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { BadgeChip } from '@/features/my-subscriptions/components/subscription-list'
import {
  setSubscriptionAutoRenew,
  setSubscriptionPriority,
} from '@/features/subscriptions/api'
import {
  buildLimitRows,
  formatTimestamp,
} from '@/features/subscriptions/lib'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'
import { CancelSubscriptionDialog } from '@/features/my-subscriptions/components/dialogs/cancel-subscription-dialog'
import { RenewSubscriptionDialog } from '@/features/my-subscriptions/components/dialogs/renew-subscription-dialog'
import { useMySubscriptions } from '@/features/my-subscriptions/components/my-subscriptions-provider'
import {
  classifySubscriptionStatus,
  getRemainingDays,
} from '@/features/my-subscriptions/lib/helpers'
import { cn } from '@/lib/utils'

import { LimitRow } from './subscription-limit-row'

// 钱包页的「生效订阅」面板（A 形态单列限额列表）。封闭卡片，与钱包其他卡同构、
// 无卡内分割线：标题「我的订阅」+ 套餐下拉选择器（#id 收进下拉项，多订阅时切换）
// + 剩余天数 pill；操作区右下角与状态标签一组放「优先」星标；限额列表 + 续费/取消/自动续费。
export function SubscriptionSummaryCard() {
  const { t } = useTranslation()
  const { selfData, planMap, loading, refresh } = useMySubscriptions()
  const [renewTarget, setRenewTarget] = useState<UserSubscriptionRecord | null>(
    null
  )
  const [cancelTarget, setCancelTarget] = useState<UserSubscriptionRecord | null>(
    null
  )
  const [updating, setUpdating] = useState(false)
  // 标签页选中 id：默认最早到期（主订阅），点击 Tab 切换。
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined)

  const actives = useMemo(
    () =>
      (selfData?.subscriptions || []).filter((s) =>
        classifySubscriptionStatus(s).isActive
      ),
    [selfData]
  )
  // 主订阅 = 最早到期者（默认选中的 Tab）。
  const primary = useMemo(
    () =>
      actives.length > 0
        ? actives.reduce((a, b) =>
            (a.subscription?.end_time || 0) <= (b.subscription?.end_time || 0)
              ? a
              : b
          )
        : null,
    [actives]
  )
  // 当前选中的订阅：优先显式选择，失效/未选择时回退主订阅。
  const selected = useMemo(() => {
    if (actives.length <= 1) return primary
    return (
      actives.find((s) => s.subscription?.id === selectedId) || primary
    )
  }, [actives, primary, selectedId])

  // 所选订阅不再生效（续费/取消后刷新）时回退到主订阅。
  useEffect(() => {
    if (
      selectedId != null &&
      !actives.some((s) => s.subscription?.id === selectedId)
    ) {
      setSelectedId(undefined)
    }
  }, [actives, selectedId])

  const sub = selected?.subscription
  // 套餐解析：记录自带快照优先，缺失时回退 planMap（停售/被删套餐也能渲染标题）。
  const resolvePlan = (record: UserSubscriptionRecord | null) => {
    if (!record) return null
    if (record.plan) return record.plan
    const pid = record.subscription?.plan_id
    return pid ? planMap.get(pid) : null
  }
  const plan = resolvePlan(selected)
  const limitRows = selected ? buildLimitRows(selected, t) : []
  const remainDays = selected ? getRemainingDays(selected) : 0

  // 小状态徽标（与 my-subscriptions 卡片一致）：已停售 / 到期取消
  const discontinued = plan?.enabled === false
  const cancelledAtEnd = sub?.cancel_at_end === true
  // 当前优先订阅 id：生效订阅 >=2 且优先级存在差异时才有意义。
  const preferredId = useMemo(() => {
    if (actives.length < 2) return undefined
    const ps = actives.map((s) => Number(s.subscription?.priority || 0))
    const minP = Math.min(...ps)
    const maxP = Math.max(...ps)
    if (maxP <= minP) return undefined
    return actives.find(
      (s) => Number(s.subscription?.priority || 0) === minP
    )?.subscription?.id
  }, [actives])

  const handleAutoRenew = async (enabled: boolean) => {
    if (!sub) return
    setUpdating(true)
    try {
      const res = await setSubscriptionAutoRenew(sub.id, enabled)
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

  const handleSetPriority = async (id: number) => {
    setUpdating(true)
    try {
      const res = await setSubscriptionPriority(id)
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

  if (loading) {
    return (
      <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
        <div className='space-y-3 px-4 py-4'>
          <Skeleton className='h-4 w-40' />
          <Skeleton className='h-1.5 w-full' />
          <Skeleton className='h-1.5 w-full' />
          <Skeleton className='h-1.5 w-full' />
        </div>
      </div>
    )
  }

  if (!primary) {
    return (
      <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
        <div className='flex items-center justify-between gap-3 px-4 py-4'>
          <div className='text-muted-foreground text-sm'>
            {t('No Active')}
          </div>
          <Button
            size='sm'
            variant='outline'
            render={<Link to='/orders' search={{ tab: 'subscription' }} />}
          >
            {t('Subscribe')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider delay={100}>
      {/* 封闭卡片：四边全边框，无卡内分割线，与左右列卡片一致 */}
      <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
        <div className='flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2 sm:px-5 sm:pt-5 sm:pb-2'>
          {/* 标题 + 套餐下拉 + 状态一行，右侧剩余天数 pill（hover 显示到期时间） */}
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <h3 className='text-sm font-semibold tracking-tight'>
              {t('My Subscriptions')}
            </h3>
            <Select
              value={String(selected?.subscription?.id ?? '')}
              onValueChange={(v) => {
                if (v != null) setSelectedId(Number(v))
              }}
            >
              <SelectTrigger size='sm' className='min-w-0 max-w-full'>
                <SelectValue>
                  {plan?.title || `${t('Subscription')} #${sub?.id}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {actives.map((s) => {
                    const id = s.subscription?.id
                    return (
                      <SelectItem key={id} value={String(id)}>
                        {`${resolvePlan(s)?.title || t('Subscription')} #${id}`}
                      </SelectItem>
                    )
                  })}
                </SelectGroup>
              </SelectContent>
            </Select>
            <StatusBadge
              variant='success'
              label={t('Active')}
              icon={CheckCircle2}
              copyable={false}
            />
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className='bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'>
                  {t('{{count}} days remaining', { count: remainDays })}
                </span>
              }
            />
            <TooltipContent>
              <div className='text-xs'>
                {t('Until')}{' '}
                <span className='font-medium tabular-nums'>
                  {sub?.end_time ? formatTimestamp(sub.end_time) : '-'}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* 限额单列列表 */}
        <div className='flex flex-col px-4 sm:px-5'>
          {limitRows.length > 0 ? (
            limitRows.map((row) => <LimitRow key={row.rowKey} {...row} />)
          ) : (
            <div className='text-muted-foreground py-2 text-xs'>
              {t('Unlimited')}
            </div>
          )}
        </div>

        {/* 操作区：续费/取消/自动续费 + 右侧状态小徽标（已停售/到期取消） */}
        <div className='flex flex-wrap items-center gap-2 px-4 pt-2 pb-4 sm:px-5 sm:pb-5'>
          {!cancelledAtEnd && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setRenewTarget(selected)}
            >
              <RefreshCw className='size-3.5' />
              {t('Renew')}
            </Button>
          )}
          <Button
            size='sm'
            variant='outline'
            onClick={() => setCancelTarget(selected)}
          >
            <CalendarX className='size-3.5' />
            {t('Cancel')}
          </Button>
          <label className='flex shrink-0 items-center gap-1.5 text-sm'>
            <Switch
              checked={sub?.auto_renew === true}
              onCheckedChange={handleAutoRenew}
              disabled={updating || cancelledAtEnd}
              size='sm'
            />
            {t('Auto-renew')}
          </label>
          {(actives.length > 1 || discontinued || cancelledAtEnd) && (
            <span className='ml-auto flex shrink-0 items-center gap-1.5'>
              {discontinued && (
                <BadgeChip
                  icon={PackageX}
                  label={t('Discontinued')}
                  variant='warning'
                />
              )}
              {cancelledAtEnd && (
                <BadgeChip
                  icon={CalendarX}
                  label={t('Cancels at end')}
                  variant='neutral'
                />
              )}
              {actives.length > 1 && (
                <button
                  type='button'
                  onClick={() => {
                    const id = selected?.subscription?.id
                    if (id != null) void handleSetPriority(id)
                  }}
                  title={
                    selected?.subscription?.id === preferredId
                      ? t('Preferred')
                      : t('Use First')
                  }
                  className={cn(
                    'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
                    selected?.subscription?.id === preferredId
                      ? 'bg-amber-400/10 text-amber-500'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Star
                    className={cn(
                      'size-3.5',
                      selected?.subscription?.id === preferredId &&
                        'fill-amber-400 text-amber-500'
                    )}
                  />
                </button>
              )}
            </span>
          )}
        </div>

        <RenewSubscriptionDialog
          open={!!renewTarget}
          onOpenChange={(open) => {
            if (!open) setRenewTarget(null)
          }}
          subscription={renewTarget}
          plan={resolvePlan(renewTarget)}
          onSuccess={refresh}
        />
        <CancelSubscriptionDialog
          open={!!cancelTarget}
          onOpenChange={(open) => {
            if (!open) setCancelTarget(null)
          }}
          subscription={cancelTarget}
          plan={resolvePlan(cancelTarget)}
          onSuccess={refresh}
        />
      </div>
    </TooltipProvider>
  )
}
