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
import i18next from 'i18next'
import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

import { useIsAdmin } from '@/hooks/use-admin'
import { useDebounce } from '@/hooks/use-debounce'

import {
  getUserBillingHistory,
  getAllBillingHistory,
  completeOrder,
  completeSubscriptionOrder,
  rejectSubscriptionOrder,
  isApiSuccess,
} from '../api'
import type { TopupRecord } from '../types'

// ============================================================================
// Billing History Hook
// ============================================================================

interface UseBillingHistoryOptions {
  /** Initial page number */
  initialPage?: number
  /** Initial page size */
  initialPageSize?: number
  /** Keyword filter (trade number), controlled by the caller */
  keyword?: string
  /** Server-side status filter ('' = all) */
  status?: string
  /** Server-side payment method filter ('' = all) */
  method?: string
  /** Server-side order type filter ('' = all, topup / subscription) */
  type?: string
}

export function useBillingHistory(options: UseBillingHistoryOptions = {}) {
  const {
    initialPage = 1,
    initialPageSize = 20,
    keyword = '',
    status,
    method,
    type,
  } = options
  const isAdmin = useIsAdmin()

  const [records, setRecords] = useState<TopupRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const debouncedKeyword = useDebounce(keyword)
  const requestIdRef = useRef(0)
  const [loading, setLoading] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completingSub, setCompletingSub] = useState<string | null>(null)

  /**
   * Fetch billing history
   */
  const fetchBillingHistory = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const response = isAdmin
        ? await getAllBillingHistory(
            page,
            pageSize,
            debouncedKeyword,
            status,
            method,
            type
          )
        : await getUserBillingHistory(
            page,
            pageSize,
            debouncedKeyword,
            status,
            method,
            type
          )

      if (requestId !== requestIdRef.current) return

      if (isApiSuccess(response) && response.data) {
        setRecords(response.data.items || [])
        setTotal(response.data.total || 0)
      } else {
        toast.error(
          response.message || i18next.t('Failed to load billing history')
        )
        setRecords([])
        setTotal(0)
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return

      // eslint-disable-next-line no-console
      console.error('Failed to fetch billing history:', error)
      toast.error(i18next.t('Failed to load billing history'))
      setRecords([])
      setTotal(0)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [debouncedKeyword, isAdmin, page, pageSize, status, method, type])

  /**
   * Complete a pending order (admin only)
   */
  const handleCompleteOrder = useCallback(
    async (tradeNo: string) => {
      if (!isAdmin) {
        toast.error(i18next.t('Admin access required'))
        return false
      }

      setCompleting(true)
      try {
        const response = await completeOrder({ trade_no: tradeNo })
        if (isApiSuccess(response)) {
          toast.success(i18next.t('Order completed successfully'))
          // Refresh the list
          await fetchBillingHistory()
          return true
        } else {
          toast.error(response.message || i18next.t('Failed to complete order'))
          return false
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to complete order:', error)
        toast.error(i18next.t('Failed to complete order'))
        return false
      } finally {
        setCompleting(false)
      }
    },
    [isAdmin, fetchBillingHistory]
  )

  // 管理员补单订阅订单（pending → 创建/续期订阅）。
  const handleCompleteSubscriptionOrder = useCallback(
    async (tradeNo: string): Promise<boolean> => {
      if (!isAdmin) {
        toast.error(i18next.t('Admin access required'))
        return false
      }
      setCompletingSub(tradeNo)
      try {
        const ok = await completeSubscriptionOrder(tradeNo)
        if (ok) {
          toast.success(i18next.t('Order completed'))
          await fetchBillingHistory()
        } else {
          toast.error(i18next.t('Failed to complete order'))
        }
        return ok
      } catch {
        toast.error(i18next.t('Failed to complete order'))
        return false
      } finally {
        setCompletingSub(null)
      }
    },
    [isAdmin, fetchBillingHistory]
  )

  // 管理员驳回/关闭待支付订阅订单（pending → expired）。
  const handleRejectSubscriptionOrder = useCallback(
    async (tradeNo: string): Promise<boolean> => {
      if (!isAdmin) {
        toast.error(i18next.t('Admin access required'))
        return false
      }
      setCompletingSub(tradeNo)
      try {
        const ok = await rejectSubscriptionOrder(tradeNo)
        if (ok) {
          toast.success(i18next.t('Order rejected'))
          await fetchBillingHistory()
        } else {
          toast.error(i18next.t('Failed to reject order'))
        }
        return ok
      } catch {
        toast.error(i18next.t('Failed to reject order'))
        return false
      } finally {
        setCompletingSub(null)
      }
    },
    [isAdmin, fetchBillingHistory]
  )

  /**
   * Change page
   */
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  /**
   * Change page size
   */
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1) // Reset to first page when changing page size
  }, [])

  // Fetch data after the search draft has settled.
  useEffect(() => {
    if (keyword !== debouncedKeyword) return

    fetchBillingHistory()
  }, [debouncedKeyword, fetchBillingHistory, keyword])

  return {
    records,
    total,
    page,
    pageSize,
    loading,
    completing,
    completingSub,
    isAdmin,
    handlePageChange,
    handlePageSizeChange,
    handleCompleteOrder,
    handleCompleteSubscriptionOrder,
    handleRejectSubscriptionOrder,
    refresh: fetchBillingHistory,
  }
}
