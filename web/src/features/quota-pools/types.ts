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
// Quota Pool Schema & Types
// ============================================================================

export const quotaPoolSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  period: z.enum(['daily', 'weekly', 'monthly']),
  amount_type: z.enum(['fixed', 'random']),
  amount: z.number(),
  min_amount: z.number(),
  max_amount: z.number(),
  time_rule: z.string(),
  pool_period_cap: z.number(),
  user_period_cap: z.number(),
  balance_mode: z.enum(['off', 'below', 'above']),
  balance_limit: z.number(),
  user_period_count_limit: z.number(),
  created_time: z.number(),
  updated_time: z.number(),
})

export type QuotaPool = z.infer<typeof quotaPoolSchema>

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface QuotaPoolPayload {
  name: string
  description?: string
  enabled?: boolean
  period: 'daily' | 'weekly' | 'monthly'
  amount_type: 'fixed' | 'random'
  amount?: number
  min_amount?: number
  max_amount?: number
  time_rule?: string
  pool_period_cap?: number
  user_period_cap?: number
  balance_mode: 'off' | 'below' | 'above'
  balance_limit?: number
  user_period_count_limit?: number
}

export interface QuotaPoolRecordsResponse {
  success: boolean
  message?: string
  data?: {
    items: QuotaClaimRecord[]
    total: number
    page: number
    page_size: number
  }
}

export interface QuotaClaimRecord {
  id: number
  user_id: number
  pool_id: number
  quota: number
  period_key: string
  claimed_at: number
}

// ============================================================================
// Dialog Types
// ============================================================================

export type QuotaPoolsDialogType = 'create' | 'update' | 'delete'
