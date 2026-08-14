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
import i18next from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import {
  saveConfig,
  saveParameterEnabled,
  getInitialParameterEnabled,
  getInitialPlaygroundConfig,
  loadOrCreateConversations,
  saveConversations,
  saveActiveConversationId,
  type MessageStateUpdater,
} from '../lib'
import {
  createConversation,
  removeConversationById,
  renameConversationById,
  updateActiveConversationMessages,
} from '../lib/conversation/conversation-utils'
import {
  createSystemMessage,
  updateCurrentVersionContent,
} from '../lib/message/message-utils'
import {
  deleteServerConversation,
  getDeletedConversationIds,
  markConversationDeleted,
  mergeConversations,
  pullServerConversations,
  pushServerConversation,
} from '../lib/sync/conversation-sync'
import type {
  Conversation,
  PlaygroundConfig,
  ParameterEnabled,
  ModelOption,
  GroupOption,
} from '../types'

const CONVERSATIONS_SAVE_DEBOUNCE_MS = 500
// 推送失败退避的最大连续重试次数；超过后停止自动重试，等下次本地改动/聚焦再触发。
const MAX_PUSH_RETRY_COUNT = 5
// 单会话可同步的请求体上限（与服务端 maxConversationMessagesBytes 2MB 对齐，
// 含 JSON 序列化开销）。超过即放弃推送并提示，避免静默失败 + 退避重试刷日志。
const MAX_SYNC_PAYLOAD_BYTES = 2 * 1024 * 1024
// 拉取节流：快速切换窗口/聚焦时避免连续发 GET。
const CONVERSATIONS_PULL_THROTTLE_MS = 2000
// 会话被远端覆盖时的一次性提示防噪间隔：同一会话短期内只提示一次，聚焦/切窗口
// 反复触发同步也不会刷屏。
const CONVERSATION_SYNC_NOTIFY_THROTTLE_MS = 30_000

/**
 * Main state management hook for playground.
 *
 * Holds a list of named conversations plus the active one; the public `messages`
 * value is derived from the active conversation so the rest of the UI keeps
 * working unchanged.
 *
 * 多设备同步：localStorage 仍是离线缓存（首屏回退 + 卸载写入），服务端为最终准。
 * 进入页面 / 窗口聚焦时拉取合并（merge 按 updatedAt 取新者，本地改动不回退）；
 * 本地改动 500ms 防抖推送（只推 updatedAt 有变化的会话），失败保留脏标记下轮重试。
 */
export function usePlaygroundState() {
  const { t } = useTranslation()

  // Load initial state from localStorage
  const [config, setConfig] = useState<PlaygroundConfig>(
    getInitialPlaygroundConfig
  )

  const [parameterEnabled, setParameterEnabled] = useState<ParameterEnabled>(
    getInitialParameterEnabled
  )

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  )
  const [isLoadingMessages, setIsLoadingMessages] = useState(true)
  const conversationsSaveTimerRef = useRef<number | null>(null)
  const latestConversationsRef = useRef<Conversation[]>(conversations)
  const hasLoadedConversationsRef = useRef(false)

  // 服务端同步状态：脏会话集合、推送定时器、进行中标记、已推送 updatedAt 表。
  const dirtyClientIdsRef = useRef<Set<string>>(new Set())
  const pushTimerRef = useRef<number | null>(null)
  const pushInFlightRef = useRef(false)
  const lastPushedUpdatedAtRef = useRef<Map<string, number>>(new Map())
  const flushPushRef = useRef<() => Promise<void>>(async () => {})
  const pushRetryCountRef = useRef(0)
  const lastPullAtRef = useRef(0)
  // 是否还没完成首次成功拉取：用于「空新对话自动切到最近会话」的首次拉取门控。
  const initialPullRef = useRef(true)
  const mountedRef = useRef(true)
  // active 会话 id 的 ref 镜像：render 期同步，供 pullAndMerge 等 callback 读取当前值
  // 而不必把它加进依赖数组（否则 focus listener 会反复重建）。
  const activeConversationIdRef = useRef(activeConversationId)
  activeConversationIdRef.current = activeConversationId
  // 会话被远端覆盖提示的防噪表：client_id → 上次提示时间。
  const conversationSyncNotifiedAtRef = useRef(new Map<string, number>())
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  const activeConversation =
    conversations.find(
      (conversation) => conversation.id === activeConversationId
    ) ?? null
  const messages = activeConversation?.messages ?? []

  // 调度一次防抖推送（已有定时器则合并）。失败重试可传入更长延迟做退避。
  const schedulePush = useCallback((delayMs = CONVERSATIONS_SAVE_DEBOUNCE_MS) => {
    if (pushTimerRef.current !== null) {
      return
    }
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null
      void flushPushRef.current()
    }, delayMs)
  }, [])

  // 推送脏会话；成功记录已推送 updatedAt，失败保留脏标记待下轮重试。
  const flushPush = useCallback(async () => {
    pushTimerRef.current = null
    const dirty = dirtyClientIdsRef.current
    if (dirty.size === 0 || pushInFlightRef.current) {
      return
    }
    pushInFlightRef.current = true
    try {
      for (const conversation of latestConversationsRef.current) {
        if (!dirty.has(conversation.id)) {
          continue
        }
        if (
          lastPushedUpdatedAtRef.current.get(conversation.id) ===
          conversation.updatedAt
        ) {
          dirty.delete(conversation.id)
          continue
        }
        // 空会话（无任何消息）同步无意义：跳过推送，避免 seed 的「New chat」
        // 或清空后的会话在服务端堆积/被其他设备复活。
        if (conversation.messages.length === 0) {
          dirty.delete(conversation.id)
          lastPushedUpdatedAtRef.current.set(
            conversation.id,
            conversation.updatedAt
          )
          continue
        }
        // 推送前预检体积：超过服务端 2MB 上限的会话无法同步，直接放弃并提示，
        // 避免静默失败 + 退避重试刷日志（消息含 base64 附件时尤其容易超限）。
        const payloadSize = new TextEncoder().encode(
          JSON.stringify({
            title: conversation.title,
            messages: conversation.messages,
          })
        ).length
        if (payloadSize > MAX_SYNC_PAYLOAD_BYTES) {
          dirty.delete(conversation.id)
          lastPushedUpdatedAtRef.current.set(
            conversation.id,
            conversation.updatedAt
          )
          toast.error(i18next.t('Conversation is too large to sync'))
          continue
        }
        const pushedAt = conversation.updatedAt
        await pushServerConversation(conversation)
        // 推送在途期间用户可能又编辑了该会话：以最新 updatedAt 为准，若已前进
        // 则保留脏标记并重推，避免新编辑被旧推送的 lastPushedUpdatedAt 覆盖而丢失。
        const latest = latestConversationsRef.current.find(
          (c) => c.id === conversation.id
        )
        if (latest && latest.updatedAt > pushedAt) {
          dirtyClientIdsRef.current.add(conversation.id)
          lastPushedUpdatedAtRef.current.delete(conversation.id)
          continue
        }
        lastPushedUpdatedAtRef.current.set(conversation.id, conversation.updatedAt)
        dirty.delete(conversation.id)
      }
    } catch {
      // 网络/服务端失败：保留脏标记，按退避重试。
    } finally {
      pushInFlightRef.current = false
      if (dirtyClientIdsRef.current.size > 0) {
        // 退避：连续失败次数 × 基础延迟；超上限后停止自动重试，等下一次本地
        // 改动或页面聚焦再触发，避免服务端不可达时 500ms 高频打接口。
        pushRetryCountRef.current += 1
        if (pushRetryCountRef.current <= MAX_PUSH_RETRY_COUNT) {
          schedulePush(pushRetryCountRef.current * CONVERSATIONS_SAVE_DEBOUNCE_MS)
        }
      } else {
        pushRetryCountRef.current = 0
      }
    }
  }, [schedulePush])

  useEffect(() => {
    flushPushRef.current = flushPush
  }, [flushPush])

  // 拉取服务端会话并按 updatedAt 合并到本地。本地独有会话标记脏待推送。
  const pullAndMerge = useCallback(async () => {
    // 节流：快速切换窗口/聚焦时跳过，避免每次 focus/visibilitychange 都发请求。
    const now = Date.now()
    if (now - lastPullAtRef.current < CONVERSATIONS_PULL_THROTTLE_MS) {
      return
    }
    lastPullAtRef.current = now
    const remote = await pullServerConversations()
    // mountedRef 防卸载后 setState（聚焦/visibilitychange 触发的拉取可能在卸载后返回）。
    if (
      remote === null ||
      !hasLoadedConversationsRef.current ||
      !mountedRef.current
    ) {
      return
    }
    // 首个成功拉取：记录已拉过，后续聚焦拉取不再做「空新对话自动切换」。
    const firstSuccessfulPull = initialPullRef.current
    initialPullRef.current = false
    const local = latestConversationsRef.current
    const activeId = activeConversationIdRef.current
    const activeBefore = local.find((c) => c.id === activeId)?.updatedAt
    const { merged, dirtyIds } = mergeConversations(
      local,
      remote,
      getDeletedConversationIds()
    )

    // 合并条件：任一会话 updatedAt 变化或 id 集变化即应用。只用「长度或 dirtyIds」
    // 判断会漏掉纯远端覆盖（内容更新但数组长度不变、且本地无脏会话）——远端的新
    // 内容会被静默丢弃。
    const localById = new Map(local.map((c) => [c.id, c.updatedAt]))
    const changed =
      local.length !== merged.length ||
      merged.some((c) => localById.get(c.id) !== c.updatedAt)

    if (changed) {
      // 首次拉取：当前 active 是本地空「新对话」（种子/新建，无消息、服务端无该
      // 记录）且服务端有真实会话时，切到最近一条——否则新浏览器/新设备首次打开
      // 会一直停在空「新对话」上，即使真实会话已同步进来。用户自己新建的空对话
      // 不受影响（仅在首个成功拉取时判定，聚焦拉取不再切换，避免打扰）。
      let adoptedActiveId: string | null = null
      if (firstSuccessfulPull) {
        const currentActive = local.find((c) => c.id === activeId)
        const remoteReal = remote.find((c) => (c.messages?.length ?? 0) > 0)
        if (
          remoteReal &&
          currentActive &&
          currentActive.messages.length === 0 &&
          !remote.some((c) => c.id === currentActive.id)
        ) {
          adoptedActiveId = remoteReal.id
        }
      }
      latestConversationsRef.current = merged
      setConversations(merged)
      saveConversations(merged)
      setActiveConversationId((prev) => {
        if (adoptedActiveId) {
          return adoptedActiveId
        }
        if (prev && merged.some((conversation) => conversation.id === prev)) {
          return prev
        }
        return merged[0]?.id ?? prev
      })
      if (adoptedActiveId) {
        saveActiveConversationId(adoptedActiveId)
      }
      // 当前正在看的会话被远端覆盖 → 轻提示（30s 防噪）。仅此场景提示，其余静默。
      if (activeId) {
        const activeAfter = merged.find((c) => c.id === activeId)?.updatedAt
        const notifiedAt = conversationSyncNotifiedAtRef.current.get(activeId) ?? 0
        if (
          activeAfter !== undefined &&
          activeBefore !== undefined &&
          activeAfter > activeBefore &&
          Date.now() - notifiedAt >= CONVERSATION_SYNC_NOTIFY_THROTTLE_MS
        ) {
          conversationSyncNotifiedAtRef.current.set(activeId, Date.now())
          toast.info(
            i18next.t('This conversation was updated on another device.')
          )
        }
      }
      for (const id of dirtyIds) {
        dirtyClientIdsRef.current.add(id)
      }
      schedulePush()
    }
  }, [schedulePush])

  const persistConversations = useCallback(
    (conversationsToSave: Conversation[]) => {
      latestConversationsRef.current = conversationsToSave

      if (!hasLoadedConversationsRef.current) {
        return
      }

      // 服务端同步：标记脏会话并防抖推送（flush 只推 updatedAt 变化的）。
      for (const conversation of conversationsToSave) {
        dirtyClientIdsRef.current.add(conversation.id)
      }
      schedulePush()

      if (conversationsSaveTimerRef.current !== null) {
        window.clearTimeout(conversationsSaveTimerRef.current)
      }

      conversationsSaveTimerRef.current = window.setTimeout(() => {
        conversationsSaveTimerRef.current = null
        saveConversations(latestConversationsRef.current)
      }, CONVERSATIONS_SAVE_DEBOUNCE_MS)
    },
    [schedulePush]
  )

  useEffect(() => {
    let cancelled = false

    window.setTimeout(() => {
      const loaded = loadOrCreateConversations()
      if (cancelled) {
        return
      }

      latestConversationsRef.current = loaded.conversations
      hasLoadedConversationsRef.current = true
      setConversations(loaded.conversations)
      setActiveConversationId(loaded.activeId)
      setIsLoadingMessages(false)
      void pullAndMerge()
    }, 0)

    return () => {
      cancelled = true
    }
  }, [pullAndMerge])

  // 切回窗口/页面可见时拉取一次（近似实时，无推送设施）。
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void pullAndMerge()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [pullAndMerge])

  useEffect(
    () => () => {
      if (conversationsSaveTimerRef.current !== null) {
        window.clearTimeout(conversationsSaveTimerRef.current)
        saveConversations(latestConversationsRef.current)
      }
      if (pushTimerRef.current !== null) {
        window.clearTimeout(pushTimerRef.current)
      }
      // 尽力推送剩余脏会话（卸载场景 fire-and-forget）。
      void flushPushRef.current()
    },
    []
  )

  // Update config with automatic save
  const updateConfig = useCallback(
    <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
      setConfig((prev) => {
        const updated = { ...prev, [key]: value }
        saveConfig(updated)
        return updated
      })
    },
    []
  )

  // Update parameter enabled with automatic save
  const updateParameterEnabled = useCallback(
    (key: keyof ParameterEnabled, value: boolean) => {
      setParameterEnabled((prev) => {
        const updated = { ...prev, [key]: value }
        saveParameterEnabled(updated)
        return updated
      })
    },
    []
  )

  // Update active conversation messages with automatic save
  const updateMessages = useCallback(
    (updater: MessageStateUpdater) => {
      setConversations((prev) => {
        const next = updateActiveConversationMessages(
          prev,
          activeConversationId,
          updater
        )
        persistConversations(next)
        return next
      })
    },
    [activeConversationId, persistConversations]
  )

  // Clear all messages in the active conversation
  const clearMessages = useCallback(() => {
    updateMessages([])
  }, [updateMessages])

  // Create a new empty conversation and switch to it
  const createNewConversation = useCallback(() => {
    const conversation = createConversation(t('New chat'))
    const next = [...conversations, conversation]
    setConversations(next)
    setActiveConversationId(conversation.id)
    saveActiveConversationId(conversation.id)
    persistConversations(next)
  }, [conversations, persistConversations, t])

  // Switch the active conversation
  const switchConversation = useCallback((id: string) => {
    setActiveConversationId(id)
    saveActiveConversationId(id)
  }, [])

  // Rename a conversation by id
  const renameConversation = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      setConversations((prev) => {
        const next = renameConversationById(prev, id, trimmed)
        persistConversations(next)
        return next
      })
    },
    [persistConversations]
  )

  // Delete a conversation; when it was active, fall back to the first remaining
  // one, or create a fresh empty conversation when none is left. Also deletes it
  // from the server (soft delete).
  const deleteConversation = useCallback(
    (id: string) => {
      let next = removeConversationById(conversations, id)
      let newActiveId = activeConversationId
      if (activeConversationId === id) {
        if (next.length > 0) {
          newActiveId = next[0].id
        } else {
          next = [...next, createConversation(t('New chat'))]
          newActiveId = next.at(-1)?.id ?? newActiveId
        }
        setActiveConversationId(newActiveId)
        saveActiveConversationId(newActiveId)
      }
      setConversations(next)
      dirtyClientIdsRef.current.delete(id)
      lastPushedUpdatedAtRef.current.delete(id)
      // tombstone：本设备不再把它当「本地独有」重推而软删复活；即使服务端删失败
      // 也保留标记，避免每次拉取都试图复活它（服务端残留行可后续清理）。
      markConversationDeleted(id)
      void deleteServerConversation(id).catch(() => {
        toast.error(t('Failed to delete conversation'))
      })
      persistConversations(next)
    },
    [activeConversationId, conversations, persistConversations, t]
  )

  // Apply a system prompt: replace the first system message, or insert it at the
  // front (system messages must lead the payload).
  const applySystemMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return
      updateMessages((prev) => {
        const systemIndex = prev.findIndex(
          (message) => message.from === 'system'
        )
        if (systemIndex >= 0) {
          return prev.map((message, index) =>
            index === systemIndex
              ? updateCurrentVersionContent(message, trimmed)
              : message
          )
        }
        return [createSystemMessage(trimmed), ...prev]
      })
    },
    [updateMessages]
  )

  // Remove all system messages from the active conversation
  const clearSystemMessage = useCallback(() => {
    updateMessages((prev) => prev.filter((message) => message.from !== 'system'))
  }, [updateMessages])

  // Reset config to defaults
  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
    setParameterEnabled(DEFAULT_PARAMETER_ENABLED)
    saveConfig(DEFAULT_CONFIG)
    saveParameterEnabled(DEFAULT_PARAMETER_ENABLED)
  }, [])

  return {
    // State
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,

    // Conversations
    conversations,
    activeConversationId,
    activeConversation,
    createConversation: createNewConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
    applySystemMessage,
    clearSystemMessage,

    // Setters
    setModels,
    setGroups,

    // Actions
    updateConfig,
    updateParameterEnabled,
    updateMessages,
    clearMessages,
    resetConfig,
  }
}
