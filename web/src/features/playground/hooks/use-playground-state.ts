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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  const activeConversation =
    conversations.find(
      (conversation) => conversation.id === activeConversationId
    ) ?? null
  const messages = activeConversation?.messages ?? []

  // 调度一次防抖推送（已有定时器则合并）。
  const schedulePush = useCallback(() => {
    if (pushTimerRef.current !== null) {
      return
    }
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null
      void flushPushRef.current()
    }, CONVERSATIONS_SAVE_DEBOUNCE_MS)
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
        await pushServerConversation(conversation)
        lastPushedUpdatedAtRef.current.set(conversation.id, conversation.updatedAt)
        dirty.delete(conversation.id)
      }
    } catch {
      // 网络/服务端失败：保留脏标记，下轮重试。
    } finally {
      pushInFlightRef.current = false
      if (dirtyClientIdsRef.current.size > 0) {
        schedulePush()
      }
    }
  }, [schedulePush])

  useEffect(() => {
    flushPushRef.current = flushPush
  }, [flushPush])

  // 拉取服务端会话并按 updatedAt 合并到本地。本地独有会话标记脏待推送。
  const pullAndMerge = useCallback(async () => {
    const remote = await pullServerConversations()
    if (remote === null || !hasLoadedConversationsRef.current) {
      return
    }
    const local = latestConversationsRef.current
    const { merged, dirtyIds } = mergeConversations(local, remote)
    if (merged.length !== local.length || dirtyIds.length > 0) {
      latestConversationsRef.current = merged
      setConversations(merged)
      saveConversations(merged)
      setActiveConversationId((prev) => {
        if (prev && merged.some((conversation) => conversation.id === prev)) {
          return prev
        }
        return merged[0]?.id ?? prev
      })
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
      void deleteServerConversation(id).catch(() => {})
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
