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

import type { SubscriptionSortBy } from './constants'
import type {
  AdminUserSubscriptionSummary,
  ApiResponse,
  GroupPinProduct,
  PlanRecord,
  PlanPayload,
  UserSubscriptionRecord,
  CreateUserSubscriptionRequest,
  ResetUserSubscriptionsRequest,
  ResetPlanSubscriptionsRequest,
  SubscriptionResetResult,
  SubscriptionPayResponse,
  SubscriptionPayRequest,
  SelfSubscriptionData,
} from './types'

// ============================================================================
// Admin Plan Management
// ============================================================================

export async function getAdminPlans(): Promise<ApiResponse<PlanRecord[]>> {
  const res = await api.get('/api/subscription/admin/plans')
  return res.data
}

export async function createPlan(
  data: PlanPayload
): Promise<ApiResponse<PlanRecord>> {
  const res = await api.post('/api/subscription/admin/plans', data)
  return res.data
}

export async function updatePlan(
  id: number,
  data: PlanPayload
): Promise<ApiResponse<PlanRecord>> {
  const res = await api.put(`/api/subscription/admin/plans/${id}`, data)
  return res.data
}

export async function patchPlanStatus(
  id: number,
  enabled: boolean
): Promise<ApiResponse> {
  const res = await api.patch(`/api/subscription/admin/plans/${id}`, {
    enabled,
  })
  return res.data
}

export async function deletePlan(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/subscription/admin/plans/${id}`)
  return res.data
}

// ============================================================================
// Admin User Subscription Management
// ============================================================================

export async function getUserSubscriptions(
  userId: number
): Promise<ApiResponse<UserSubscriptionRecord[]>> {
  const res = await api.get(
    `/api/subscription/admin/users/${userId}/subscriptions`
  )
  return res.data
}

export async function getAdminAllSubscriptions(params: {
  p?: number
  size?: number
  status?: string
  user?: string
  sort_by?: SubscriptionSortBy
  sort_order?: 'asc' | 'desc'
}): Promise<
  ApiResponse<{
    items: AdminUserSubscriptionSummary[]
    total: number
    page: number
    page_size: number
  }>
> {
  const res = await api.get('/api/subscription/admin/subscriptions', {
    params,
  })
  return res.data
}

export async function createUserSubscription(
  userId: number,
  data: CreateUserSubscriptionRequest
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post(
    `/api/subscription/admin/users/${userId}/subscriptions`,
    data
  )
  return res.data
}

export async function invalidateUserSubscription(
  subId: number
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post(
    `/api/subscription/admin/user_subscriptions/${subId}/invalidate`
  )
  return res.data
}

export async function deleteUserSubscription(
  subId: number
): Promise<ApiResponse> {
  const res = await api.delete(
    `/api/subscription/admin/user_subscriptions/${subId}`
  )
  return res.data
}

export async function purgeUserSubscription(
  subId: number
): Promise<ApiResponse> {
  const res = await api.post(
    `/api/subscription/admin/user_subscriptions/${subId}/purge`
  )
  return res.data
}

export async function resetUserSubscriptionsByPlan(
  userId: number,
  data: ResetUserSubscriptionsRequest
): Promise<ApiResponse<SubscriptionResetResult>> {
  const res = await api.post(
    `/api/subscription/admin/users/${userId}/subscriptions/reset`,
    data
  )
  return res.data
}

export async function resetPlanSubscriptions(
  planId: number,
  data: ResetPlanSubscriptionsRequest
): Promise<ApiResponse<SubscriptionResetResult>> {
  const res = await api.post(
    `/api/subscription/admin/plans/${planId}/subscriptions/reset`,
    data
  )
  return res.data
}

// ============================================================================
// User-facing Subscription Payment
// ============================================================================

export async function paySubscriptionBalance(
  data: SubscriptionPayRequest
): Promise<SubscriptionPayResponse> {
  const res = await api.post('/api/subscription/balance/pay', data)
  return res.data
}

export async function paySubscriptionEpay(
  data: SubscriptionPayRequest & { payment_method: string }
): Promise<SubscriptionPayResponse & { url?: string }> {
  const res = await api.post('/api/subscription/epay/pay', data)
  return {
    ...res.data,
    url: res.data.url || (res as unknown as { url?: string }).url,
  }
}

// ============================================================================
// User Self Subscriptions
// ============================================================================

export async function getSelfSubscriptions(): Promise<
  ApiResponse<UserSubscriptionRecord[]>
> {
  const res = await api.get('/api/subscription/self')
  return res.data
}

export async function getSelfSubscriptionFull(): Promise<
  ApiResponse<SelfSubscriptionData>
> {
  const res = await api.get('/api/subscription/self')
  return res.data
}

export async function getPublicPlans(): Promise<ApiResponse<PlanRecord[]>> {
  const res = await api.get('/api/subscription/plans')
  return res.data
}

export async function updateBillingPreference(
  preference: string
): Promise<ApiResponse<{ billing_preference?: string }>> {
  const res = await api.put('/api/subscription/self/preference', {
    billing_preference: preference,
  })
  return res.data
}

// ============================================================================
// User Self-service: cancel / renew / auto-renew / priority / expiring
// ============================================================================

export async function cancelSubscription(
  subscriptionId: number,
  mode: 'immediate' | 'end_period'
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post('/api/subscription/cancel', {
    subscription_id: subscriptionId,
    mode,
  })
  return res.data
}

export async function renewSubscriptionBalance(
  subscriptionId: number
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post('/api/subscription/renew/balance', {
    subscription_id: subscriptionId,
  })
  return res.data
}

export async function setSubscriptionAutoRenew(
  subscriptionId: number,
  enabled: boolean
): Promise<ApiResponse> {
  const res = await api.post('/api/subscription/auto-renew', {
    subscription_id: subscriptionId,
    enabled,
  })
  return res.data
}

export async function setSubscriptionPriority(
  subscriptionId: number
): Promise<ApiResponse> {
  const res = await api.post('/api/subscription/priority', {
    subscription_id: subscriptionId,
  })
  return res.data
}

export interface ExpiringSubscription {
  subscription: UserSubscriptionRecord['subscription']
  plan_title?: string
}

export async function getExpiringSubscriptions(
  days?: number
): Promise<ApiResponse<ExpiringSubscription[]>> {
  const res = await api.get('/api/subscription/expiring', {
    params: days ? { days } : undefined,
  })
  return res.data
}

export async function getGroups(): Promise<ApiResponse<string[]>> {
  const res = await api.get('/api/group')
  return res.data
}

// ============================================================================
// Group pin (固定分组)：商品与钉子
// 商品在管理端与订阅套餐同表（见 lib/group-pin.ts 的行模型适配），用户端与套餐
// 同网格（见 my-subscriptions 的目录卡片）。
// ============================================================================

export type { GroupPinProduct }

/** 用户固定分组钉记录（管理端列表与用户端 /self 返回同一模型，released 仅留痕）。 */
export interface GroupPin {
  id: number
  user_id: number
  group: string
  status: string
  source: string
  note: string
  created_at: number
  created_by: number
  released_at: number
  released_by: number
  release_reason: string
}

/** 当前用户 active 钉；无钉时 data 为 null。 */
export async function getMyGroupPin(): Promise<ApiResponse<GroupPin | null>> {
  const res = await api.get('/api/group_pin/self')
  return res.data
}

/** 上架的固定分组商品（购买页）。 */
export async function getGroupPinProducts(): Promise<
  ApiResponse<GroupPinProduct[]>
> {
  const res = await api.get('/api/group_pin/products')
  return res.data
}

/** 余额购买固定分组。 */
export async function purchaseGroupPinBalance(
  pinProductId: number
): Promise<ApiResponse<{ message: string }>> {
  const res = await api.post('/api/group_pin/balance/pay', {
    pin_product_id: pinProductId,
  })
  return res.data
}

/** epay 购买固定分组（返回支付跳转参数）。 */
export async function purchaseGroupPinEpay(params: {
  pin_product_id: number
  payment_method: string
}): Promise<ApiResponse & { data?: unknown; url?: string }> {
  const res = await api.post('/api/group_pin/epay/pay', params)
  return res.data
}

/** 全部固定分组商品（含未上架）。 */
export async function adminListGroupPinProducts(): Promise<
  ApiResponse<GroupPinProduct[]>
> {
  const res = await api.get('/api/group_pin/admin/products')
  return res.data
}

export async function adminSaveGroupPinProduct(
  data: GroupPinProduct
): Promise<ApiResponse<GroupPinProduct>> {
  const res = await api.post('/api/group_pin/admin/product/save', data)
  return res.data
}

export async function adminDeleteGroupPinProduct(
  id: number
): Promise<ApiResponse> {
  const res = await api.delete(`/api/group_pin/admin/product/${id}`)
  return res.data
}

export async function adminListGroupPins(params: {
  user_id?: number
  page?: number
  page_size?: number
}): Promise<ApiResponse<{ items: GroupPin[]; total: number }>> {
  const res = await api.get('/api/group_pin/admin/pins', { params })
  return res.data
}

export async function adminReleaseGroupPin(
  pinId: number,
  reason: string
): Promise<ApiResponse<{ group: string; changed: boolean }>> {
  const res = await api.post('/api/group_pin/admin/pin/release', {
    pin_id: pinId,
    reason,
  })
  return res.data
}
