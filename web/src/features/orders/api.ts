// @muw-owned
import { api } from '@/lib/api'

import type { ApiResponse, SpaceOrdersResponse } from './types'

function isApiSuccess(response: { success?: boolean; message?: string }): boolean {
  return response.success === true || response.message === 'success'
}

/**
 * 分页查询当前用户的云空间购买订单。
 */
export async function getSpaceOrders(
  page: number,
  pageSize: number,
  keyword?: string,
  status?: string,
  method?: string
): Promise<ApiResponse<SpaceOrdersResponse>> {
  const params = new URLSearchParams({
    p: page.toString(),
    page_size: pageSize.toString(),
  })
  if (keyword) {
    params.append('keyword', keyword)
  }
  if (status) {
    params.append('status', status)
  }
  if (method) {
    params.append('method', method)
  }
  const res = await api.get(`/api/playground/space/orders?${params.toString()}`)
  return res.data
}

/**
 * 管理员分页查询全平台云空间购买订单。
 */
export async function getAllSpaceOrders(
  page: number,
  pageSize: number,
  keyword?: string,
  status?: string,
  method?: string
): Promise<ApiResponse<SpaceOrdersResponse>> {
  const params = new URLSearchParams({
    p: page.toString(),
    page_size: pageSize.toString(),
  })
  if (keyword) {
    params.append('keyword', keyword)
  }
  if (status) {
    params.append('status', status)
  }
  if (method) {
    params.append('method', method)
  }
  const res = await api.get(`/api/playground/admin/orders?${params.toString()}`)
  return res.data
}

/**
 * 管理员补单（epay 回调丢失/失败/累计上限卡单时人工完成并扩容）。返回是否成功。
 */
export async function completeSpaceOrder(tradeNo: string): Promise<boolean> {
  const res = await api.post(
    '/api/playground/admin/orders/complete',
    { trade_no: tradeNo },
    { skipErrorHandler: true } as Record<string, unknown>
  )
  return isApiSuccess(res.data)
}

/**
 * 管理员驳回/关闭待支付订单（pending → expired）。
 */
export async function rejectSpaceOrder(tradeNo: string): Promise<boolean> {
  const res = await api.post(
    '/api/playground/admin/orders/reject',
    { trade_no: tradeNo },
    { skipErrorHandler: true } as Record<string, unknown>
  )
  return isApiSuccess(res.data)
}

export { isApiSuccess }
