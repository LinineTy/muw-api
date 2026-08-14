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
export interface ApiResponse<T = unknown> {
  success?: boolean
  message?: string
  data?: T
}

export type SpaceOrderStatus = 'success' | 'pending' | 'expired'

/**
 * 云空间购买订单（playground_space_orders 表）。
 */
export interface SpaceOrderRecord {
  id: number
  user_id: number
  mb: number
  cost: number
  money: number
  trade_no: string
  payment_method: string
  status: SpaceOrderStatus
  create_time: number
}

export interface SpaceOrdersResponse {
  items: SpaceOrderRecord[]
  total: number
}
