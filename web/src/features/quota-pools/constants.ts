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
// ============================================================================
// Quota Pool Period / Amount / Balance options
// ============================================================================

export const QUOTA_POOL_PERIODS = ['daily', 'weekly', 'monthly'] as const
export type QuotaPoolPeriod = (typeof QUOTA_POOL_PERIODS)[number]

export const QUOTA_POOL_AMOUNT_TYPES = ['fixed', 'random'] as const
export type QuotaPoolAmountType = (typeof QUOTA_POOL_AMOUNT_TYPES)[number]

export const QUOTA_POOL_BALANCE_MODES = ['off', 'below', 'above'] as const
export type QuotaPoolBalanceMode = (typeof QUOTA_POOL_BALANCE_MODES)[number]

// labelKey values are i18n keys; use t(config.labelKey) in components
export const QUOTA_POOL_PERIOD_OPTIONS: Record<
  QuotaPoolPeriod,
  { labelKey: string; value: QuotaPoolPeriod }
> = {
  daily: { labelKey: 'Daily', value: 'daily' },
  weekly: { labelKey: 'Weekly', value: 'weekly' },
  monthly: { labelKey: 'Monthly', value: 'monthly' },
}

export const QUOTA_POOL_AMOUNT_TYPE_OPTIONS: Record<
  QuotaPoolAmountType,
  { labelKey: string; value: QuotaPoolAmountType }
> = {
  fixed: { labelKey: 'Fixed', value: 'fixed' },
  random: { labelKey: 'Random', value: 'random' },
}

export const QUOTA_POOL_BALANCE_MODE_OPTIONS: Record<
  QuotaPoolBalanceMode,
  { labelKey: string; value: QuotaPoolBalanceMode }
> = {
  off: { labelKey: 'Disabled', value: 'off' },
  below: { labelKey: 'Claim when balance is below', value: 'below' },
  above: { labelKey: 'Claim when balance is above', value: 'above' },
}

// ============================================================================
// Validation
// ============================================================================

export const QUOTA_POOL_VALIDATION = {
  NAME_MAX_LENGTH: 64,
  DESCRIPTION_MAX_LENGTH: 255,
} as const

export const ERROR_MESSAGES = {
  UNEXPECTED: 'An unexpected error occurred',
  LOAD_FAILED: 'Failed to load quota pools',
  CREATE_FAILED: 'Failed to create quota pool',
  UPDATE_FAILED: 'Failed to update quota pool',
  DELETE_FAILED: 'Failed to delete quota pool',
  NAME_REQUIRED: 'Name is required',
  NAME_TOO_LONG: 'Name must be at most {{max}} characters',
  RANDOM_RANGE_INVALID: 'Random max amount must be greater than or equal to min amount',
  AMOUNT_NON_NEGATIVE: 'Amount must be a non-negative number',
} as const

export const SUCCESS_MESSAGES = {
  QUOTA_POOL_CREATED: 'Quota pool created successfully',
  QUOTA_POOL_UPDATED: 'Quota pool updated successfully',
  QUOTA_POOL_DELETED: 'Quota pool deleted successfully',
  QUOTA_POOL_ENABLED: 'Quota pool enabled successfully',
  QUOTA_POOL_DISABLED: 'Quota pool disabled successfully',
} as const
