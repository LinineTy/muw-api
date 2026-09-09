// @muw-owned
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

import { getSelf } from '@/lib/api'
import {
  getGroupPinProducts,
  getMyGroupPin,
  getPublicPlans,
  getSelfSubscriptionFull,
  type GroupPin,
  type GroupPinProduct,
} from '@/features/subscriptions/api'
import { useTopupInfo } from '@/features/wallet/hooks'
import type {
  PlanRecord,
  SelfSubscriptionData,
  SubscriptionPlan,
} from '@/features/subscriptions/types'
import type { TopupInfo } from '@/features/wallet/types'

type MySubscriptionsContextValue = {
  selfData: SelfSubscriptionData | null
  plans: PlanRecord[]
  // 合并了订阅自带套餐快照的查找表（含已禁用套餐），用户侧所有 planMap.get 统一用它。
  planMap: Map<number, SubscriptionPlan>
  // 固定分组商品（独立表）与当前用户的 active 钉；与套餐卡片同网格展示。
  pinProducts: GroupPinProduct[]
  myPin: GroupPin | null
  topupInfo: TopupInfo | null
  userQuota: number
  userGroup: string
  loading: boolean
  refreshing: boolean
  refresh: () => Promise<void>
}

const MySubscriptionsContext = createContext<MySubscriptionsContextValue | null>(
  null
)

export function MySubscriptionsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [selfData, setSelfData] = useState<SelfSubscriptionData | null>(null)
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [pinProducts, setPinProducts] = useState<GroupPinProduct[]>([])
  const [myPin, setMyPin] = useState<GroupPin | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userQuota, setUserQuota] = useState(0)
  const [userGroup, setUserGroup] = useState('')

  const { topupInfo } = useTopupInfo()

  const fetchSelfSubscription = useCallback(async () => {
    try {
      const res = await getSelfSubscriptionFull()
      if (res.success && res.data) {
        setSelfData(res.data)
      }
    } catch {
      // ignore
    }
  }, [])

  const fetchPlans = useCallback(async () => {
    try {
      const res = await getPublicPlans()
      if (res.success) {
        setPlans(res.data || [])
      }
    } catch {
      setPlans([])
    }
  }, [])

  const fetchGroupPins = useCallback(async () => {
    try {
      const [productsRes, pinRes] = await Promise.all([
        getGroupPinProducts(),
        getMyGroupPin(),
      ])
      if (productsRes.success) setPinProducts(productsRes.data || [])
      setMyPin(pinRes.data?.status === 'active' ? pinRes.data : null)
    } catch {
      setPinProducts([])
    }
  }, [])

  const fetchSelf = useCallback(async () => {
    try {
      const self = await getSelf()
      if (self.success) {
        setUserQuota(self.data?.quota ?? 0)
        setUserGroup(self.data?.group || '')
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlans(), fetchSelfSubscription(), fetchGroupPins()])
      try {
        const self = await getSelf()
        if (!cancelled && self.success) {
          setUserQuota(self.data?.quota ?? 0)
          setUserGroup(self.data?.group || '')
        }
      } catch {
        // ignore
      }
      if (!cancelled) setLoading(false)
    }
    init()
    return () => {
      cancelled = true
    }
  }, [fetchPlans, fetchSelfSubscription, fetchGroupPins])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetchSelfSubscription()
      await fetchSelf()
      // 购买固定分组会切用户组并新建钉，商品/钉状态要一起刷新。
      await fetchGroupPins()
    } finally {
      setRefreshing(false)
    }
  }, [fetchSelfSubscription, fetchSelf, fetchGroupPins])

  // 公开套餐（enabled-only）为主，订阅记录自带的套餐快照覆盖合并——停售/禁用的
  // 套餐仍能查到套餐名/周期/限额，避免已订阅卡片退化成 #id、升降配拿不到 oldPlan。
  const planMap = useMemo(() => {
    const map = new Map<number, SubscriptionPlan>()
    for (const p of plans) {
      if (p?.plan?.id) map.set(p.plan.id, p.plan)
    }
    for (const s of selfData?.all_subscriptions ?? []) {
      if (s?.plan?.id) map.set(s.plan.id, s.plan)
    }
    return map
  }, [plans, selfData])

  return (
    <MySubscriptionsContext.Provider
      value={{
        selfData,
        plans,
        planMap,
        pinProducts,
        myPin,
        topupInfo,
        userQuota,
        userGroup,
        loading,
        refreshing,
        refresh,
      }}
    >
      {children}
    </MySubscriptionsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMySubscriptions() {
  const ctx = useContext(MySubscriptionsContext)
  if (!ctx) {
    throw new Error(
      'useMySubscriptions has to be used within <MySubscriptionsProvider>'
    )
  }
  return ctx
}
