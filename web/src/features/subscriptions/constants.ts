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

// ============================================================================
// Duration Unit Options
// ============================================================================

export const DURATION_UNITS = [
  { value: 'year', labelKey: 'years' },
  { value: 'month', labelKey: 'months' },
  { value: 'day', labelKey: 'days' },
  { value: 'hour', labelKey: 'hours' },
  { value: 'custom', labelKey: 'Custom (seconds)' },
] as const

export function getDurationUnitOptions(t: TFunction) {
  return DURATION_UNITS.map((u) => ({ value: u.value, label: t(u.labelKey) }))
}

// ============================================================================
// Subscription Status Options
// ============================================================================

export const SUBSCRIPTION_STATUS_OPTIONS = [
  { value: 'active', labelKey: 'Active' },
  { value: 'expired', labelKey: 'Expired' },
  { value: 'cancelled', labelKey: 'Cancelled' },
  { value: 'deleted', labelKey: 'Deleted' },
] as const

export function getSubscriptionStatusOptions(t: TFunction) {
  return SUBSCRIPTION_STATUS_OPTIONS.map((s) => ({
    value: s.value,
    label: t(s.labelKey),
  }))
}

// ============================================================================
// Server-side Sortable Columns
// ============================================================================

// Column ids the admin subscriptions backend accepts for `sort_by`. `usage` is
// computed (total - used) and `actions` is not data, so both stay unsortable.
export type SubscriptionSortBy =
  | 'id'
  | 'user'
  | 'plan'
  | 'status'
  | 'start_time'
  | 'end_time'

export const SUBSCRIPTION_SORTABLE_COLUMNS = new Set<SubscriptionSortBy>([
  'id',
  'user',
  'plan',
  'status',
  'start_time',
  'end_time',
])
