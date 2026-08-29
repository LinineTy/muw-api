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
  CreateAccountRequest,
  GetAccountsResponse,
  UpdateAccountRequest,
} from './types'

export async function getAccounts(params: {
  p?: number
  page_size?: number
  keyword?: string
}): Promise<GetAccountsResponse> {
  const res = await api.get('/api/account/', { params })
  return res.data
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
