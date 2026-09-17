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
import { api, type ApiRequestConfig } from '@/lib/api'

import type {
  Account,
  AccountChannelRef,
  AccountCodingPlanQuota,
  AccountMultiKeyActionResponse,
  AccountMultiKeyManageParams,
  AccountMultiKeyStatusResponse,
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

// ============================================================================
// 多密钥管理（账户抽屉）：POST /api/account/multi_key/manage
// 与渠道侧 /api/channel/multi_key/manage 同一份实现，仅把 channel_id 换成 account_id。
// 响应里只会有脱敏预览（后端 KeyStatus.key_preview 只给前 10 位），明文须走
// GET /api/account/:id/key（Root + 安全验证）。
// ============================================================================

const accountMultiKeyConfig = (
  config: ApiRequestConfig = {}
): ApiRequestConfig => ({
  ...config,
  skipBusinessError: true,
  skipErrorHandler: true,
})

async function manageAccountMultiKeys(
  params: AccountMultiKeyManageParams
): Promise<AccountMultiKeyActionResponse> {
  const res = await api.post(
    '/api/account/multi_key/manage',
    params,
    accountMultiKeyConfig()
  )
  return res.data
}

export async function getAccountMultiKeyStatus(
  accountId: number,
  page = 1,
  pageSize = 10,
  status?: number
): Promise<AccountMultiKeyStatusResponse> {
  return manageAccountMultiKeys({
    account_id: accountId,
    action: 'get_key_status',
    page,
    page_size: pageSize,
    status,
  }) as Promise<AccountMultiKeyStatusResponse>
}

/** 追加一把或多把密钥（服务端拆分、去重后追加到列表末尾） */
export async function addAccountMultiKeys(
  accountId: number,
  keys: string[]
): Promise<AccountMultiKeyActionResponse> {
  return manageAccountMultiKeys({
    account_id: accountId,
    action: 'add_key',
    keys,
  })
}

export async function enableAccountMultiKey(
  accountId: number,
  keyIndex: number
): Promise<AccountMultiKeyActionResponse> {
  return manageAccountMultiKeys({
    account_id: accountId,
    action: 'enable_key',
    key_index: keyIndex,
  })
}

export async function disableAccountMultiKey(
  accountId: number,
  keyIndex: number
): Promise<AccountMultiKeyActionResponse> {
  return manageAccountMultiKeys({
    account_id: accountId,
    action: 'disable_key',
    key_index: keyIndex,
  })
}

export async function deleteAccountMultiKey(
  accountId: number,
  keyIndex: number
): Promise<AccountMultiKeyActionResponse> {
  return manageAccountMultiKeys({
    account_id: accountId,
    action: 'delete_key',
    key_index: keyIndex,
  })
}
