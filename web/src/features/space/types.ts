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
import type { Message } from '@/features/playground/types'

/**
 * 用户云空间用量与购买信息（GET /api/playground/space）。
 * capacity_bytes 为 -1 时表示无限（root）。
 */
export interface SpaceInfo {
  capacity_bytes: number
  used_bytes: number
  purchase_ratio: number
  global_used_bytes: number
  global_max_bytes: number
  transient_count: number
  transient_bytes: number
  permanent_count: number
  permanent_bytes: number
}

/**
 * 服务端同步的会话（GET /api/playground/conversations）。
 * messages 为前端 Message[] 的 JSON 透传。
 */
export interface RemoteConversation {
  id: number
  client_id: string
  title: string
  messages: Message[]
  created_time: number
  updated_time: number
}
