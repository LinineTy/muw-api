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
import { nanoid } from 'nanoid'

import type { Conversation, Message } from '../../types'
import { getMessageContent } from '../message/message-utils'

const TITLE_MAX_LENGTH = 30

type MessageStateUpdater =
  | Message[]
  | ((previousMessages: Message[]) => Message[])

function applyMessageStateUpdate(
  previousMessages: Message[],
  updater: MessageStateUpdater
): Message[] {
  return typeof updater === 'function' ? updater(previousMessages) : updater
}

/**
 * Derive a conversation title from its messages: the first non-empty user
 * message, whitespace-collapsed, truncated to TITLE_MAX_LENGTH chars.
 */
export function deriveConversationTitle(
  messages: Message[],
  fallback: string
): string {
  const firstUserText = messages.find(
    (message) =>
      message.from === 'user' && getMessageContent(message).trim() !== ''
  )

  const raw = firstUserText ? getMessageContent(firstUserText).trim() : ''
  if (!raw) {
    return fallback
  }

  const collapsed = raw.replaceAll(/\s+/g, ' ')
  if (collapsed.length <= TITLE_MAX_LENGTH) {
    return collapsed
  }
  return `${collapsed.slice(0, TITLE_MAX_LENGTH)}…`
}

/**
 * Create a new conversation with the given messages (used for migration).
 */
export function createConversationWithMessages(
  title: string,
  messages: Message[] = []
): Conversation {
  const now = Date.now()
  return {
    id: nanoid(),
    title,
    messages,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Create a fresh empty conversation.
 */
export function createConversation(title: string): Conversation {
  return createConversationWithMessages(title, [])
}

/**
 * Apply a message-state updater to the active conversation and bump updatedAt.
 */
export function updateActiveConversationMessages(
  conversations: Conversation[],
  activeConversationId: string | null,
  updater: MessageStateUpdater
): Conversation[] {
  return conversations.map((conversation) => {
    if (conversation.id !== activeConversationId) {
      return conversation
    }
    return {
      ...conversation,
      messages: applyMessageStateUpdate(conversation.messages, updater),
      updatedAt: Date.now(),
    }
  })
}

/**
 * Rename a conversation by id (no-op when the id is missing).
 */
export function renameConversationById(
  conversations: Conversation[],
  id: string,
  title: string
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === id ? { ...conversation, title } : conversation
  )
}

/**
 * Remove a conversation by id.
 */
export function removeConversationById(
  conversations: Conversation[],
  id: string
): Conversation[] {
  return conversations.filter((conversation) => conversation.id !== id)
}
