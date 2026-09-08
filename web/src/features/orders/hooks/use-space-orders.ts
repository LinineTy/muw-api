// @muw-owned
import i18next from 'i18next'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useIsAdmin } from '@/hooks/use-admin'

import {
  completeSpaceOrder,
  getAllSpaceOrders,
  getSpaceOrders,
  isApiSuccess,
  rejectSpaceOrder,
} from '../api'
import type { SpaceOrderRecord } from '../types'

interface UseSpaceOrdersOptions {
  initialPage?: number
  initialPageSize?: number
  /** Keyword filter (trade number), controlled by the caller */
  keyword?: string
  status?: string
  method?: string
}

/**
 * 云空间购买订单分页查询（用户看本人，管理员看全平台）+ 管理员补单/驳回。
 * keyword / status / method 为服务端过滤条件，由调用方控制（空字符串 = 不过滤）。
 */
export function useSpaceOrders(options: UseSpaceOrdersOptions = {}) {
  const {
    initialPage = 1,
    initialPageSize = 20,
    keyword = '',
    status,
    method,
  } = options
  const isAdmin = useIsAdmin()

  const [records, setRecords] = useState<SpaceOrderRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [loading, setLoading] = useState(false)
  const [completing, setCompleting] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const response = isAdmin
        ? await getAllSpaceOrders(page, pageSize, keyword, status, method)
        : await getSpaceOrders(page, pageSize, keyword, status, method)

      if (isApiSuccess(response) && response.data) {
        setRecords(response.data.items || [])
        setTotal(response.data.total || 0)
      } else {
        toast.error(response.message || i18next.t('Failed to load orders'))
        setRecords([])
        setTotal(0)
      }
    } catch {
      toast.error(i18next.t('Failed to load orders'))
      setRecords([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [isAdmin, page, pageSize, keyword, status, method])

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1)
  }, [])

  // 管理员补单：人工完成 pending 订单并扩容（epay 回调丢失/失败/卡单时的出路）。
  const handleCompleteOrder = useCallback(
    async (tradeNo: string): Promise<boolean> => {
      setCompleting(tradeNo)
      try {
        const ok = await completeSpaceOrder(tradeNo)
        if (ok) {
          toast.success(i18next.t('Order completed'))
          await fetchOrders()
        } else {
          toast.error(i18next.t('Failed to complete order'))
        }
        return ok
      } catch {
        toast.error(i18next.t('Failed to complete order'))
        return false
      } finally {
        setCompleting(null)
      }
    },
    [fetchOrders]
  )

  // 管理员驳回：关闭无法完成的 pending 订单。
  const handleRejectOrder = useCallback(
    async (tradeNo: string): Promise<boolean> => {
      setCompleting(tradeNo)
      try {
        const ok = await rejectSpaceOrder(tradeNo)
        if (ok) {
          toast.success(i18next.t('Order rejected'))
          await fetchOrders()
        } else {
          toast.error(i18next.t('Failed to reject order'))
        }
        return ok
      } catch {
        toast.error(i18next.t('Failed to reject order'))
        return false
      } finally {
        setCompleting(null)
      }
    },
    [fetchOrders]
  )

  useEffect(() => {
    void fetchOrders()
  }, [fetchOrders])

  return {
    records,
    total,
    page,
    pageSize,
    loading,
    isAdmin,
    completing,
    handlePageChange,
    handlePageSizeChange,
    handleCompleteOrder,
    handleRejectOrder,
    refresh: fetchOrders,
  }
}
