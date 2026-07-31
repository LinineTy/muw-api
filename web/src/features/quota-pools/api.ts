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

import type {
  ApiResponse,
  QuotaClaimRecord,
  QuotaPool,
  QuotaPoolPayload,
  QuotaPoolRecordsResponse,
} from './types'

// ============================================================================
// Quota Pool Admin Management
// ============================================================================

export async function getQuotaPools(): Promise<ApiResponse<QuotaPool[]>> {
  const res = await api.get('/api/quota-pool/')
  return res.data
}

export async function createQuotaPool(
  data: QuotaPoolPayload
): Promise<ApiResponse<QuotaPool>> {
  const res = await api.post('/api/quota-pool/', data)
  return res.data
}

export async function updateQuotaPool(
  id: number,
  data: QuotaPoolPayload
): Promise<ApiResponse<QuotaPool>> {
  const res = await api.put(`/api/quota-pool/${id}`, data)
  return res.data
}

export async function toggleQuotaPool(
  id: number,
  enabled: boolean
): Promise<ApiResponse> {
  const res = await api.patch(`/api/quota-pool/${id}`, { enabled })
  return res.data
}

export async function deleteQuotaPool(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/quota-pool/${id}`)
  return res.data
}

export async function getQuotaPoolRecords(
  id: number,
  params: { p?: number; size?: number }
): Promise<QuotaPoolRecordsResponse> {
  const res = await api.get(`/api/quota-pool/${id}/records`, { params })
  return res.data
}

export type { QuotaClaimRecord }
