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

import type { SpaceInfo, RemoteConversation } from './types'

/**
 * 云空间用量/容量信息。
 */
export async function getSpaceInfo(): Promise<SpaceInfo | null> {
  const res = await api.get('/api/playground/space', {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  const { data } = res
  if (!data.success || !data.data) {
    return null
  }
  return data.data
}

/**
 * 用余额购买云空间容量。返回 null 表示余额不足/被拒（message 已含中文）。
 */
export async function purchaseSpace(
  mb: number
): Promise<{ cost: number; capacity_bytes: number } | null> {
  const res = await api.post(
    '/api/playground/space/purchase',
    { mb },
    { skipErrorHandler: true } as Record<string, unknown>
  )
  const { data } = res
  if (!data.success || !data.data) {
    return null
  }
  return data.data
}

/**
 * 在线支付购买云空间容量（易支付）。返回 message/url/params，前端以表单 POST 拉起支付。
 */
export async function paySpaceEpay(data: {
  mb: number
  payment_method: string
}): Promise<{
  message: string
  data?: Record<string, string>
  url?: string
  money?: number
}> {
  const res = await api.post('/api/playground/space/epay/pay', data, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return {
    ...res.data,
    url: res.data.url || (res as unknown as { url?: string }).url,
  }
}

/**
 * 清空当前用户的全部临时图片，返回删除数量；业务失败返回 null（供调用方区分
 * 「本就为空」与「清理失败」，避免把失败误报成删除 0 张）。
 */
export async function clearTransientImages(): Promise<number | null> {
  const res = await api.post(
    '/api/playground/images/clear-transient',
    null,
    { skipErrorHandler: true } as Record<string, unknown>
  )
  const { data } = res
  if (!data.success || !data.data) {
    return null
  }
  return data.data.deleted ?? 0
}

/**
 * 拉取当前用户全部同步会话。
 */
export async function listPlaygroundConversations(): Promise<
  RemoteConversation[]
> {
  const res = await api.get('/api/playground/conversations', {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  const { data } = res
  if (!data.success || !Array.isArray(data.data)) {
    return []
  }
  return data.data
}

/**
 * 删除一个同步会话。
 */
export async function deletePlaygroundConversation(
  clientId: string
): Promise<void> {
  await api.delete(
    `/api/playground/conversations/${encodeURIComponent(clientId)}`,
    { skipErrorHandler: true } as Record<string, unknown>
  )
}
