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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import {
  ERROR_MESSAGES,
  QUOTA_POOL_AMOUNT_TYPES,
  QUOTA_POOL_BALANCE_MODES,
  QUOTA_POOL_PERIODS,
  QUOTA_POOL_VALIDATION,
  type QuotaPoolAmountType,
  type QuotaPoolBalanceMode,
  type QuotaPoolPeriod,
} from '../constants'
import type { QuotaPool, QuotaPoolPayload } from '../types'

// ============================================================================
// Form Schema (use getQuotaPoolFormSchema(t) in components for i18n messages)
// ============================================================================

export function getQuotaPoolFormSchema(t: TFunction) {
  return z
    .object({
      name: z
        .string()
        .min(1, t(ERROR_MESSAGES.NAME_REQUIRED))
        .max(QUOTA_POOL_VALIDATION.NAME_MAX_LENGTH, t(ERROR_MESSAGES.NAME_TOO_LONG, { max: QUOTA_POOL_VALIDATION.NAME_MAX_LENGTH })),
      description: z.string().max(QUOTA_POOL_VALIDATION.DESCRIPTION_MAX_LENGTH).optional(),
      enabled: z.boolean(),
      period: z.enum(QUOTA_POOL_PERIODS),
      amount_type: z.enum(QUOTA_POOL_AMOUNT_TYPES),
      amount_dollars: z.number().min(0, t(ERROR_MESSAGES.AMOUNT_NON_NEGATIVE)).optional(),
      min_dollars: z.number().min(0, t(ERROR_MESSAGES.AMOUNT_NON_NEGATIVE)).optional(),
      max_dollars: z.number().min(0, t(ERROR_MESSAGES.AMOUNT_NON_NEGATIVE)).optional(),
      pool_period_cap_dollars: z.number().min(0).optional(),
      user_period_cap_dollars: z.number().min(0).optional(),
      user_period_count_limit: z.number().min(0).optional(),
      balance_mode: z.enum(QUOTA_POOL_BALANCE_MODES),
      balance_limit_dollars: z.number().min(0).optional(),
      time_rule: z.string().optional(),
    })
    .refine(
      (val) => val.amount_type !== 'random' || (val.max_dollars ?? 0) >= (val.min_dollars ?? 0),
      { message: t(ERROR_MESSAGES.RANDOM_RANGE_INVALID), path: ['max_dollars'] }
    )
}

export type QuotaPoolFormValues = {
  name: string
  description?: string
  enabled: boolean
  period: QuotaPoolPeriod
  amount_type: QuotaPoolAmountType
  amount_dollars?: number
  min_dollars?: number
  max_dollars?: number
  pool_period_cap_dollars?: number
  user_period_cap_dollars?: number
  user_period_count_limit?: number
  balance_mode: QuotaPoolBalanceMode
  balance_limit_dollars?: number
  time_rule?: string
}

// ============================================================================
// Form Defaults
// ============================================================================

export const QUOTA_POOL_FORM_DEFAULT_VALUES: QuotaPoolFormValues = {
  name: '',
  description: '',
  enabled: true,
  period: 'weekly',
  amount_type: 'fixed',
  amount_dollars: 1,
  min_dollars: 1,
  max_dollars: 5,
  pool_period_cap_dollars: 0,
  user_period_cap_dollars: 0,
  user_period_count_limit: 0,
  balance_mode: 'off',
  balance_limit_dollars: 0,
  time_rule: '',
}

// ============================================================================
// Form Data Transformation
// ============================================================================

export function transformFormDataToPayload(
  data: QuotaPoolFormValues
): QuotaPoolPayload {
  return {
    name: data.name.trim(),
    description: data.description?.trim() ?? '',
    enabled: data.enabled,
    period: data.period,
    amount_type: data.amount_type,
    amount: data.amount_type === 'fixed' ? parseQuotaFromDollars(data.amount_dollars ?? 0) : 0,
    min_amount: data.amount_type === 'random' ? parseQuotaFromDollars(data.min_dollars ?? 0) : 0,
    max_amount: data.amount_type === 'random' ? parseQuotaFromDollars(data.max_dollars ?? 0) : 0,
    time_rule: data.time_rule ?? '',
    pool_period_cap: parseQuotaFromDollars(data.pool_period_cap_dollars ?? 0),
    user_period_cap: parseQuotaFromDollars(data.user_period_cap_dollars ?? 0),
    balance_mode: data.balance_mode,
    balance_limit: parseQuotaFromDollars(data.balance_limit_dollars ?? 0),
    user_period_count_limit: data.user_period_count_limit ?? 0,
  }
}

export function transformQuotaPoolToFormDefaults(
  pool: QuotaPool
): QuotaPoolFormValues {
  return {
    name: pool.name,
    description: pool.description,
    enabled: pool.enabled,
    period: pool.period,
    amount_type: pool.amount_type,
    amount_dollars: quotaUnitsToDollars(pool.amount),
    min_dollars: quotaUnitsToDollars(pool.min_amount),
    max_dollars: quotaUnitsToDollars(pool.max_amount),
    pool_period_cap_dollars: quotaUnitsToDollars(pool.pool_period_cap),
    user_period_cap_dollars: quotaUnitsToDollars(pool.user_period_cap),
    user_period_count_limit: pool.user_period_count_limit,
    balance_mode: pool.balance_mode,
    balance_limit_dollars: quotaUnitsToDollars(pool.balance_limit),
    time_rule: pool.time_rule,
  }
}
