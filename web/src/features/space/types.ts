// @muw-owned
import type { Message } from '@/features/playground/types'

/**
 * 用户云空间用量与购买信息（GET /api/playground/space）。
 * capacity_bytes 为 -1 时表示无限（root）。
 */
export interface SpaceInfo {
  capacity_bytes: number
  used_bytes: number
  purchase_ratio: number
  max_purchase_mb: number
  global_used_bytes: number
  global_max_bytes: number
  transient_count: number
  transient_bytes: number
  permanent_count: number
  permanent_bytes: number
  conversation_count: number
  conversation_used_bytes: number
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
