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
import { MESSAGE_STATUS, STORAGE_KEYS } from '../../constants'
import { useAuthStore } from '@/stores/auth-store'
import type { Conversation, PlaygroundConfig, ParameterEnabled, Message } from '../../types'
import {
  finalizeMessage,
  isAssistantMessagePending,
  sanitizeMessagesOnLoad,
} from '../message/message-streaming-utils'
import { completeAssistantTiming } from '../message/message-timing-utils'
import { hasMessageContent } from '../message/message-utils'
import { deriveConversationTitle, createConversationWithMessages } from '../conversation/conversation-utils'
import {
  MAX_LOADED_MESSAGE_CHARS,
  MAX_LOADED_MESSAGES_CHARS,
  MAX_STORED_MESSAGES,
  MAX_STORED_MESSAGES_BYTES,
  STORAGE_VERSION,
  messagesSchema,
  parameterEnabledSchema,
  playgroundConfigSchema,
  conversationsSchema,
} from './storage-schema'

type StoredEnvelope<T> = {
  version: number
  data: T
}

const TRUNCATED_CONTENT_SUFFIX = '\n\n[...]'
const MIN_PREFIX_COLLAPSE_LENGTH = 2000
const MIN_REPEATED_SECTION_COUNT = 3
const SECTION_HEADING_LINE_PATTERN = /^#{2,6}\s+\d+\.\s+.+$/gm

// 旧版（未按用户分区）的键，仅用于一次性迁移后清除，避免跨账号泄漏。
const LEGACY_STORAGE_KEYS = [
  'playground_messages',
  'playground_config',
  'playground_parameter_enabled',
  'playground_conversations',
  'playground_active_conversation',
  'playground_system_presets',
  'playground_image_model',
] as const

/**
 * localStorage 是按浏览器（域名）共享、不按账号隔离的。游乐场状态按当前登录
 * 用户 id 加后缀分区，避免 admin/root 等不同账号互相看到对话与配置。
 */
export function userScopedKey(key: string): string {
  const userId = useAuthStore.getState().auth.user?.id
  return typeof userId === 'number' && userId > 0 ? `${key}_${userId}` : key
}

function readStoredValue(key: string): unknown | null {
  const saved = localStorage.getItem(userScopedKey(key))
  if (!saved) return null

  return JSON.parse(saved) as unknown
}

function readStoredMessagesValue(): unknown | null {
  const saved = localStorage.getItem(userScopedKey(STORAGE_KEYS.MESSAGES))
  if (!saved) return null

  if (saved.length > MAX_STORED_MESSAGES_BYTES) {
    localStorage.removeItem(userScopedKey(STORAGE_KEYS.MESSAGES))
    return null
  }

  return JSON.parse(saved) as unknown
}

function unwrapStoredValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value
  }

  if ('version' in value && 'data' in value) {
    return (value as StoredEnvelope<unknown>).data
  }

  return value
}

function writeStoredValue<T>(key: string, data: T): void {
  const payload: StoredEnvelope<T> = {
    version: STORAGE_VERSION,
    data,
  }

  localStorage.setItem(userScopedKey(key), JSON.stringify(payload))
}

function trimMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_STORED_MESSAGES) {
    return messages
  }

  return messages.slice(-MAX_STORED_MESSAGES)
}

function getMessageSize(message: Message): number {
  const versionsSize = message.versions.reduce(
    (total, version) => total + version.content.length,
    0
  )
  const reasoningSize = message.reasoning?.content.length ?? 0

  return versionsSize + reasoningSize
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  if (maxLength <= TRUNCATED_CONTENT_SUFFIX.length) {
    return text.slice(0, maxLength)
  }

  return `${text.slice(0, maxLength - TRUNCATED_CONTENT_SUFFIX.length)}${TRUNCATED_CONTENT_SUFFIX}`
}

type SectionOccurrence = {
  heading: string
  index: number
}

function getSectionOccurrences(text: string): SectionOccurrence[] {
  const occurrences: SectionOccurrence[] = []
  const matches = text.matchAll(SECTION_HEADING_LINE_PATTERN)
  for (const match of matches) {
    const index = match.index
    if (index === undefined) {
      continue
    }

    occurrences.push({
      heading: match[0],
      index,
    })
  }

  return occurrences
}

function getHeadingCounts(
  occurrences: SectionOccurrence[]
): Map<string, number> {
  const counts = new Map<string, number>()

  for (const occurrence of occurrences) {
    counts.set(occurrence.heading, (counts.get(occurrence.heading) ?? 0) + 1)
  }

  return counts
}

function findLastRepeatedSectionRunStart(text: string): number {
  const occurrences = getSectionOccurrences(text)
  const headingCounts = getHeadingCounts(occurrences)
  const lastRepeatedIndexes: number[] = []
  const seenHeadings = new Set<string>()

  for (let index = occurrences.length - 1; index >= 0; index--) {
    const occurrence = occurrences[index]
    const count = headingCounts.get(occurrence.heading) ?? 0

    if (
      count < MIN_REPEATED_SECTION_COUNT ||
      seenHeadings.has(occurrence.heading)
    ) {
      continue
    }

    seenHeadings.add(occurrence.heading)
    lastRepeatedIndexes.push(occurrence.index)
  }

  if (lastRepeatedIndexes.length === 0) {
    return -1
  }

  return Math.min(...lastRepeatedIndexes)
}

function collapseRepeatedSectionSnapshots(text: string): string {
  if (text.length < MIN_PREFIX_COLLAPSE_LENGTH) {
    return text
  }

  const lastRepeatedRunStart = findLastRepeatedSectionRunStart(text)
  if (lastRepeatedRunStart === -1) {
    return text
  }

  return text.slice(lastRepeatedRunStart)
}

function normalizeStoredMessageForLoad(message: Message): Message {
  let changed = false
  const versions = message.versions.map((version) => {
    const collapsedContent = collapseRepeatedSectionSnapshots(version.content)
    const content = truncateText(collapsedContent, MAX_LOADED_MESSAGE_CHARS)

    if (content === version.content && collapsedContent === version.content) {
      return version
    }

    changed = true
    return {
      ...version,
      content,
    }
  })

  const reasoning = message.reasoning
    ? {
        ...message.reasoning,
        content: truncateText(
          message.reasoning.content,
          MAX_LOADED_MESSAGE_CHARS
        ),
      }
    : undefined

  if (reasoning?.content !== message.reasoning?.content) {
    changed = true
  }

  const normalized = changed ? { ...message, versions, reasoning } : message

  if (!isAssistantMessagePending(normalized)) {
    return normalized
  }

  const hasContent = hasMessageContent(normalized)
  const hasReasoning = normalized.reasoning?.content.trim()

  if (!hasContent && !hasReasoning) {
    return normalized
  }

  const completedAt =
    normalized.completedAt ??
    normalized.reasoning?.completedAt ??
    normalized.startedAt ??
    normalized.createdAt ??
    Date.now()

  return completeAssistantTiming(
    {
      ...finalizeMessage(normalized),
      status: MESSAGE_STATUS.COMPLETE,
      isReasoningStreaming: false,
    },
    completedAt
  )
}

function trimMessagesByContentSize(messages: Message[]): Message[] {
  let totalSize = 0
  const result: Message[] = []

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const messageSize = getMessageSize(message)

    if (
      result.length > 0 &&
      totalSize + messageSize > MAX_LOADED_MESSAGES_CHARS
    ) {
      break
    }

    totalSize += messageSize
    result.push(message)
  }

  return result.reverse()
}

/**
 * Load playground config from localStorage
 */
export function loadConfig(): Partial<PlaygroundConfig> {
  try {
    const saved = readStoredValue(STORAGE_KEYS.CONFIG)
    if (!saved) return {}

    return playgroundConfigSchema.parse(unwrapStoredValue(saved))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load config:', error)
  }
  return {}
}

/**
 * Save playground config to localStorage
 */
export function saveConfig(config: Partial<PlaygroundConfig>): void {
  try {
    const parsed = playgroundConfigSchema.parse(config)
    writeStoredValue(STORAGE_KEYS.CONFIG, parsed)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save config:', error)
  }
}

/**
 * Load parameter enabled state from localStorage
 */
export function loadParameterEnabled(): Partial<ParameterEnabled> {
  try {
    const saved = readStoredValue(STORAGE_KEYS.PARAMETER_ENABLED)
    if (!saved) return {}

    return parameterEnabledSchema.parse(unwrapStoredValue(saved))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load parameter enabled:', error)
  }
  return {}
}

/**
 * Save parameter enabled state to localStorage
 */
export function saveParameterEnabled(
  parameterEnabled: Partial<ParameterEnabled>
): void {
  try {
    const parsed = parameterEnabledSchema.parse(parameterEnabled)
    writeStoredValue(STORAGE_KEYS.PARAMETER_ENABLED, parsed)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save parameter enabled:', error)
  }
}

/**
 * Load messages from localStorage
 */
export function loadMessages(): Message[] | null {
  try {
    const saved = readStoredMessagesValue()
    if (!saved) return null

    const parsed = messagesSchema.parse(unwrapStoredValue(saved)) as Message[]
    const normalized = parsed.map(normalizeStoredMessageForLoad)
    const normalizedChanged = normalized.some(
      (message, index) => message !== parsed[index]
    )
    const trimmed = trimMessages(normalized)
    const sizeTrimmed = trimMessagesByContentSize(trimmed)
    const sanitized = sanitizeMessagesOnLoad(sizeTrimmed)

    if (
      normalizedChanged ||
      trimmed !== normalized ||
      sizeTrimmed !== trimmed ||
      sanitized !== sizeTrimmed
    ) {
      saveMessages(sanitized)
    }

    return sanitized
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load messages:', error)
  }
  return null
}

/**
 * Save messages to localStorage
 */
export function saveMessages(messages: Message[]): void {
  try {
    const trimmed = trimMessages(messages)
    const parsed = messagesSchema.parse(trimmed) as Message[]
    writeStoredValue(STORAGE_KEYS.MESSAGES, parsed)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save messages:', error)
  }
}

/**
 * Load conversations from localStorage, or null when nothing was stored yet.
 */
export function loadConversations(): Conversation[] | null {
  try {
    const saved = readStoredValue(STORAGE_KEYS.CONVERSATIONS)
    if (!saved) return null
    return conversationsSchema.parse(unwrapStoredValue(saved)) as Conversation[]
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load conversations:', error)
  }
  return null
}

/**
 * Save conversations to localStorage (each conversation's messages trimmed).
 */
export function saveConversations(conversations: Conversation[]): void {
  try {
    const trimmed = conversations.map((conversation) => ({
      ...conversation,
      messages: trimMessages(conversation.messages),
    }))
    const parsed = conversationsSchema.parse(trimmed) as Conversation[]
    writeStoredValue(STORAGE_KEYS.CONVERSATIONS, parsed)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save conversations:', error)
  }
}

/**
 * Load the persisted active conversation id (may point at a deleted conversation).
 */
export function loadActiveConversationId(): string | null {
  try {
    const saved = localStorage.getItem(
      userScopedKey(STORAGE_KEYS.ACTIVE_CONVERSATION)
    )
    return saved ? (JSON.parse(saved) as string) : null
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load active conversation id:', error)
  }
  return null
}

/**
 * Persist the active conversation id; null removes the key.
 */
export function saveActiveConversationId(id: string | null): void {
  try {
    const key = userScopedKey(STORAGE_KEYS.ACTIVE_CONVERSATION)
    if (id === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(id))
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save active conversation id:', error)
  }
}

/**
 * Load conversations, migrating the legacy (user-unscopped) single-session
 * playground_messages into the current user's scoped store on first use, then
 * clearing the legacy keys so other accounts never inherit them.
 */
export function loadOrCreateConversations(): {
  conversations: Conversation[]
  activeId: string
} {
  const stored = loadConversations()
  if (stored && stored.length > 0) {
    const activeId = loadActiveConversationId()
    const valid =
      activeId && stored.some((conversation) => conversation.id === activeId)
    return {
      conversations: stored,
      activeId: valid ? (activeId as string) : stored[0].id,
    }
  }

  const migrated = migrateLegacyPlaygroundData()
  if (migrated) {
    saveConversations(migrated.conversations)
    saveActiveConversationId(migrated.activeId)
    return migrated
  }

  const seeded = createConversationWithMessages('New chat', [])
  saveConversations([seeded])
  saveActiveConversationId(seeded.id)
  return { conversations: [seeded], activeId: seeded.id }
}

/**
 * One-time migration from legacy user-unscopped storage into the current user's
 * scoped store. Prefers the multi-conversation store, then falls back to the
 * older single-session messages. Legacy keys are cleared so a different account
 * on the same browser starts fresh.
 */
function migrateLegacyPlaygroundData(): {
  conversations: Conversation[]
  activeId: string
} | null {
  // 1) 旧多会话存储（multi-conversation era）。
  const rawConversations = localStorage.getItem('playground_conversations')
  if (rawConversations) {
    try {
      const parsed = conversationsSchema.parse(
        unwrapStoredValue(JSON.parse(rawConversations))
      ) as Conversation[]
      if (parsed.length > 0) {
        let legacyActiveId: string | null = null
        const rawActive = localStorage.getItem('playground_active_conversation')
        try {
          legacyActiveId = rawActive ? (JSON.parse(rawActive) as string) : null
        } catch {
          // 忽略损坏的 active id
        }
        const validActive =
          legacyActiveId !== null &&
          parsed.some((conversation) => conversation.id === legacyActiveId)
        clearLegacyPlaygroundKeys()
        return {
          conversations: parsed,
          activeId:
            validActive && legacyActiveId !== null
              ? legacyActiveId
              : parsed[0].id,
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to migrate legacy playground conversations:', error)
    }
  }

  // 2) 旧单会话消息（single-session era）。
  const rawMessages = localStorage.getItem('playground_messages')
  clearLegacyPlaygroundKeys()
  if (!rawMessages) {
    return null
  }
  try {
    const parsed = messagesSchema.parse(
      unwrapStoredValue(JSON.parse(rawMessages))
    ) as Message[]
    const legacy = parsed.map(normalizeStoredMessageForLoad)
    if (legacy.length === 0) {
      return null
    }
    const seeded = createConversationWithMessages(
      deriveConversationTitle(legacy, 'New chat'),
      legacy
    )
    return { conversations: [seeded], activeId: seeded.id }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to migrate legacy playground messages:', error)
    return null
  }
}

function clearLegacyPlaygroundKeys(): void {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // 忽略
    }
  }
}

/**
 * Clear all playground data for the current user.
 */
export function clearPlaygroundData(): void {
  try {
    localStorage.removeItem(userScopedKey(STORAGE_KEYS.CONFIG))
    localStorage.removeItem(userScopedKey(STORAGE_KEYS.PARAMETER_ENABLED))
    localStorage.removeItem(userScopedKey(STORAGE_KEYS.MESSAGES))
    localStorage.removeItem(userScopedKey(STORAGE_KEYS.CONVERSATIONS))
    localStorage.removeItem(userScopedKey(STORAGE_KEYS.ACTIVE_CONVERSATION))
    localStorage.removeItem(userScopedKey(STORAGE_KEYS.SYSTEM_PRESETS))
    localStorage.removeItem(userScopedKey(STORAGE_KEYS.IMAGE_MODEL))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to clear playground data:', error)
  }
}
