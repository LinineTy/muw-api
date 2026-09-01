// @muw-owned
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
 * nanoid）为稳定键。updatedAt/createdAt 前后端统一为毫秒时间戳（后端会话
 * upsert 已改存毫秒），避免「后端秒 × 前端毫秒」的同秒冲突导致编辑静默丢失。
 */

/**
 * 本设备已删除会话的 client_id 列表（tombstone），持久化到 localStorage。
 * 服务端是软删：若设备 B 仍持有已删会话的本地副本，拉取时会被误判为「本地
 * 独有」重新推送、upsert 复活。用 tombstone 让删除真正跨设备传播。
 */
const DELETED_CONVERSATIONS_KEY = 'playground.deleted-conversation-ids'

export function getDeletedConversationIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_CONVERSATIONS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export function markConversationDeleted(clientId: string): void {
  const ids = getDeletedConversationIds()
  if (!ids.includes(clientId)) {
    ids.push(clientId)
    try {
      localStorage.setItem(DELETED_CONVERSATIONS_KEY, JSON.stringify(ids))
    } catch {
      // 存储不可用时 tombstone 降级：本次删除仍生效，但可能被其他设备重新拉回。
    }
  }
}

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
      createdAt: item.created_time ?? 0,
      updatedAt: item.updated_time ?? 0,
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
 * （首次同步保证本地→云端不丢）；服务端独有并入本地。deletedIds 是本设备已删
 * 的 client_id（tombstone）：已删会话从本地移除、不重推、也不从服务端拉回——
 * 否则软删会被其他设备的本地副本通过「本地独有 → 重推 → upsert 复活」。
 */
export function mergeConversations(
  local: Conversation[],
  remote: Conversation[],
  deletedIds: string[] = []
): { merged: Conversation[]; dirtyIds: string[] } {
  const deleted = new Set(deletedIds)
  const remoteById = new Map(remote.map((conversation) => [conversation.id, conversation]))
  const mergedById = new Map<string, Conversation>()
  const dirtyIds: string[] = []

  for (const localConversation of local) {
    if (deleted.has(localConversation.id)) {
      // 本设备已删：从本地移除，不得作为「本地独有」重推。
      continue
    }
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
    if (deleted.has(remoteConversation.id)) {
      // 已删会话不从服务端拉回。
      continue
    }
    if (!mergedById.has(remoteConversation.id)) {
      mergedById.set(remoteConversation.id, remoteConversation)
    }
  }

  return { merged: [...mergedById.values()], dirtyIds }
}
