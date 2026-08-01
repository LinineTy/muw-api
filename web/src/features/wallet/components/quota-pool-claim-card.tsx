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
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Sparkles,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatQuota } from '@/lib/format'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import {
  claimQuotaPool,
  getQuotaPoolRecords,
  getQuotaPoolStatus,
  quotaCheckIn,
} from '../api'
import { formatQuotaShort } from '../lib/format'
import type {
  QuotaClaimDayRecord,
  QuotaPoolRecordsResponse,
  QuotaPoolStatusResponse,
} from '../types'

interface QuotaPoolClaimCardProps {
  enabled: boolean
  onBalanceChange?: () => void
}

export function QuotaPoolClaimCard({
  enabled,
  onBalanceChange,
}: QuotaPoolClaimCardProps) {
  const { t } = useTranslation()
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [actionLoading, setActionLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const currentMonthStr = useMemo(() => {
    const y = currentMonth.getFullYear()
    const m = String(currentMonth.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  }, [currentMonth])

  /* eslint-disable @tanstack/query/exhaustive-deps */
  const {
    data: statusData,
    isLoading,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['quota-pool-status'],
    queryFn: async () => {
      const res = await getQuotaPoolStatus()
      if (res.success && res.data) {
        return res.data as QuotaPoolStatusResponse
      }
      throw new Error(res.message || t('Failed to fetch quota pool status'))
    },
    enabled,
    staleTime: 30000,
  })

  const { data: recordsData, refetch: refetchRecords } = useQuery({
    queryKey: ['quota-pool-records', currentMonthStr],
    queryFn: async () => {
      const res = await getQuotaPoolRecords(currentMonthStr)
      if (res.success && res.data) {
        return res.data as QuotaPoolRecordsResponse
      }
      throw new Error(res.message || t('Failed to fetch quota pool records'))
    },
    enabled,
    staleTime: 30000,
  })
  /* eslint-enable @tanstack/query/exhaustive-deps */

  const recordsMap = useMemo(() => {
    const map: Record<string, QuotaClaimDayRecord> = {}
    ;(recordsData?.records || []).forEach((r) => {
      map[r.date] = r
    })
    return map
  }, [recordsData?.records])

  const monthQuota = useMemo(
    () => (recordsData?.records || []).reduce((sum, r) => sum + r.quota, 0),
    [recordsData?.records]
  )

  const status = statusData?.status
  const canClaim =
    !!status &&
    status.time_open &&
    status.balance_allowed &&
    !status.global_cap_reached &&
    !status.user_cap_reached &&
    !status.count_limit_reached
  // 到上限后仍可打卡：仅在时间窗口内、且当天未打卡时可签
  const canCheckIn = !!status && status.time_open && !status.checked_in_today

  const todayString = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const todayRecord = recordsMap[todayString]
  const claimedToday = (todayRecord?.count || 0) > 0
  const checkedInToday = status?.checked_in_today === true

  const remainingClaims = useMemo(() => {
    if (
      !statusData ||
      !statusData.user_period_count_limit ||
      statusData.user_period_count_limit <= 0
    ) {
      return null
    }
    return Math.max(
      0,
      statusData.user_period_count_limit - (status?.user_count || 0)
    )
  }, [statusData, status?.user_count])

  const statusHint = useMemo(() => {
    if (!status) return ''
    if (status.global_cap_reached) {
      return t('This period global quota has been fully claimed')
    }
    if (status.count_limit_reached) {
      return t('You have reached your claim count this period')
    }
    if (status.user_cap_reached) {
      return t('You have reached your claim limit this period')
    }
    if (!status.time_open) {
      return t('Not available in the current time window')
    }
    if (!status.balance_allowed) {
      return t('Your balance does not meet the pool requirement')
    }
    if (remainingClaims !== null) {
      return t('You can claim {{n}} more times this period', {
        n: remainingClaims,
      })
    }
    return t('Claim a random quota reward')
  }, [status, remainingClaims, t])

  const handleClaim = useCallback(async () => {
    setActionLoading(true)
    try {
      const res = await claimQuotaPool()
      if (res.success && res.data) {
        toast.success(
          t('Claimed {{quota}} from the quota pool', {
            quota: formatQuota(res.data.quota),
          })
        )
        onBalanceChange?.()
        refetchStatus()
        refetchRecords()
      } else {
        toast.error(res.message || t('Failed to claim quota'))
      }
    } catch {
      toast.error(t('Failed to claim quota'))
    } finally {
      setActionLoading(false)
    }
  }, [onBalanceChange, refetchRecords, refetchStatus, t])

  const handleCheckIn = useCallback(async () => {
    setActionLoading(true)
    try {
      const res = await quotaCheckIn()
      if (res.success) {
        toast.success(t('Checked in today'))
        refetchStatus()
        refetchRecords()
      } else {
        toast.error(res.message || t('Failed to check in'))
      }
    } catch {
      toast.error(t('Failed to check in'))
    } finally {
      setActionLoading(false)
    }
  }, [refetchRecords, refetchStatus, t])

  const handlePrevMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    )
  }

  const handleNextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    )
  }

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = firstDay.getDay() // 0 = Sunday

    const days: Array<{ date: Date; isCurrentMonth: boolean }> = []

    for (let i = 0; i < startDayOfWeek; i++) {
      const d = new Date(year, month, -startDayOfWeek + i + 1)
      days.push({ date: d, isCurrentMonth: false })
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true })
    }

    const remaining = 7 - (days.length % 7)
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false })
      }
    }

    return days
  }, [currentMonth])

  const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  const periodLabel = (value: string) =>
    t(
      value === 'daily'
        ? 'Daily'
        : value === 'monthly'
          ? 'Monthly'
          : 'Weekly'
    )

  const amountSummary = useMemo(() => {
    if (!statusData) return ''
    if (statusData.amount_type === 'fixed') {
      return t('Each claim awards {{quota}}', {
        quota: formatQuota(statusData.amount),
      })
    }
    return t('Each claim awards a random {{min}} – {{max}}', {
      min: formatQuota(statusData.min_amount),
      max: formatQuota(statusData.max_amount),
    })
  }, [statusData, t])

  if (!enabled) {
    return null
  }

  if (isLoading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <div className='p-6'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-center gap-3'>
              <Skeleton className='h-10 w-10 rounded-xl' />
              <div className='space-y-2'>
                <Skeleton className='h-5 w-32' />
                <Skeleton className='h-3 w-56' />
              </div>
            </div>
            <Skeleton className='h-9 w-28 rounded-md' />
          </div>
        </div>
      </Card>
    )
  }

  let actionLabel = t('Claim')
  let actionDisabled = false
  let onAction = handleClaim
  if (actionLoading) {
    actionLabel = t('Claiming...')
    actionDisabled = true
  } else if (canClaim) {
    actionLabel = t('Claim')
    onAction = handleClaim
  } else if (canCheckIn) {
    actionLabel = t('Check in')
    onAction = handleCheckIn
  } else {
    actionDisabled = true
    actionLabel = checkedInToday ? t('Checked in today') : t('Claim')
  }

  const headerSubtitle = claimedToday
    ? `${t('Today')} +${formatQuota(todayRecord.quota)}${
        (todayRecord.count || 0) > 1 ? ` (${todayRecord.count})` : ''
      }`
    : checkedInToday
      ? t('You have checked in today')
      : statusHint

  return (
    <TooltipProvider delay={100}>
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        {/* Header */}
        <div className='border-b p-4 sm:p-6'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
            <button
              type='button'
              className='flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left whitespace-normal outline-none'
              onClick={() => setCollapsed((v) => !v)}
            >
              <IconBadge tone='neutral' size='lg' className='sm:size-11'>
                <CalendarDays
                  className='h-4 w-4 sm:h-5 sm:w-5'
                  strokeWidth={2}
                />
              </IconBadge>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-1.5 sm:gap-2'>
                  <h3 className='text-base font-semibold tracking-tight sm:text-lg'>
                    {t('Quota Pool')}
                  </h3>
                  {claimedToday && (
                    <div className='inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 sm:gap-1.5 sm:px-2.5 sm:text-xs dark:text-emerald-400'>
                      <Sparkles className='h-2.5 w-2.5 sm:h-3 sm:w-3' />
                      {t('Claimed today')}
                    </div>
                  )}
                  {!claimedToday && checkedInToday && (
                    <div className='inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-600 sm:gap-1.5 sm:px-2.5 sm:text-xs dark:text-sky-400'>
                      <Check className='h-2.5 w-2.5 sm:h-3 sm:w-3' />
                      {t('Checked in today')}
                    </div>
                  )}
                  <span className='text-muted-foreground inline-flex items-center'>
                    {collapsed ? (
                      <ChevronDown className='h-4 w-4' />
                    ) : (
                      <ChevronUp className='h-4 w-4' />
                    )}
                  </span>
                </div>
                <p className='text-muted-foreground mt-1 line-clamp-2 text-xs sm:text-sm'>
                  {headerSubtitle}
                </p>
              </div>
            </button>
            <Button
              onClick={onAction}
              disabled={actionDisabled}
              size='sm'
              className='w-full shrink-0 sm:w-auto'
            >
              {actionLabel}
            </Button>
          </div>
        </div>

        {!collapsed ? (
          <>
            {/* Stats */}
            <div className='grid grid-cols-3 gap-px border-b'>
              <div className='bg-card p-3 text-center sm:p-5'>
                <div className='text-xl font-semibold tracking-tight tabular-nums sm:text-2xl'>
                  {status?.user_count || 0}
                </div>
                <div className='text-muted-foreground mt-0.5 text-[10px] font-medium sm:mt-1 sm:text-xs'>
                  {t('Claims this period')}
                </div>
              </div>
              <div className='bg-card p-3 text-center sm:p-5'>
                <div className='text-xl font-semibold tracking-tight tabular-nums sm:text-2xl'>
                  {formatQuota(status?.user_granted || 0)}
                </div>
                <div className='text-muted-foreground mt-0.5 text-[10px] font-medium sm:mt-1 sm:text-xs'>
                  {t('Earned this period')}
                </div>
              </div>
              <div className='bg-card p-3 text-center sm:p-5'>
                <div className='text-xl font-semibold tracking-tight tabular-nums sm:text-2xl'>
                  {formatQuota(status?.global_granted || 0)}
                </div>
                <div className='text-muted-foreground mt-0.5 text-[10px] font-medium sm:mt-1 sm:text-xs'>
                  {t('Global issued this period')}
                </div>
              </div>
            </div>

            {/* Calendar */}
            <div className='p-4 sm:p-6'>
              <div className='space-y-3 sm:space-y-4'>
                {/* Month navigation */}
                <div className='flex items-center justify-between'>
                  <h4 className='text-xs font-semibold sm:text-sm'>
                    {dayjs(currentMonth).format('YYYY-MM')}
                  </h4>
                  <div className='flex items-center gap-0.5 sm:gap-1'>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7 sm:h-8 sm:w-8'
                      onClick={handlePrevMonth}
                    >
                      <ChevronLeft className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7 sm:h-8 sm:w-8'
                      onClick={handleNextMonth}
                    >
                      <ChevronRight className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
                    </Button>
                  </div>
                </div>

                {/* Calendar grid */}
                <div className='grid grid-cols-7 gap-0.5 sm:gap-1'>
                  {weekDays.map((day) => (
                    <div
                      key={day}
                      className='text-muted-foreground flex h-7 items-center justify-center text-[10px] font-medium sm:h-8 sm:text-xs'
                    >
                      {day}
                    </div>
                  ))}

                  {calendarDays.map((dayObj) => {
                    const dateStr = `${dayObj.date.getFullYear()}-${String(
                      dayObj.date.getMonth() + 1
                    ).padStart(2, '0')}-${String(
                      dayObj.date.getDate()
                    ).padStart(2, '0')}`
                    const isToday = dateStr === todayString
                    const dayRecord = recordsMap[dateStr]
                    const dayNum = dayObj.date.getDate()
                    const claimed = (dayRecord?.count || 0) > 0
                    const checkedIn = (dayRecord?.checkin_count || 0) > 0

                    const dayButton = (
                      <Button
                        key={dateStr}
                        variant={isToday ? 'default' : 'ghost'}
                        disabled={!dayObj.isCurrentMonth}
                        className={cn(
                          'relative flex h-10 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-0 text-xs font-medium sm:h-11 sm:text-sm',
                          !dayObj.isCurrentMonth &&
                            'text-muted-foreground/40 cursor-default',
                          !isToday && claimed && 'font-semibold'
                        )}
                      >
                        <span className='tabular-nums leading-none'>
                          {dayNum}
                        </span>
                        {claimed ? (
                          <span
                            className={cn(
                              'leading-none',
                              isToday
                                ? 'text-white/85'
                                : 'text-emerald-600 dark:text-emerald-400'
                            )}
                          >
                            <span className='text-[9px] sm:text-[10px]'>
                              +{formatQuotaShort(dayRecord.quota)}
                              {dayRecord.count > 1
                                ? `×${dayRecord.count}`
                                : ''}
                            </span>
                          </span>
                        ) : checkedIn ? (
                          <span
                            className={cn(
                              'leading-none',
                              isToday
                                ? 'text-white/85'
                                : 'text-sky-500 dark:text-sky-400'
                            )}
                          >
                            <span className='text-[9px] sm:text-[10px]'>
                              ✓
                            </span>
                          </span>
                        ) : null}
                      </Button>
                    )

                    if ((claimed || checkedIn) && dayObj.isCurrentMonth) {
                      return (
                        <Tooltip key={dateStr}>
                          <TooltipTrigger render={dayButton} />
                          <TooltipContent>
                            <div className='text-xs'>
                              <div className='font-medium'>{dateStr}</div>
                              {claimed && (
                                <>
                                  <div className='text-muted-foreground mt-0.5'>
                                    {t('{{count}} claims', {
                                      count: dayRecord.count,
                                    })}
                                  </div>
                                  <div className='text-muted-foreground mt-0.5'>
                                    +{formatQuota(dayRecord.quota)}
                                  </div>
                                </>
                              )}
                              {checkedIn && (
                                <div className='text-muted-foreground mt-0.5'>
                                  {t('Checked in')}
                                </div>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )
                    }

                    return dayButton
                  })}
                </div>

                {/* Footer rules hint */}
                <div className='bg-muted/30 text-muted-foreground rounded-lg border p-3 text-xs'>
                  <ul className='list-disc space-y-1 pl-5'>
                    <li>
                      {t('Quota rewards are added directly to your balance')}
                    </li>
                    <li>
                      {t('This month {{quota}} claimed', {
                        quota: formatQuota(monthQuota),
                      })}
                    </li>
                    <li>{amountSummary}</li>
                    {statusData && statusData.pool_period_cap > 0 && (
                      <li>
                        {t('Global cap: {{quota}} per period', {
                          quota: formatQuota(statusData.pool_period_cap),
                        })}
                      </li>
                    )}
                    {statusData && statusData.user_period_cap > 0 && (
                      <li>
                        {t('User cap: {{quota}} per period', {
                          quota: formatQuota(statusData.user_period_cap),
                        })}
                      </li>
                    )}
                    {statusData && statusData.user_period_count_limit > 0 && (
                      <li>
                        {t('Claim count limit: {{n}} per period', {
                          n: statusData.user_period_count_limit,
                        })}
                      </li>
                    )}
                    {statusData && (
                      <li>
                        {t('Global limits reset {{period}}', {
                          period: periodLabel(statusData.pool_period),
                        })}
                      </li>
                    )}
                    {statusData && (
                      <li>
                        {t('Per-user limits reset {{period}}', {
                          period: periodLabel(statusData.user_period),
                        })}
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </Card>
    </TooltipProvider>
  )
}
