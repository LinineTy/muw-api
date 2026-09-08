// @muw-owned
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
