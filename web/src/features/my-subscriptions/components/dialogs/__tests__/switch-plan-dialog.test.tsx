// @muw-owned
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type {
  SubscriptionPlan,
  UserSubscription,
} from '@/features/subscriptions/types'

// Base UI ScrollArea 会检查运行中的动画；jsdom 没实现 Element.getAnimations。
Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
  configurable: true,
  value: () => [],
})

const paySubscriptionBalance = vi.fn()
const refresh = vi.fn()

vi.mock('@/features/my-subscriptions/api', () => ({
  paySubscriptionBalance: (...args: unknown[]) =>
    paySubscriptionBalance(...args),
}))

vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({ currency: { quotaPerUnit: 500_000 } }),
}))

vi.mock(
  '@/features/my-subscriptions/components/my-subscriptions-provider',
  () => ({
    useMySubscriptions: () => ({ userQuota: 1_000_000_000, refresh }),
  })
)

const { SwitchPlanDialog, calcSubscriptionRemainingValue } =
  await import('../switch-plan-dialog')

const DAY = 86_400
const QUOTA_PER_UNIT = 500_000
// 固定时钟：2026-09-20 17:47:36 CST
const NOW = new Date('2026-09-20T09:47:36Z').getTime()
const PERIOD_SECONDS = 30 * DAY

function makePlan(overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    id: 22,
    title: 'Nebula',
    price_amount: 20,
    currency: 'USD',
    duration_unit: 'month',
    duration_value: 1,
    enabled: true,
    sort_order: 0,
    priority: 3,
    max_purchase_per_user: 0,
    ...overrides,
  } as SubscriptionPlan
}

function makeSub(overrides: Partial<UserSubscription> = {}): UserSubscription {
  return {
    id: 543,
    plan_id: 22,
    status: 'active',
    start_time: Math.floor(NOW / 1000) - 9 * DAY,
    // 剩 21.13 天：与线上案例（订阅 #543）一致
    end_time: Math.floor(NOW / 1000) + 1_825_658,
    period_used: 6_815_463,
    renew_terms: JSON.stringify({
      duration_seconds: PERIOD_SECONDS,
      price_amount: 20,
      max_cumulative_seconds: 3_888_000,
    }),
    ...overrides,
  } as unknown as UserSubscription
}

describe('calcSubscriptionRemainingValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('未超耗时按时间折算（不封顶）', () => {
    const value = calcSubscriptionRemainingValue(
      makeSub({ period_used: 0 }),
      makePlan(),
      QUOTA_PER_UNIT
    )
    expect(value).toBeCloseTo(14.0869, 3)
  })

  test('烧爆当期额度后按「快照价 − 已消耗价值」封顶，与后端一致', () => {
    // 时间折算 $14.09，但已消耗 $13.63 ⇒ 后端只会退 $6.37
    const value = calcSubscriptionRemainingValue(
      makeSub({ period_used: 6_815_463 }),
      makePlan(),
      QUOTA_PER_UNIT
    )
    expect(value).toBeCloseTo(6.369074, 5)
  })

  test('已消耗超过套餐价时剩余价值为 0，不会退成负数', () => {
    const value = calcSubscriptionRemainingValue(
      makeSub({ period_used: 12_000_000 }),
      makePlan(),
      QUOTA_PER_UNIT
    )
    expect(value).toBe(0)
  })

  test('无续费快照时回退套餐当前条款（价格与周期）', () => {
    const value = calcSubscriptionRemainingValue(
      makeSub({ renew_terms: undefined, period_used: 0 }),
      makePlan(),
      QUOTA_PER_UNIT
    )
    expect(value).toBeCloseTo(14.0869, 3)
  })

  test('quotaPerUnit 非法时回退默认单位，不产生 NaN', () => {
    // NaN 单位 → 回退默认 500000 ⇒ 已消耗按 $1 折算，封顶 $19；时间折算 $14.09 更小，取时间值。
    const value = calcSubscriptionRemainingValue(
      makeSub({ period_used: QUOTA_PER_UNIT }),
      makePlan(),
      Number.NaN
    )
    expect(Number.isNaN(value)).toBe(false)
    expect(value).toBeCloseTo(14.0869, 3)
  })
})

describe('SwitchPlanDialog', () => {
  beforeEach(() => {
    paySubscriptionBalance.mockReset()
    refresh.mockReset()
    paySubscriptionBalance.mockResolvedValue({ success: true, data: {} })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function renderDialog() {
    const onOpenChange = vi.fn()
    const utils = render(
      <SwitchPlanDialog
        open
        onOpenChange={onOpenChange}
        plan={makePlan({ id: 19, title: 'Meteor', price_amount: 0, priority: 1 })}
        oldSub={makeSub()}
        oldPlan={makePlan()}
      />
    )
    return { ...utils, onOpenChange }
  }

  function confirmStep() {
    return document.querySelector('[data-slot="switch-plan-confirm-step"]')
  }

  test('第一步就按后端封顶后的金额显示应退金额', () => {
    renderDialog()
    expect(screen.getByText('$6.37')).toBeTruthy()
    expect(screen.queryByText('$14.09')).toBeNull()
    expect(confirmStep()).toBeNull()
  })

  test('点「确认更换」只进二次确认，不发起请求', async () => {
    renderDialog()
    await act(async () => {
      screen.getByRole('button', { name: 'Confirm Switch' }).click()
    })
    expect(confirmStep()).toBeTruthy()
    expect(paySubscriptionBalance).not.toHaveBeenCalled()
  })

  test('二次确认里点「取消」回退到第一步，仍不发起请求', async () => {
    renderDialog()
    await act(async () => {
      screen.getByRole('button', { name: 'Confirm Switch' }).click()
    })
    await act(async () => {
      screen.getByRole('button', { name: 'Cancel' }).click()
    })
    expect(confirmStep()).toBeNull()
    expect(screen.getByText('$6.37')).toBeTruthy()
    expect(paySubscriptionBalance).not.toHaveBeenCalled()
  })

  test('二次确认里再点一次才真正提交并关闭弹窗', async () => {
    const { onOpenChange } = renderDialog()
    await act(async () => {
      screen.getByRole('button', { name: 'Confirm Switch' }).click()
    })
    await act(async () => {
      screen.getByRole('button', { name: 'Confirm Switch' }).click()
    })
    expect(paySubscriptionBalance).toHaveBeenCalledTimes(1)
    expect(paySubscriptionBalance).toHaveBeenCalledWith({ plan_id: 19 })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(refresh).toHaveBeenCalled()
  })

  test('关闭后重开回到第一步，不残留上一次的确认步', async () => {
    const { rerender } = renderDialog()
    await act(async () => {
      screen.getByRole('button', { name: 'Confirm Switch' }).click()
    })
    expect(confirmStep()).toBeTruthy()

    const plan = makePlan({ id: 19, title: 'Meteor', price_amount: 0, priority: 1 })
    const oldSub = makeSub()
    const oldPlan = makePlan()
    await act(async () => {
      rerender(
        <SwitchPlanDialog
          open={false}
          onOpenChange={vi.fn()}
          plan={plan}
          oldSub={oldSub}
          oldPlan={oldPlan}
        />
      )
    })
    await act(async () => {
      rerender(
        <SwitchPlanDialog
          open
          onOpenChange={vi.fn()}
          plan={plan}
          oldSub={oldSub}
          oldPlan={oldPlan}
        />
      )
    })
    expect(confirmStep()).toBeNull()
    expect(screen.getByText('$6.37')).toBeTruthy()
  })
})
