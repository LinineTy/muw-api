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

import type { Conversation, Message } from '../../types'

type RemoteConversation = {
  id: number
  client_id: string
  title: string
  messages: Message[]
  created_time: number
  updated_time: number
}

/**
 * 服务端为最终准，localStorage 降级为离线缓存。会话以 client_id（= 前端
 * nanoid）为稳定键；updatedAt 后端按秒、前端按毫秒，拉取时 ×1000 归一。
 */

/**
 * 拉取当前用户全部同步会话。返回 null 表示请求失败（保持本地可用）。
 */
export async function pullServerConversations(): Promise<Conversation[] | null> {
  try {
    const res = await api.get('/api/playground/conversations', {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    const { data } = res
    if (!data.success || !Array.isArray(data.data)) {
      return null
    }
    return (data.data as RemoteConversation[]).map((item) => ({
      id: item.client_id,
      title: item.title ?? '',
      messages: Array.isArray(item.messages) ? item.messages : [],
      createdAt: (item.created_time ?? 0) * 1000,
      updatedAt: (item.updated_time ?? 0) * 1000,
    }))
  } catch {
    return null
  }
}

/**
 * 推送（upsert）一个会话到服务端。
 */
export async function pushServerConversation(
  conversation: Conversation
): Promise<void> {
  await api.put(
    `/api/playground/conversations/${encodeURIComponent(conversation.id)}`,
    {
      title: conversation.title,
      messages: conversation.messages,
    },
    { skipErrorHandler: true } as Record<string, unknown>
  )
}

/**
 * 删除服务端会话（软删）。
 */
export async function deleteServerConversation(clientId: string): Promise<void> {
  await api.delete(
    `/api/playground/conversations/${encodeURIComponent(clientId)}`,
    { skipErrorHandler: true } as Record<string, unknown>
  )
}

/**
 * 合并本地与服务端会话：按 id 取 updatedAt 较新者；本地独有保留并标记待推送
 * （首次同步保证本地→云端不丢）；服务端独有并入本地。
 */
export function mergeConversations(
  local: Conversation[],
  remote: Conversation[]
): { merged: Conversation[]; dirtyIds: string[] } {
  const remoteById = new Map(remote.map((conversation) => [conversation.id, conversation]))
  const mergedById = new Map<string, Conversation>()
  const dirtyIds: string[] = []

  for (const localConversation of local) {
    const remoteConversation = remoteById.get(localConversation.id)
    if (!remoteConversation) {
      // 本地独有：保留，待推送。
      mergedById.set(localConversation.id, localConversation)
      dirtyIds.push(localConversation.id)
      continue
    }
    if (remoteConversation.updatedAt > localConversation.updatedAt) {
      mergedById.set(localConversation.id, remoteConversation)
    } else {
      mergedById.set(localConversation.id, localConversation)
      if (remoteConversation.updatedAt < localConversation.updatedAt) {
        // 本地更新：保留本地，待推送。
        dirtyIds.push(localConversation.id)
      }
    }
  }

  for (const remoteConversation of remote) {
    if (!mergedById.has(remoteConversation.id)) {
      mergedById.set(remoteConversation.id, remoteConversation)
    }
  }

  return { merged: [...mergedById.values()], dirtyIds }
}
