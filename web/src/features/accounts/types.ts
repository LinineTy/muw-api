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

// 账户类型与渠道类型共用同一套厂商编号（channels.type / accounts.type 同源）。

export interface AccountChannelInfo {
  is_multi_key?: boolean
  multi_key_mode?: string
  multi_key_size?: number
  multi_key_polling_index?: number
}

export interface Account {
  id: number
  name: string
  type: number
  status: number
  key_masked: string
  openai_organization?: string | null
  base_url?: string | null
  other?: string
  setting?: string | null
  settings?: string
  balance: number
  balance_updated_time: number
  other_info?: string
  remark?: string | null
  created_time: number
  channel_info: AccountChannelInfo
  coding_plan_provider?: string | null
  coding_plan_key_masked?: string
  coding_plan_quota_group?: string
  coding_plan_auto_control?: boolean | null
  coding_plan_disable_threshold?: number | null
  coding_plan_enable_threshold?: number | null
  updated_at?: number
  auto_generated?: boolean
}

export interface AccountListItem {
  account: Account
  channel_count: number
  referenced: boolean
}

export interface GetAccountsResponse {
  items: AccountListItem[]
  total: number
  page: number
  page_size: number
}

export interface GetAccountResponse {
  success: boolean
  message?: string
  data: Account
}

export interface AccountChannelRef {
  id: number
  name: string
  status: number
  models: string
}

export interface CreateAccountRequest {
  name: string
  type: number
  key: string
  base_url?: string | null
  openai_organization?: string | null
  setting?: string | null
  other?: string
  coding_plan_provider?: string | null
  coding_plan_key?: string
  coding_plan_auto_control?: boolean | null
  coding_plan_disable_threshold?: number | null
  coding_plan_enable_threshold?: number | null
  remark?: string | null
  is_multi_key?: boolean
  multi_key_mode?: string
}

export interface UpdateAccountRequest {
  id: number
  name?: string
  type?: number
  key?: string
  base_url?: string | null
  openai_organization?: string | null
  setting?: string | null
  other?: string
  coding_plan_provider?: string | null
  coding_plan_key?: string
  coding_plan_auto_control?: boolean | null
  coding_plan_disable_threshold?: number | null
  coding_plan_enable_threshold?: number | null
  remark?: string | null
  status?: number
  multi_key_mode?: string
}

export const ACCOUNT_STATUS = {
  ENABLED: 1,
  MANUALLY_DISABLED: 2,
  AUTO_DISABLED: 3,
} as const
