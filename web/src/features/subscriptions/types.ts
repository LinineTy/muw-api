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
import { z } from 'zod'

// ============================================================================
// Subscription Plan Schema & Types
// ============================================================================

export const subscriptionPlanSchema = z.object({
  id: z.number(),
  title: z.string(),
  subtitle: z.string().optional(),
  price_amount: z.number(),
  currency: z.string().default('USD'),
  duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
  duration_value: z.number(),
  custom_seconds: z.number().optional(),
  max_cumulative_seconds: z.number().optional().default(0),
  exclusive_group: z.string().optional().default(''),
  // JSON array string of allowed user groups (backend wire format), empty = any group.
  allowed_groups: z.string().optional().default(''),
  enabled: z.boolean(),
  sort_order: z.number(),
  is_recommended: z.boolean().optional().default(false),
  // Tier priority within a mutual-exclusion group (higher = higher tier).
  priority: z.number().optional().default(0),
  allow_balance_pay: z.boolean().optional().default(true),
  allow_wallet_overflow: z.boolean().optional().default(true),
  max_purchase_per_user: z.number(),
  upgrade_group: z.string().optional(),
  downgrade_group: z.string().optional(),
  // 动态重置窗口列表（后端 wire 格式：JSON 数组文本）。唯一额度模型：非空、至少一个
  // 窗口；全部窗口额度为 0 = 无限额度。
  reset_windows: z.string().optional().default(''),
})

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>

// 动态重置窗口定义（与后端 model.ResetWindow 对应）。unit: hour/day/week/month。
export interface ResetWindow {
  unit: 'hour' | 'day' | 'week' | 'month'
  value: number
  limit: number
}

// 动态窗口在订阅上的独立消费状态（与后端 model.WindowState 对应）。
export interface WindowState {
  idx: number
  cycle_used: number
  cycle_start_at: number
  next_reset_at: number
}

export interface PlanRecord {
  plan: SubscriptionPlan
}

// ============================================================================
// User Subscription Schema & Types
// ============================================================================

export const userSubscriptionSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  plan_id: z.number(),
  status: z.string(),
  source: z.string().optional(),
  start_time: z.number(),
  end_time: z.number(),
  amount_total: z.number(),
  amount_used: z.number(),
  auto_renew: z.boolean().optional().default(false),
  auto_renew_failed: z.boolean().optional().default(false),
  priority: z.number().optional().default(0),
  cancel_at_end: z.boolean().optional().default(false),
  // 自然日历周/月展示计数（钱包卡「订阅抵扣」按日历月统计，不作额度上限）。
  week_start_at: z.number().optional().default(0),
  week_used: z.number().optional().default(0),
  month_start_at: z.number().optional().default(0),
  month_used: z.number().optional().default(0),
  exclusive_group: z.string().optional().default(''),
  tier_priority: z.number().optional().default(0),
  // 续费条款快照（JSON 文本，购买时写入）：续费价格/周期时长/单期额度/累计上限走旧条款。
  renew_terms: z.string().optional().default(''),
  // 动态窗口消费状态（后端 wire 格式：JSON 数组文本）。仅动态模型订阅使用。
  window_state: z.string().optional().default(''),
})

export type UserSubscription = z.infer<typeof userSubscriptionSchema>

// 续费条款快照（购买时写入，续费走旧条款）。与后端 model.RenewTermsSnapshot 对应。
export interface RenewTermsSnapshot {
  duration_seconds: number
  price_amount: number
  max_cumulative_seconds: number
}

export interface UserSubscriptionRecord {
  subscription: UserSubscription
  // 订阅对应的套餐快照（含已禁用套餐）。后端 self 接口随订阅附带，用于停售套餐
  // 下架后仍能渲染套餐名/周期/限额等详情。
  plan?: SubscriptionPlan
}

// Admin global subscriptions list item (enriched with owner + plan info).
export interface AdminUserSubscriptionSummary {
  subscription: UserSubscription
  username: string
  email?: string
  display_name?: string
  plan_title?: string
  // 完整套餐快照（含 reset_windows），供管理端逐窗口渲染滚动用量；套餐被删时缺省。
  plan?: SubscriptionPlan
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PlanPayload {
  plan: Partial<SubscriptionPlan>
}

export interface SubscriptionPayRequest {
  plan_id: number
  payment_method?: string
  subscription_id?: number
}

export interface SubscriptionPayResponse {
  success: boolean
  message?: string
  data?: Record<string, unknown>
  url?: string
}

export interface CreateUserSubscriptionRequest {
  plan_id: number
}

export interface ResetUserSubscriptionsRequest {
  plan_id: number
  advance_reset_time: boolean
}

export interface ResetPlanSubscriptionsRequest {
  advance_reset_time: boolean
}

export interface SubscriptionResetResult {
  plan_id: number
  matched_count: number
  reset_count: number
  user_count: number
  advance_reset_time: boolean
}

// ============================================================================
// Self Subscription Data (user-facing)
// ============================================================================

export interface SelfSubscriptionData {
  billing_preference: string
  subscriptions: UserSubscriptionRecord[]
  all_subscriptions: UserSubscriptionRecord[]
  max_simultaneous?: number
}

// ============================================================================
// Dialog Types
// ============================================================================

export type SubscriptionsDialogType =
  | 'create'
  | 'update'
  | 'toggle-status'
  | 'reset-subscriptions'
  | 'delete'
