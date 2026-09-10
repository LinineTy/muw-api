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
  Account,
  AccountChannelRef,
  AccountCodingPlanQuota,
  CreateAccountRequest,
  GetAccountsResponse,
  UpdateAccountRequest,
} from './types'

export async function getAccounts(params: {
  p?: number
  page_size?: number
  keyword?: string
  type?: number
  status?: number
  referenced?: boolean
  monitoring?: boolean
}): Promise<GetAccountsResponse> {
  const res = await api.get('/api/account/', {
    params: {
      ...params,
      // 后端用 1/0 区分「是/否」两态，不传 = 不限
      referenced:
        params.referenced === undefined ? undefined : params.referenced ? 1 : 0,
      monitoring:
        params.monitoring === undefined ? undefined : params.monitoring ? 1 : 0,
    },
  })
  return res.data.data
}

export async function getAccount(id: number): Promise<Account> {
  const res = await api.get(`/api/account/${id}`)
  return res.data.data
}

export async function getAccountChannelRefs(
  id: number
): Promise<AccountChannelRef[]> {
  const res = await api.get(`/api/account/${id}/channels`)
  return res.data.data ?? []
}

/**
 * 查询账户的编码套餐余量。账户需显式开启监控（coding_plan_provider），
 * 查询地址固定走厂商官方，与账户 base_url 无关。
 */
export async function getAccountCodingPlanQuota(
  id: number
): Promise<AccountCodingPlanQuota> {
  const res = await api.get(`/api/account/${id}/coding_plan/quota`)
  return res.data.data
}

export async function createAccount(
  request: CreateAccountRequest
): Promise<void> {
  await api.post('/api/account/', request)
}

export async function updateAccount(
  request: UpdateAccountRequest
): Promise<void> {
  await api.put('/api/account/', request)
}

export async function deleteAccount(id: number): Promise<void> {
  await api.delete(`/api/account/${id}`)
}
