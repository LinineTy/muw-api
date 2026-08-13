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
import { ERROR_MESSAGES } from '../../constants'
import type { ChatCompletionChunk, Message } from '../../types'

const STREAM_DONE_MESSAGE = '[DONE]'
const STREAM_CLOSED_READY_STATE = 2

export type StreamUpdateType = 'reasoning' | 'content'

export type StreamMessageUpdate = {
  type: StreamUpdateType
  chunk: string
}

type StreamErrorPayload = {
  error?: {
    code?: string
    message?: string
  }
}

export type StreamErrorDetails = {
  errorCode?: string
  errorMessage: string
}

export function parseStreamErrorDetails(data?: string): StreamErrorDetails {
  const fallbackMessage = data || ERROR_MESSAGES.API_REQUEST_ERROR

  if (!data) {
    return { errorMessage: fallbackMessage }
  }

  try {
    const parsed = JSON.parse(data) as StreamErrorPayload

    if (!parsed?.error) {
      return { errorMessage: fallbackMessage }
    }

    return {
      errorCode: parsed.error.code || undefined,
      errorMessage: parsed.error.message || fallbackMessage,
    }
  } catch {
    return { errorMessage: fallbackMessage }
  }
}

export function parseStreamMessageUpdates(data: string): StreamMessageUpdate[] {
  const chunk = JSON.parse(data) as ChatCompletionChunk
  const delta = chunk.choices?.[0]?.delta

  if (!delta) {
    return []
  }

  const updates: StreamMessageUpdate[] = []

  if (delta.reasoning_content) {
    updates.push({ type: 'reasoning', chunk: delta.reasoning_content })
  }

  if (delta.content) {
    updates.push({ type: 'content', chunk: delta.content })
  }

  return updates
}

export function isStreamDoneMessage(data: string): boolean {
  return data === STREAM_DONE_MESSAGE
}

type StreamUsagePayload = {
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Some providers attach `usage` to the final chunk before [DONE]. Parse it
 * defensively; returns null when absent or invalid (most streams have none, so
 * the token row simply does not render for those).
 */
export function parseStreamUsage(data: string): Message['usage'] | null {
  try {
    const parsed = JSON.parse(data) as StreamUsagePayload
    const usage = parsed.usage
    if (!usage) {
      return null
    }
    const { prompt_tokens, completion_tokens, total_tokens } = usage
    const isFiniteNumber = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value)
    if (
      !isFiniteNumber(prompt_tokens) ||
      !isFiniteNumber(completion_tokens) ||
      !isFiniteNumber(total_tokens)
    ) {
      return null
    }
    return {
      promptTokens: prompt_tokens,
      completionTokens: completion_tokens,
      totalTokens: total_tokens,
    }
  } catch {
    return null
  }
}

export function isStreamClosedReadyState(readyState?: number): boolean {
  return readyState === STREAM_CLOSED_READY_STATE
}

export function getStreamReadyStateError(
  eventReadyState: number | undefined,
  source: unknown
): string | null {
  const status = (source as { status?: number }).status

  if (
    eventReadyState !== undefined &&
    eventReadyState >= STREAM_CLOSED_READY_STATE &&
    status !== undefined &&
    status !== 200
  ) {
    return `HTTP ${status}: ${ERROR_MESSAGES.CONNECTION_CLOSED}`
  }

  return null
}
