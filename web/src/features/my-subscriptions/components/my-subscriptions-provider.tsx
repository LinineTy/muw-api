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
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

import { getSelf } from '@/lib/api'
import { getPublicPlans, getSelfSubscriptionFull } from '@/features/subscriptions/api'
import { useTopupInfo } from '@/features/wallet/hooks'
import type { PlanRecord, SelfSubscriptionData } from '@/features/subscriptions/types'
import type { TopupInfo } from '@/features/wallet/types'

type MySubscriptionsContextValue = {
  selfData: SelfSubscriptionData | null
  plans: PlanRecord[]
  topupInfo: TopupInfo | null
  userQuota: number
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
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userQuota, setUserQuota] = useState(0)

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

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlans(), fetchSelfSubscription()])
      try {
        const self = await getSelf()
        if (!cancelled && self.success) {
          const quota = self.data?.quota ?? 0
          setUserQuota(quota)
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
  }, [fetchPlans, fetchSelfSubscription])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetchSelfSubscription()
      const self = await getSelf()
      if (self.success) {
        setUserQuota(self.data?.quota ?? 0)
      }
    } finally {
      setRefreshing(false)
    }
  }, [fetchSelfSubscription])

  return (
    <MySubscriptionsContext.Provider
      value={{
        selfData,
        plans,
        topupInfo,
        userQuota,
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
