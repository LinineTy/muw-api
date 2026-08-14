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
  keyword?: string
): Promise<ApiResponse<SpaceOrdersResponse>> {
  const params = new URLSearchParams({
    p: page.toString(),
    page_size: pageSize.toString(),
  })
  if (keyword) {
    params.append('keyword', keyword)
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
  keyword?: string
): Promise<ApiResponse<SpaceOrdersResponse>> {
  const params = new URLSearchParams({
    p: page.toString(),
    page_size: pageSize.toString(),
  })
  if (keyword) {
    params.append('keyword', keyword)
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
